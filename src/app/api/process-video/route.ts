import { NextRequest } from 'next/server'
import { Agent, fetch as undiciFetch, RequestInit as UndiciRequestInit } from 'undici'

// Create a custom agent with extended timeouts for large video processing
const longTimeoutAgent = new Agent({
  headersTimeout: 900000, // 15 minutes for headers
  bodyTimeout: 900000,    // 15 minutes for body
  connectTimeout: 60000,  // 1 minute to connect
  keepAliveTimeout: 900000,
  keepAliveMaxTimeout: 900000,
})

// Custom fetch with extended timeout for large video processing
async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number = 900000): Promise<Response> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    // Build undici-compatible options
    const undiciOptions: UndiciRequestInit = {
      method: options.method,
      headers: options.headers as Record<string, string>,
      body: options.body as string | Uint8Array | null | undefined,
      signal: controller.signal,
      dispatcher: longTimeoutAgent,
    }
    
    const response = await undiciFetch(url, undiciOptions)
    clearTimeout(timeoutId)
    return response as unknown as Response
  } catch (error) {
    clearTimeout(timeoutId)
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Request timed out after ${timeoutMs / 1000} seconds`)
    }
    // Handle undici-specific timeout errors
    if (error instanceof Error && (error.message.includes('Timeout') || error.message.includes('timeout'))) {
      throw new Error(`Request timed out: ${error.message}`)
    }
    throw error
  }
}

// Standard fetch for quick operations (file status checks, etc.)
async function quickFetch(url: string, options?: RequestInit): Promise<Response> {
  return fetch(url, options)
}

// Attempt to repair truncated JSON by completing missing brackets/braces
function repairJSON(jsonString: string): string {
  let repaired = jsonString.trim()

  // Count open/close brackets and braces
  let openBraces = 0
  let openBrackets = 0
  let inString = false
  let escaped = false

  for (let i = 0; i < repaired.length; i++) {
    const char = repaired[i]

    if (escaped) {
      escaped = false
      continue
    }

    if (char === '\\') {
      escaped = true
      continue
    }

    if (char === '"' && !escaped) {
      inString = !inString
      continue
    }

    if (!inString) {
      if (char === '{') openBraces++
      else if (char === '}') openBraces--
      else if (char === '[') openBrackets++
      else if (char === ']') openBrackets--
    }
  }

  // If we're in a string, try to close it
  if (inString) {
    // Find last occurrence of a reasonable string endpoint
    const lastQuote = repaired.lastIndexOf('"')
    if (lastQuote > 0 && repaired[lastQuote - 1] !== '\\') {
      // Truncate to last complete property and add closing quote
      repaired = repaired + '"'
    } else {
      repaired = repaired + '"'
    }
    // Recount after fix
    inString = false
  }

  // Close any unclosed brackets/braces
  while (openBrackets > 0) {
    repaired += ']'
    openBrackets--
  }
  while (openBraces > 0) {
    repaired += '}'
    openBraces--
  }

  return repaired
}

// Safe JSON parse with repair attempt
function safeJSONParse<T>(jsonString: string, fallback?: T): T {
  try {
    return JSON.parse(jsonString)
  } catch (firstError) {
    console.log('Initial JSON parse failed, attempting repair...')
    console.log('Original error:', firstError)

    try {
      const repaired = repairJSON(jsonString)
      console.log('Attempting to parse repaired JSON...')
      return JSON.parse(repaired)
    } catch (repairError) {
      console.error('JSON repair also failed:', repairError)
      console.error('Truncated content (first 500 chars):', jsonString.substring(0, 500))
      console.error('Truncated content (last 500 chars):', jsonString.substring(jsonString.length - 500))

      if (fallback !== undefined) {
        return fallback
      }
      throw new Error(`Failed to parse AI response as JSON. The response may have been truncated. Please try again with a shorter video or different model.`)
    }
  }
}

// Gemini API Configuration (works with Vertex AI Express API keys)
const GEMINI_API_KEY = process.env.GEMINI_API_KEY
const KNIGHT_API_KEY = process.env.KNIGHT_API_KEY
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'
const KNIGHT_API_BASE = 'https://knight-omega.duckdns.org/v1'

// Model context limits (approximate - actual may vary based on video content)
// Most Gemini models have 1M token context window
const MODEL_CONTEXT_LIMITS: Record<string, number> = {
  'gemini-1.5-flash': 1048576,      // 1M tokens
  'gemini-1.5-flash-latest': 1048576,
  'gemini-1.5-flash-001': 1048576,
  'gemini-1.5-flash-002': 1048576,
  'gemini-2.0-flash': 1048576,
  'gemini-2.0-flash-exp': 1048576,
  'gemini-1.5-pro': 2097152,        // 2M tokens - best for large videos
  'gemini-1.5-pro-latest': 2097152,
  'gemini-1.5-pro-001': 2097152,
  'gemini-1.5-pro-002': 2097152,
  'gemini-exp-1206': 2097152,       // Experimental with 2M context
}

// Estimate max video duration based on model context limit
// Videos are roughly 1000-2000 tokens per minute depending on content
function getMaxVideoDuration(modelId: string): string {
  const contextLimit = MODEL_CONTEXT_LIMITS[modelId] || 1048576
  // Assuming ~1500 tokens per minute of video on average
  const maxMinutes = Math.floor(contextLimit / 1500)
  
  if (maxMinutes >= 60) {
    const hours = Math.floor(maxMinutes / 60)
    const mins = maxMinutes % 60
    return `~${hours}h ${mins}m`
  }
  return `~${maxMinutes} minutes`
}

// Check if file might exceed token limit and return warning
function checkFileSizeWarning(fileSizeBytes: number, modelId: string): string | null {
  const fileSizeMB = fileSizeBytes / (1024 * 1024)
  const contextLimit = MODEL_CONTEXT_LIMITS[modelId] || 1048576
  
  // Rough estimate: 1GB video ≈ 1-2M tokens
  // 500MB ≈ 500K-1M tokens
  // Most models can handle up to ~45-60 minute videos
  
  if (fileSizeMB > 500 && contextLimit <= 1048576) {
    return `Video file is ${fileSizeMB.toFixed(0)}MB which may exceed the ${modelId}'s token limit. Consider trimming to under 45 minutes or using a model with higher context (like gemini-1.5-pro if available).`
  }
  
  if (fileSizeMB > 800) {
    return `Video file is ${fileSizeMB.toFixed(0)}MB which is very large. Processing may fail. Consider trimming to under 45 minutes.`
  }
  
  return null
}

// Helper to detect if model is from Knight API
function isKnightModel(modelId: string): boolean {
  return modelId.startsWith('knight:')
}

// Extract actual model ID for Knight API
function getKnightModelId(modelId: string): string {
  return modelId.replace('knight:', '')
}

export interface VideoAnalysisResult {
  clean_script: string
  chapters: Array<{
    title: string
    start_time: string
    end_time: string
    summary: string
    key_points: string[]
  }>
  full_session_summary: string
  important_concepts: string[]
  recommended_practice: string[]
  content_metadata: {
    original_duration_estimate: string
    essential_content_duration: string
    content_removed_percentage: number
    filtered_categories: Array<{
      category: string
      description: string
      approximate_duration: string
    }>
    main_content_timestamps: Array<{
      start: string
      end: string
      description: string
    }>
  }
}

// Next.js App Router config for large file uploads
export const runtime = 'nodejs'
export const maxDuration = 900 // 15 minutes timeout for large files up to 1GB

// SSE helper function to send progress updates
function createSSEStream() {
  const encoder = new TextEncoder()
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null

  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c
    }
  })

  const sendEvent = (event: string, data: unknown) => {
    if (controller) {
      const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
      controller.enqueue(encoder.encode(message))
    }
  }

  const close = () => {
    if (controller) {
      controller.close()
    }
  }

  return { stream, sendEvent, close }
}

export async function POST(request: NextRequest) {
  // Check if client wants streaming
  const acceptsSSE = request.headers.get('accept')?.includes('text/event-stream')
  
  // Check if client explicitly requests chunked processing
  const url = new URL(request.url)
  const useChunked = url.searchParams.get('chunked') === 'true'
  
  // Auto-route large files to chunked processing
  const AUTO_CHUNK_THRESHOLD_MB = parseInt(process.env.AUTO_CHUNK_THRESHOLD_MB || '500')
  
  // Clone request to peek at file size
  const formDataPeek = await request.clone().formData()
  const filePeek = formDataPeek.get('video') as File | null
  
  if (filePeek && (useChunked || filePeek.size > AUTO_CHUNK_THRESHOLD_MB * 1024 * 1024)) {
    // Redirect to chunked processing endpoint
    console.log(`[Auto-Route] File size ${(filePeek.size / (1024 * 1024)).toFixed(2)}MB - routing to chunked processing`)
    
    // Forward the request to the chunked endpoint
    const chunkedUrl = new URL(request.url)
    chunkedUrl.pathname = '/api/process-video-chunked'
    
    return fetch(chunkedUrl.toString(), {
      method: 'POST',
      headers: request.headers,
      body: await request.clone().blob(),
    })
  }

  if (acceptsSSE) {
    return handleStreamingRequest(request)
  } else {
    return handleNormalRequest(request)
  }
}

async function handleStreamingRequest(request: NextRequest) {
  const { stream, sendEvent, close } = createSSEStream()

    // Process in the background
    ; (async () => {
      try {
        const modelId = (await request.clone().formData()).get('model') as string || 'gemini-1.5-flash'
        const useKnight = isKnightModel(modelId)

        if (useKnight && !KNIGHT_API_KEY) {
          sendEvent('error', { message: 'Knight API key not configured. Please add KNIGHT_API_KEY to .env.local' })
          close()
          return
        }
        if (!useKnight && !GEMINI_API_KEY) {
          sendEvent('error', { message: 'Gemini API key not configured. Please add GEMINI_API_KEY to .env.local' })
          close()
          return
        }

        sendEvent('progress', { stage: 'uploading', progress: 5, message: 'Receiving video...' })

        const formData = await request.formData()
        const file = formData.get('video') as File
        // modelId already extracted above from cloned formData

        if (!file) {
          sendEvent('error', { message: 'No video file provided' })
          close()
          return
        }

        const fileSizeMB = (file.size / (1024 * 1024)).toFixed(2)
        console.log(`File received: ${file.name}, size: ${fileSizeMB}MB, type: ${file.type}`)

        // Validate file type
        const allowedTypes = ['video/mp4', 'video/x-matroska', 'video/quicktime', 'video/webm']
        if (!allowedTypes.includes(file.type)) {
          sendEvent('error', { message: 'Invalid file type. Allowed: MP4, MKV, MOV, WebM' })
          close()
          return
        }

        const MAX_FILE_SIZE = 1024 * 1024 * 1024 // 1GB max
        const MAX_INLINE_SIZE = 20 * 1024 * 1024 // 20MB for inline base64

        if (file.size > MAX_FILE_SIZE) {
          sendEvent('error', { message: 'File too large. Maximum file size is 1GB.' })
          close()
          return
        }

        const mimeType = file.type || 'video/mp4'

        if (useKnight) {
          // Knight API processing
          sendEvent('progress', { stage: 'processing', progress: 30, message: 'Encoding video for Knight API...' })

          const buffer = await file.arrayBuffer()
          const base64 = Buffer.from(buffer).toString('base64')

          sendEvent('progress', { stage: 'processing', progress: 40, message: `Sending to Knight API (${getKnightModelId(modelId)})...` })

          const result = await callKnightAPI(base64, mimeType, modelId)
          sendEvent('complete', result)
        } else if (file.size > MAX_INLINE_SIZE) {
          // Check for file size warning
          const sizeWarning = checkFileSizeWarning(file.size, modelId)
          if (sizeWarning) {
            console.log(`Warning: ${sizeWarning}`)
          }

          sendEvent('progress', {
            stage: 'uploading',
            progress: 20,
            message: `Uploading ${(file.size / (1024 * 1024)).toFixed(0)}MB to Gemini File API...`
          })

          try {
            const result = await processWithFileAPIStreaming(file, modelId, sendEvent)
            sendEvent('complete', result)
          } catch (error) {
            // Check if it's a token limit error and provide helpful message
            if (error instanceof Error && error.message.includes('token count exceeds')) {
              const maxDuration = getMaxVideoDuration(modelId)
              throw new Error(`Video is too long for ${modelId} (max ${maxDuration}). Please trim your video to under 45 minutes or use a shorter recording. You can use the Video Trimmer feature after uploading a shorter preview.`)
            } else {
              throw error
            }
          }
        } else {
          sendEvent('progress', { stage: 'processing', progress: 30, message: 'Encoding video...' })

          const buffer = await file.arrayBuffer()
          const base64 = Buffer.from(buffer).toString('base64')

          sendEvent('progress', { stage: 'processing', progress: 40, message: 'Sending to Gemini AI...' })

          const result = await callGeminiAPI(base64, mimeType, true, modelId)
          sendEvent('complete', result)
        }

        close()
      } catch (error) {
        console.error('Streaming error:', error)
        sendEvent('error', { message: error instanceof Error ? error.message : 'Unknown error' })
        close()
      }
    })()

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
}

async function handleNormalRequest(request: NextRequest) {
  try {
    console.log('Processing video upload request...')

    const formData = await request.formData()
    const file = formData.get('video') as File
    const modelId = formData.get('model') as string || 'gemini-1.5-flash'
    const useKnight = isKnightModel(modelId)

    console.log(`Using model: ${modelId} (Provider: ${useKnight ? 'Knight' : 'Gemini'})`)

    // Validate API key for the selected provider
    if (useKnight && !KNIGHT_API_KEY) {
      console.error('KNIGHT_API_KEY not configured')
      return Response.json(
        { error: 'Knight API key not configured. Please add KNIGHT_API_KEY to .env.local' },
        { status: 500 }
      )
    }
    if (!useKnight && !GEMINI_API_KEY) {
      console.error('GEMINI_API_KEY not configured')
      return Response.json(
        { error: 'Gemini API key not configured. Please add GEMINI_API_KEY to .env.local' },
        { status: 500 }
      )
    }

    if (!file) {
      return Response.json(
        { error: 'No video file provided' },
        { status: 400 }
      )
    }

    const fileSizeMB = (file.size / (1024 * 1024)).toFixed(2)
    console.log(`File received: ${file.name}, size: ${fileSizeMB}MB, type: ${file.type}`)

    // Validate file type
    const allowedTypes = ['video/mp4', 'video/x-matroska', 'video/quicktime', 'video/webm']
    if (!allowedTypes.includes(file.type)) {
      return Response.json(
        { error: 'Invalid file type. Allowed: MP4, MKV, MOV, WebM' },
        { status: 400 }
      )
    }

    // Check file size limits
    const MAX_FILE_SIZE = 1024 * 1024 * 1024 // 1GB max
    const MAX_INLINE_SIZE = 20 * 1024 * 1024 // 20MB for inline base64

    if (file.size > MAX_FILE_SIZE) {
      return Response.json(
        { error: 'File too large. Maximum file size is 1GB.' },
        { status: 400 }
      )
    }

    // Determine media type
    const mimeType = file.type || 'video/mp4'

    // Knight API processing
    if (useKnight) {
      console.log('Processing with Knight API...')
      const buffer = await file.arrayBuffer()
      const base64 = Buffer.from(buffer).toString('base64')

      const result = await callKnightAPI(base64, mimeType, modelId)
      return Response.json(result)
    }

    // Gemini processing
    if (file.size > MAX_INLINE_SIZE) {
      console.log('File is larger than 20MB, using Gemini File API...')

      // Check for file size warning
      const sizeWarning = checkFileSizeWarning(file.size, modelId)
      if (sizeWarning) {
        console.log(`Warning: ${sizeWarning}`)
      }

      // For larger files, use the File API with resumable upload
      try {
        const result = await processWithFileAPI(file, modelId)
        return Response.json(result)
      } catch (fileApiError) {
        // Check if it's a token limit error and provide helpful message
        if (fileApiError instanceof Error && fileApiError.message.includes('token count exceeds')) {
          const maxDuration = getMaxVideoDuration(modelId)
          return Response.json(
            { error: `Video is too long for ${modelId} (max ${maxDuration}). Please trim your video to under 45 minutes or use a shorter recording. You can use the Video Trimmer feature after uploading a shorter preview.` },
            { status: 400 }
          )
        }
        
        console.error('File API failed:', fileApiError)
        return Response.json(
          { error: `Failed to process large file: ${fileApiError instanceof Error ? fileApiError.message : 'Unknown error'}` },
          { status: 500 }
        )
      }
    }

    // For smaller files (under 20MB), use inline base64
    console.log('Using inline base64 for small file...')
    const buffer = await file.arrayBuffer()
    const base64 = Buffer.from(buffer).toString('base64')

    console.log('Calling Gemini API with inline video data...')

    const result = await callGeminiAPI(base64, mimeType, true, modelId)
    return Response.json(result)

  } catch (error) {
    console.error('API route error:', error)
    return Response.json(
      { error: `Internal server error: ${error instanceof Error ? error.message : 'Unknown error'}` },
      { status: 500 }
    )
  }
}

// Estimate processing time based on file size
function estimateProcessingTime(fileSize: number): string {
  const sizeMB = fileSize / (1024 * 1024)

  if (sizeMB < 50) {
    return '1-2 minutes'
  } else if (sizeMB < 200) {
    return '2-4 minutes'
  } else if (sizeMB < 500) {
    return '4-8 minutes'
  } else {
    return '8-15 minutes'
  }
}

// Chunked upload for large files - uploads in 64MB chunks for better performance
async function uploadFileInChunks(
  file: File,
  uploadUri: string,
  sendEvent: (event: string, data: unknown) => void
): Promise<Response> {
  const CHUNK_SIZE = 64 * 1024 * 1024 // 64MB chunks - faster upload with fewer requests
  const totalSize = file.size
  let offset = 0
  let lastResponse: Response | null = null

  const totalChunks = Math.ceil(totalSize / CHUNK_SIZE)
  let currentChunk = 0

  while (offset < totalSize) {
    currentChunk++
    const end = Math.min(offset + CHUNK_SIZE, totalSize)
    const isLastChunk = end === totalSize

    // Read only the chunk we need - memory efficient
    const chunkBlob = file.slice(offset, end)
    const chunkBuffer = await chunkBlob.arrayBuffer()
    const chunkBytes = new Uint8Array(chunkBuffer)

    const uploadProgress = 25 + (currentChunk / totalChunks) * 35 // Progress from 25% to 60%
    sendEvent('progress', {
      stage: 'uploading',
      progress: uploadProgress,
      message: `Uploading chunk ${currentChunk}/${totalChunks} (${Math.round(end / (1024 * 1024))}MB / ${Math.round(totalSize / (1024 * 1024))}MB)...`
    })

    const command = isLastChunk ? 'upload, finalize' : 'upload'

    const response = await fetchWithTimeout(uploadUri, {
      method: 'PUT',
      headers: {
        'Content-Length': chunkBytes.length.toString(),
        'X-Goog-Upload-Offset': offset.toString(),
        'X-Goog-Upload-Command': command,
      },
      body: chunkBytes,
    }, 600000) // 10 min timeout per chunk (increased for larger chunks)

    if (!response.ok && !isLastChunk) {
      const errorText = await response.text()
      throw new Error(`Chunk upload failed at offset ${offset}: ${errorText}`)
    }

    lastResponse = response
    offset = end

    // No delay between chunks for maximum speed
  }

  if (!lastResponse) {
    throw new Error('No response from upload')
  }

  return lastResponse
}

async function processWithFileAPIStreaming(
  file: File,
  modelId: string,
  sendEvent: (event: string, data: unknown) => void
): Promise<VideoAnalysisResult> {
  const uploadUrl = 'https://generativelanguage.googleapis.com/upload/v1beta/files'

  const mimeType = file.type || 'video/mp4'
  const fileSizeMB = (file.size / (1024 * 1024)).toFixed(2)
  const useChunkedUpload = file.size > 50 * 1024 * 1024 // Use chunked upload for files > 50MB

  sendEvent('progress', { stage: 'uploading', progress: 20, message: `Initiating upload for ${fileSizeMB}MB file...` })

  // Step 1: Initiate resumable upload
  const initResponse = await fetchWithTimeout(`${uploadUrl}?key=${GEMINI_API_KEY}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': file.size.toString(),
      'X-Goog-Upload-Header-Content-Type': mimeType,
    },
    body: JSON.stringify({
      file: {
        displayName: file.name,
      },
    }),
  }, 60000) // 1 min timeout for init

  if (!initResponse.ok) {
    const errorText = await initResponse.text()
    throw new Error(`Failed to initiate upload: ${errorText}`)
  }

  const uploadUri = initResponse.headers.get('X-Goog-Upload-URL')
  if (!uploadUri) {
    sendEvent('progress', { stage: 'uploading', progress: 25, message: 'Using simple upload...' })
    return await simpleFileUploadStreaming(file, modelId, sendEvent)
  }

  let uploadResponse: Response

  if (useChunkedUpload) {
    // Use chunked upload for large files to avoid memory issues
    sendEvent('progress', { stage: 'uploading', progress: 25, message: 'Starting chunked upload for large file...' })
    uploadResponse = await uploadFileInChunks(file, uploadUri, sendEvent)
  } else {
    // For smaller files, upload in one go
    sendEvent('progress', { stage: 'uploading', progress: 30, message: 'Uploading file data...' })

    const buffer = await file.arrayBuffer()
    const bytes = new Uint8Array(buffer)

    uploadResponse = await fetchWithTimeout(uploadUri, {
      method: 'PUT',
      headers: {
        'Content-Length': bytes.length.toString(),
        'X-Goog-Upload-Offset': '0',
        'X-Goog-Upload-Command': 'upload, finalize',
      },
      body: bytes,
    }, 300000) // 5 min timeout
  }

  if (!uploadResponse.ok) {
    const errorText = await uploadResponse.text()
    throw new Error(`File upload failed: ${errorText}`)
  }

  const uploadResult = await uploadResponse.json()
  const fileUri = uploadResult.file?.uri
  const fileName = uploadResult.file?.name

  if (!fileUri) {
    throw new Error('No file URI returned from upload')
  }

  sendEvent('progress', { stage: 'processing', progress: 62, message: 'Waiting for Gemini to process video...' })

  // Wait for file to be processed
  if (fileName) {
    await waitForFileReadyWithProgress(fileName, file.size, sendEvent)
  } else {
    const waitTime = Math.min(180000, Math.max(30000, file.size / 1000000 * 500))
    await new Promise(resolve => setTimeout(resolve, waitTime))
  }

  sendEvent('progress', { stage: 'analyzing', progress: 75, message: 'Analyzing content with AI...' })

  // Now call Gemini with the file reference
  const result = await callGeminiAPI(fileUri, mimeType, false, modelId)

  sendEvent('progress', { stage: 'complete', progress: 95, message: 'Generating results...' })

  return result
}

// Simple file upload with streaming progress for fallback
async function simpleFileUploadStreaming(
  file: File,
  modelId: string,
  sendEvent: (event: string, data: unknown) => void
): Promise<VideoAnalysisResult> {
  const uploadUrl = 'https://generativelanguage.googleapis.com/upload/v1beta/files'
  const mimeType = file.type || 'video/mp4'
  const fileSizeMB = (file.size / (1024 * 1024)).toFixed(2)

  sendEvent('progress', { stage: 'uploading', progress: 30, message: `Uploading ${fileSizeMB}MB file...` })

  // For files > 100MB, use chunked reading to avoid memory issues
  if (file.size > 100 * 1024 * 1024) {
    // Read file in chunks and combine
    const chunks: Uint8Array[] = []
    const CHUNK_SIZE = 50 * 1024 * 1024 // 50MB chunks
    let offset = 0
    let chunkNum = 0
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE)

    while (offset < file.size) {
      chunkNum++
      const end = Math.min(offset + CHUNK_SIZE, file.size)
      const blob = file.slice(offset, end)
      const buffer = await blob.arrayBuffer()
      chunks.push(new Uint8Array(buffer))

      const progress = 30 + (chunkNum / totalChunks) * 20
      sendEvent('progress', { stage: 'uploading', progress, message: `Reading file chunk ${chunkNum}/${totalChunks}...` })

      offset = end
    }

    // Combine chunks
    const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0)
    const bytes = new Uint8Array(totalLength)
    let position = 0
    for (const chunk of chunks) {
      bytes.set(chunk, position)
      position += chunk.length
    }

    sendEvent('progress', { stage: 'uploading', progress: 55, message: 'Sending to Gemini...' })

    const uploadResponse = await fetchWithTimeout(`${uploadUrl}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: {
        'Content-Type': mimeType,
        'X-Goog-Upload-Command': 'upload, finalize',
        'X-Goog-Upload-Header-Content-Length': bytes.length.toString(),
        'X-Goog-Upload-Header-Content-Type': mimeType,
      },
      body: bytes,
    }, 600000) // 10 min timeout for large files

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text()
      throw new Error(`Upload failed: ${errorText}`)
    }

    const uploadResult = await uploadResponse.json()
    const fileUri = uploadResult.file?.uri
    const fileName = uploadResult.file?.name

    if (!fileUri) {
      throw new Error('No file URI returned from upload')
    }

    if (fileName) {
      await waitForFileReadyWithProgress(fileName, file.size, sendEvent)
    } else {
      const waitTime = Math.min(180000, Math.max(30000, file.size / 1000000 * 500))
      await new Promise(resolve => setTimeout(resolve, waitTime))
    }

    return await callGeminiAPI(fileUri, mimeType, false, modelId)
  }

  // For smaller files, use standard approach
  const buffer = await file.arrayBuffer()
  const bytes = new Uint8Array(buffer)

  sendEvent('progress', { stage: 'uploading', progress: 45, message: 'Sending to Gemini...' })

  const uploadResponse = await fetchWithTimeout(`${uploadUrl}?key=${GEMINI_API_KEY}`, {
    method: 'POST',
    headers: {
      'Content-Type': mimeType,
      'X-Goog-Upload-Command': 'upload, finalize',
      'X-Goog-Upload-Header-Content-Length': bytes.length.toString(),
      'X-Goog-Upload-Header-Content-Type': mimeType,
    },
    body: bytes,
  }, 300000)

  if (!uploadResponse.ok) {
    const errorText = await uploadResponse.text()
    throw new Error(`Upload failed: ${errorText}`)
  }

  const uploadResult = await uploadResponse.json()
  const fileUri = uploadResult.file?.uri
  const fileName = uploadResult.file?.name

  if (!fileUri) {
    throw new Error('No file URI returned from upload')
  }

  if (fileName) {
    await waitForFileReadyWithProgress(fileName, file.size, sendEvent)
  } else {
    const waitTime = Math.min(120000, Math.max(30000, file.size / 1000000 * 500))
    await new Promise(resolve => setTimeout(resolve, waitTime))
  }

  return await callGeminiAPI(fileUri, mimeType, false, modelId)
}

// Non-streaming chunked upload for large files
async function uploadFileInChunksNonStreaming(
  file: File,
  uploadUri: string
): Promise<Response> {
  const CHUNK_SIZE = 64 * 1024 * 1024 // 64MB chunks
  const totalSize = file.size
  let offset = 0
  let lastResponse: Response | null = null

  const totalChunks = Math.ceil(totalSize / CHUNK_SIZE)
  let currentChunk = 0

  console.log(`Starting chunked upload: ${totalChunks} chunks of ${CHUNK_SIZE / (1024 * 1024)}MB each`)

  while (offset < totalSize) {
    currentChunk++
    const end = Math.min(offset + CHUNK_SIZE, totalSize)
    const isLastChunk = end === totalSize

    // Read only the chunk we need
    const chunkBlob = file.slice(offset, end)
    const chunkBuffer = await chunkBlob.arrayBuffer()
    const chunkBytes = new Uint8Array(chunkBuffer)

    console.log(`Uploading chunk ${currentChunk}/${totalChunks} (${offset}-${end} of ${totalSize})`)

    const command = isLastChunk ? 'upload, finalize' : 'upload'

    const response = await fetchWithTimeout(uploadUri, {
      method: 'PUT',
      headers: {
        'Content-Length': chunkBytes.length.toString(),
        'X-Goog-Upload-Offset': offset.toString(),
        'X-Goog-Upload-Command': command,
      },
      body: chunkBytes,
    }, 300000) // 5 min timeout per chunk

    if (!response.ok && !isLastChunk) {
      const errorText = await response.text()
      throw new Error(`Chunk upload failed at offset ${offset}: ${errorText}`)
    }

    lastResponse = response
    offset = end

    // No delay between chunks
  }

  if (!lastResponse) {
    throw new Error('No response from upload')
  }

  return lastResponse
}

async function processWithFileAPI(file: File, modelId: string): Promise<VideoAnalysisResult> {
  const uploadUrl = 'https://generativelanguage.googleapis.com/upload/v1beta/files'

  const mimeType = file.type || 'video/mp4'
  const fileSizeMB = (file.size / (1024 * 1024)).toFixed(2)
  const useChunkedUpload = file.size > 50 * 1024 * 1024 // Use chunked for files > 50MB

  console.log(`Starting ${useChunkedUpload ? 'chunked' : 'resumable'} upload for ${fileSizeMB}MB file...`)

  // Step 1: Initiate resumable upload
  const initResponse = await fetchWithTimeout(`${uploadUrl}?key=${GEMINI_API_KEY}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': file.size.toString(),
      'X-Goog-Upload-Header-Content-Type': mimeType,
    },
    body: JSON.stringify({
      file: {
        displayName: file.name,
      },
    }),
  }, 60000) // 1 min timeout for init

  if (!initResponse.ok) {
    const errorText = await initResponse.text()
    console.error('Upload init failed:', errorText)
    throw new Error(`Failed to initiate upload: ${errorText}`)
  }

  // Get the upload URL from the response header
  const uploadUri = initResponse.headers.get('X-Goog-Upload-URL')
  if (!uploadUri) {
    // Fallback: try simple upload for smaller files
    console.log('No resumable URL, trying simple upload...')
    return await simpleFileUpload(file, modelId)
  }

  console.log('Resumable upload URL obtained, uploading file data...')

  let uploadResponse: Response

  if (useChunkedUpload) {
    // Use chunked upload for large files
    uploadResponse = await uploadFileInChunksNonStreaming(file, uploadUri)
  } else {
    // For smaller files, upload in one go
    const buffer = await file.arrayBuffer()
    const bytes = new Uint8Array(buffer)

    uploadResponse = await fetchWithTimeout(uploadUri, {
      method: 'PUT',
      headers: {
        'Content-Length': bytes.length.toString(),
        'X-Goog-Upload-Offset': '0',
        'X-Goog-Upload-Command': 'upload, finalize',
      },
      body: bytes,
    }, 300000) // 5 min timeout
  }

  if (!uploadResponse.ok) {
    const errorText = await uploadResponse.text()
    console.error('File upload failed:', errorText)
    throw new Error(`File upload failed: ${errorText}`)
  }

  const uploadResult = await uploadResponse.json()
  console.log('Upload complete:', JSON.stringify(uploadResult, null, 2))

  const fileUri = uploadResult.file?.uri
  const fileName = uploadResult.file?.name

  if (!fileUri) {
    throw new Error('No file URI returned from upload')
  }

  // Wait for file to be processed
  if (fileName) {
    console.log('Waiting for file to be processed by Gemini...')
    await waitForFileReady(fileName, file.size)
  } else {
    // Wait longer for large files - fallback if no fileName
    const waitTime = Math.min(180000, Math.max(30000, file.size / 1000000 * 500))
    console.log(`No file name returned, waiting ${waitTime / 1000}s for file processing...`)
    await new Promise(resolve => setTimeout(resolve, waitTime))
  }

  // Now call Gemini with the file reference
  return await callGeminiAPI(fileUri, mimeType, false, modelId)
}

// Fallback simple upload for when resumable upload isn't available
async function simpleFileUpload(file: File, modelId: string): Promise<VideoAnalysisResult> {
  const uploadUrl = 'https://generativelanguage.googleapis.com/upload/v1beta/files'

  const buffer = await file.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  const mimeType = file.type || 'video/mp4'

  console.log('Using simple upload method...')

  const uploadResponse = await fetchWithTimeout(`${uploadUrl}?key=${GEMINI_API_KEY}`, {
    method: 'POST',
    headers: {
      'Content-Type': mimeType,
      'X-Goog-Upload-Command': 'upload, finalize',
      'X-Goog-Upload-Header-Content-Length': bytes.length.toString(),
      'X-Goog-Upload-Header-Content-Type': mimeType,
    },
    body: bytes,
  }, 600000) // 10 min timeout

  if (!uploadResponse.ok) {
    const errorText = await uploadResponse.text()
    console.error('Simple upload failed:', errorText)
    throw new Error(`Upload failed: ${errorText}`)
  }

  const uploadResult = await uploadResponse.json()
  const fileUri = uploadResult.file?.uri
  const fileName = uploadResult.file?.name

  if (!fileUri) {
    throw new Error('No file URI returned from upload')
  }

  if (fileName) {
    await waitForFileReady(fileName, file.size)
  } else {
    // Fallback wait time based on file size
    const waitTime = Math.min(120000, Math.max(30000, file.size / 1000000 * 500))
    console.log(`No file name returned, waiting ${waitTime / 1000}s...`)
    await new Promise(resolve => setTimeout(resolve, waitTime))
  }

  return await callGeminiAPI(fileUri, mimeType, false, modelId)
}

async function waitForFileReadyWithProgress(
  fileName: string,
  fileSizeBytes: number,
  sendEvent: (event: string, data: unknown) => void
): Promise<void> {
  const filesBaseUrl = 'https://generativelanguage.googleapis.com/v1beta'

  const fileSizeMB = fileSizeBytes / (1024 * 1024)
  const baseAttempts = 30
  const additionalAttempts = Math.ceil(fileSizeMB / 10) * 6
  const maxAttempts = Math.min(300, baseAttempts + additionalAttempts)

  let lastState = ''

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const statusUrl = `${filesBaseUrl}/${fileName}?key=${GEMINI_API_KEY}`
      const response = await quickFetch(statusUrl)

      if (response.ok) {
        const data = await response.json()

        if (data.state !== lastState) {
          lastState = data.state
          const progressPercent = 45 + Math.min(25, (attempt / maxAttempts) * 25)
          sendEvent('progress', {
            stage: 'processing',
            progress: progressPercent,
            message: `Video processing: ${data.state}...`
          })
        }

        if (data.state === 'ACTIVE') {
          return
        }

        if (data.state === 'FAILED') {
          throw new Error(`File processing failed on Gemini: ${data.error?.message || 'Unknown error'}`)
        }
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('File processing failed')) {
        throw error
      }
    }

    await new Promise(resolve => setTimeout(resolve, 2000))
  }

  throw new Error('Timeout waiting for file to be ready')
}

async function waitForFileReady(fileName: string, fileSizeBytes?: number): Promise<void> {
  const filesBaseUrl = 'https://generativelanguage.googleapis.com/v1beta'

  // Calculate max attempts based on file size
  // For large files, we need much more time - up to 15 minutes for 1GB files
  const fileSizeMB = fileSizeBytes ? fileSizeBytes / (1024 * 1024) : 100
  const baseAttempts = 45 // Minimum 1.5 minutes
  const additionalAttempts = Math.ceil(fileSizeMB / 10) * 9 // Add 18 seconds per 10MB
  const maxAttempts = Math.min(450, baseAttempts + additionalAttempts) // Max 15 minutes

  console.log(`File size: ${fileSizeMB.toFixed(2)}MB, max wait time: ${(maxAttempts * 2 / 60).toFixed(1)} minutes`)
  console.log(`File name from upload: ${fileName}`)

  let lastState = ''

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      // fileName is already in format "files/abc123", so we just append it to base URL
      const statusUrl = `${filesBaseUrl}/${fileName}?key=${GEMINI_API_KEY}`
      const response = await quickFetch(statusUrl)
      if (response.ok) {
        const data = await response.json()

        // Only log if state changed or every 10 attempts
        if (data.state !== lastState || attempt % 10 === 0) {
          console.log(`File status check ${attempt + 1}/${maxAttempts}: ${data.state}`)
          lastState = data.state
        }

        if (data.state === 'ACTIVE') {
          console.log('File is ready for processing!')
          return
        }

        if (data.state === 'FAILED') {
          const errorMsg = data.error?.message || 'Unknown error'
          throw new Error(`File processing failed on Gemini: ${errorMsg}`)
        }
      } else {
        console.log(`Status check failed with HTTP ${response.status}, retrying...`)
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('File processing failed')) {
        throw error
      }
      console.error('Error checking file status:', error)
    }

    // Wait 2 seconds between checks
    await new Promise(resolve => setTimeout(resolve, 2000))
  }

  const totalWaitTime = (maxAttempts * 2 / 60).toFixed(1)
  throw new Error(`Timeout after ${totalWaitTime} minutes waiting for file to be ready. For files over 500MB, processing can take longer. Please try again or use a shorter video.`)
}

async function callGeminiAPI(
  videoData: string,
  mimeType: string,
  isInline: boolean,
  modelId: string
): Promise<VideoAnalysisResult> {

  const GEMINI_API_URL = `${GEMINI_API_BASE}/${modelId}:generateContent`

  const systemInstruction = `You are an expert video-analysis and content-editing AI specialized in processing educational class recordings. Your task is to intelligently analyze a live class recording and extract ONLY the core learning content.

CONTENT FILTERING RULES:
1. KEEP: Core teaching content, explanations, demonstrations, important examples
2. REMOVE: 
   - Casual chit-chat and off-topic discussions
   - Q&A sessions that aren't integral to the main lesson
   - Waiting periods and setup time
   - Technical difficulties and troubleshooting
   - Repeated content or tangential conversations
   - Greetings, farewells, and administrative announcements
   - Small talk and personal anecdotes unrelated to the topic

ANALYSIS REQUIREMENTS:
1. Identify the main educational content (typically 30-40 minutes from a 1-hour recording)
2. Create timestamp markers for essential content sections
3. Document what was filtered out with categories and approximate durations
4. Generate a clean, structured script of the essential learning content
5. Create chapter breakdowns with titles and timestamps
6. Provide a summary of key concepts covered

OUTPUT FORMAT (JSON):
{
  "clean_script": "The complete cleaned teaching script with only essential educational content",
  "chapters": [
    {
      "title": "Chapter title",
      "start_time": "MM:SS",
      "end_time": "MM:SS",
      "summary": "Brief summary of this chapter",
      "key_points": ["Key point 1", "Key point 2"]
    }
  ],
  "full_session_summary": "Comprehensive summary of the entire session",
  "important_concepts": ["Concept 1", "Concept 2"],
  "recommended_practice": ["Practice item 1", "Practice item 2"],
  "content_metadata": {
    "original_duration_estimate": "Estimated total duration of the video",
    "essential_content_duration": "Duration of the core learning content",
    "content_removed_percentage": 35,
    "filtered_categories": [
      {
        "category": "Q&A Sessions",
        "description": "Student questions and answers not integral to main lesson",
        "approximate_duration": "5:30"
      }
    ],
    "main_content_timestamps": [
      {
        "start": "02:30",
        "end": "15:45",
        "description": "Introduction to main topic"
      }
    ]
  }
}

Return ONLY valid JSON, no other text or markdown.`

  // Construct parts based on inline vs file ref
  let videoPart;
  if (isInline) {
    videoPart = {
      inline_data: {
        mime_type: mimeType,
        data: videoData,
      },
    }
  } else {
    videoPart = {
      file_data: {
        mime_type: mimeType,
        file_uri: videoData,
      }
    }
  }

  const requestBody = {
    contents: [
      {
        role: 'user',
        parts: [
          videoPart,
          {
            text: systemInstruction + '\n\nAnalyze this class recording video. Extract the core educational content, filter out non-essential portions, and provide the structured JSON output with content metadata showing what was filtered. IMPORTANT: Keep the clean_script concise (max 2000 words) to avoid truncation.',
          },
        ],
      },
    ],
    generation_config: {
      temperature: 0.3,
      top_k: 32,
      top_p: 0.95,
      max_output_tokens: 65536,  // Increased to 64K to prevent truncation
      response_mime_type: 'application/json',
    },
  }

  console.log('Sending request to Gemini API...')

  // Use GEMINI_API_KEY in query param (standard for Google AI Studio)
  // Use extended timeout (15 minutes) for large video processing (1GB files)
  const response = await fetchWithTimeout(
    `${GEMINI_API_URL}?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    },
    900000 // 15 minutes timeout for large videos up to 1GB
  )

  if (!response.ok) {
    const errorData = await response.text()
    console.error('Gemini API error:', errorData)
    throw new Error(`Gemini API error: ${errorData}`)
  }

  // Handle standard JSON response (not SSE)
  const data = await response.json()

  if (!data.candidates?.[0]?.content?.parts?.[0]?.text) {
    console.error('No content in Gemini response', JSON.stringify(data, null, 2))
    throw new Error('No content received from Gemini API')
  }

  console.log('Gemini response received')
  const content = data.candidates[0].content.parts[0].text

  // Clean the response - remove markdown code blocks if present
  let cleanedContent = content.trim()
  if (cleanedContent.startsWith('```json')) {
    cleanedContent = cleanedContent.slice(7)
  } else if (cleanedContent.startsWith('```')) {
    cleanedContent = cleanedContent.slice(3)
  }
  if (cleanedContent.endsWith('```')) {
    cleanedContent = cleanedContent.slice(0, -3)
  }
  cleanedContent = cleanedContent.trim()

  // Use safe JSON parse with repair capability
  const jsonResult = safeJSONParse<VideoAnalysisResult>(cleanedContent)

  // Ensure content_metadata exists with defaults if not provided
  if (!jsonResult.content_metadata) {
    jsonResult.content_metadata = {
      original_duration_estimate: 'Unknown',
      essential_content_duration: 'Unknown',
      content_removed_percentage: 0,
      filtered_categories: [],
      main_content_timestamps: []
    }
  }

  console.log('Analysis complete')
  return jsonResult
}

// Knight API call using OpenAI-compatible format with vision
async function callKnightAPI(
  videoBase64: string,
  mimeType: string,
  modelId: string
): Promise<VideoAnalysisResult> {
  const actualModelId = getKnightModelId(modelId)

  const systemPrompt = `You are an expert video-analysis and content-editing AI specialized in processing educational class recordings. Your task is to intelligently analyze a live class recording and extract ONLY the core learning content.

CONTENT FILTERING RULES:
1. KEEP: Core teaching content, explanations, demonstrations, important examples
2. REMOVE:
   - Casual chit-chat and off-topic discussions
   - Q&A sessions that aren't integral to the main lesson
   - Waiting periods and setup time
   - Technical difficulties and troubleshooting
   - Repeated content or tangential conversations
   - Greetings, farewells, and administrative announcements
   - Small talk and personal anecdotes unrelated to the topic

ANALYSIS REQUIREMENTS:
1. Identify the main educational content (typically 30-40 minutes from a 1-hour recording)
2. Create timestamp markers for essential content sections
3. Document what was filtered out with categories and approximate durations
4. Generate a clean, structured script of the essential learning content
5. Create chapter breakdowns with titles and timestamps
6. Provide a summary of key concepts covered

You MUST respond with ONLY valid JSON in this exact format, no other text:
{
  "clean_script": "The complete cleaned teaching script with only essential educational content",
  "chapters": [
    {
      "title": "Chapter title",
      "start_time": "MM:SS",
      "end_time": "MM:SS",
      "summary": "Brief summary of this chapter",
      "key_points": ["Key point 1", "Key point 2"]
    }
  ],
  "full_session_summary": "Comprehensive summary of the entire session",
  "important_concepts": ["Concept 1", "Concept 2"],
  "recommended_practice": ["Practice item 1", "Practice item 2"],
  "content_metadata": {
    "original_duration_estimate": "Estimated total duration of the video",
    "essential_content_duration": "Duration of the core learning content",
    "content_removed_percentage": 35,
    "filtered_categories": [
      {
        "category": "Q&A Sessions",
        "description": "Student questions and answers not integral to main lesson",
        "approximate_duration": "5:30"
      }
    ],
    "main_content_timestamps": [
      {
        "start": "02:30",
        "end": "15:45",
        "description": "Introduction to main topic"
      }
    ]
  }
}`

  // OpenAI-compatible request body with vision
  const requestBody = {
    model: actualModelId,
    messages: [
      {
        role: 'system',
        content: systemPrompt
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Analyze this class recording video. Extract the core educational content, filter out non-essential portions, and provide the structured JSON output with content metadata showing what was filtered.'
          },
          {
            type: 'image_url',
            image_url: {
              url: `data:${mimeType};base64,${videoBase64}`,
              detail: 'auto'
            }
          }
        ]
      }
    ],
    temperature: 0.3,
    max_tokens: 16384,
  }

  console.log(`Sending request to Knight API with model: ${actualModelId}...`)

  // Use extended timeout (15 minutes) for large video processing
  const response = await fetchWithTimeout(
    `${KNIGHT_API_BASE}/chat/completions`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${KNIGHT_API_KEY}`,
      },
      body: JSON.stringify(requestBody),
    },
    900000 // 15 minutes timeout for large videos
  )

  if (!response.ok) {
    const errorData = await response.text()
    console.error('Knight API error:', errorData)
    throw new Error(`Knight API error: ${errorData}`)
  }

  const data = await response.json()
  console.log('Knight API response received')

  // Extract content from OpenAI-compatible response
  if (!data.choices || !data.choices[0]?.message?.content) {
    console.error('Unexpected Knight API response structure:', JSON.stringify(data, null, 2))
    throw new Error('Unexpected response from Knight API')
  }

  const content = data.choices[0].message.content

  // Clean the response - remove markdown code blocks if present
  let cleanedContent = content.trim()
  if (cleanedContent.startsWith('```json')) {
    cleanedContent = cleanedContent.slice(7)
  } else if (cleanedContent.startsWith('```')) {
    cleanedContent = cleanedContent.slice(3)
  }
  if (cleanedContent.endsWith('```')) {
    cleanedContent = cleanedContent.slice(0, -3)
  }
  cleanedContent = cleanedContent.trim()

  // Use safe JSON parse with repair capability
  const jsonResult = safeJSONParse<VideoAnalysisResult>(cleanedContent)

  // Ensure content_metadata exists with defaults if not provided
  if (!jsonResult.content_metadata) {
    jsonResult.content_metadata = {
      original_duration_estimate: 'Unknown',
      essential_content_duration: 'Unknown',
      content_removed_percentage: 0,
      filtered_categories: [],
      main_content_timestamps: []
    }
  }

  console.log('Knight API Analysis complete')
  return jsonResult
}
