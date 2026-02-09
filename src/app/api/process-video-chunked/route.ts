import { NextRequest } from 'next/server'
import { calculateChunkStrategy, estimateVideoDuration, secondsToTimestamp } from '@/lib/videoChunker'
import { mergeChunkResults, ChunkResult, VideoAnalysisResult } from '@/lib/resultMerger'

// Import the existing Gemini API call function
// We'll reuse the same processing logic but on chunks
const GEMINI_API_KEY = process.env.GEMINI_API_KEY
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'

// Configuration
const CHUNK_DURATION_MINUTES = parseInt(process.env.CHUNK_SIZE_MINUTES || '20')
const MAX_CONCURRENT_CHUNKS = parseInt(process.env.MAX_CONCURRENT_CHUNKS || '3')
const ENABLE_FINAL_MERGE_PASS = process.env.ENABLE_SUMMARY_MERGE_PASS === 'true'

export const runtime = 'nodejs'
export const maxDuration = 900 // 15 minutes

// SSE helper
function createSSEStream() {
  const encoder = new TextEncoder()
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null

  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c
    }
  })

  let isClosed = false

  const sendEvent = (event: string, data: unknown) => {
    if (controller && !isClosed) {
      try {
        const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
        controller.enqueue(encoder.encode(message))
      } catch (error) {
        console.error('[SSE] Failed to send event:', error)
        isClosed = true
      }
    }
  }

  const close = () => {
    if (controller && !isClosed) {
      try {
        controller.close()
        isClosed = true
      } catch (error) {
        console.error('[SSE] Failed to close stream:', error)
        isClosed = true
      }
    }
  }

  return { stream, sendEvent, close }
}

export async function POST(request: NextRequest) {
  const acceptsSSE = request.headers.get('accept')?.includes('text/event-stream')

  if (acceptsSSE) {
    return handleStreamingRequest(request)
  } else {
    return handleNormalRequest(request)
  }
}

async function handleStreamingRequest(request: NextRequest) {
  const { stream, sendEvent, close } = createSSEStream()

  // Keep-alive heartbeat to prevent connection timeout
  let heartbeatInterval: NodeJS.Timeout | null = null
  let lastProgressUpdate = Date.now()
  
  const startHeartbeat = () => {
    heartbeatInterval = setInterval(() => {
      // Send heartbeat every 15 seconds if no progress update
      if (Date.now() - lastProgressUpdate > 15000) {
        sendEvent('heartbeat', { timestamp: Date.now() })
      }
    }, 15000)
  }

  const updateProgress = (event: string, data: unknown) => {
    lastProgressUpdate = Date.now()
    sendEvent(event, data)
  }

  // Process in background
  ;(async () => {
    try {
      if (!GEMINI_API_KEY) {
        sendEvent('error', { message: 'Gemini API key not configured' })
        close()
        return
      }

      startHeartbeat()

      updateProgress('progress', { stage: 'initializing', progress: 5, message: 'Preparing chunked processing...' })

      const formData = await request.formData()
      const file = formData.get('video') as File
      const modelId = (formData.get('model') as string) || 'gemini-1.5-flash'
      const chunkDuration = parseInt((formData.get('chunkDuration') as string) || CHUNK_DURATION_MINUTES.toString())

      if (!file) {
        sendEvent('error', { message: 'No video file provided' })
        if (heartbeatInterval) clearInterval(heartbeatInterval)
        close()
        return
      }

      const fileSizeMB = (file.size / (1024 * 1024)).toFixed(2)
      console.log(`[Chunked] Processing ${file.name}: ${fileSizeMB}MB with ${chunkDuration}min chunks`)

      // Estimate video duration
      const estimatedDurationSec = estimateVideoDuration(file.size)
      const chunks = calculateChunkStrategy(file, estimatedDurationSec, {
        chunkDurationMinutes: chunkDuration
      })

      updateProgress('progress', {
        stage: 'planning',
        progress: 10,
        message: `Video will be split into ${chunks.length} chunks of ~${chunkDuration} minutes each`
      })

      console.log(`[Chunked] Calculated ${chunks.length} chunks:`, chunks)

      // Upload the full video to Gemini File API
      updateProgress('progress', {
        stage: 'uploading',
        progress: 15,
        message: 'Uploading video to Gemini...'
      })

      const uploadedFileUri = await uploadVideoToGemini(file, (progress) => {
        updateProgress('progress', {
          stage: 'uploading',
          progress: 15 + progress * 0.35, // 15-50%
          message: `Uploading: ${Math.round(progress * 100)}%`
        })
      })

      updateProgress('progress', {
        stage: 'processing',
        progress: 50,
        message: 'Video uploaded. Starting chunk processing...'
      })

      // Process chunks in parallel batches
      const chunkResults: ChunkResult[] = []
      const totalChunks = chunks.length
      
      for (let i = 0; i < chunks.length; i += MAX_CONCURRENT_CHUNKS) {
        const batch = chunks.slice(i, i + MAX_CONCURRENT_CHUNKS)
        const batchNum = Math.floor(i / MAX_CONCURRENT_CHUNKS) + 1
        const totalBatches = Math.ceil(chunks.length / MAX_CONCURRENT_CHUNKS)

        updateProgress('progress', {
          stage: 'processing',
          progress: 50 + ((i / totalChunks) * 40),
          message: `Processing batch ${batchNum}/${totalBatches} (chunks ${i + 1}-${i + batch.length})...`
        })

        // Process batch in parallel with progress updates
        const batchPromises = batch.map(async (chunk) => {
          console.log(`[Chunked] Processing chunk ${chunk.index + 1}/${totalChunks}`)
          
          // Send update when starting each chunk
          updateProgress('progress', {
            stage: 'processing',
            progress: 50 + ((i + chunk.index - batch[0].index) / totalChunks * 40),
            message: `Analyzing chunk ${chunk.index + 1}/${totalChunks}...`
          })
          
          const result = await processChunk(
            uploadedFileUri,
            file.type,
            chunk,
            modelId,
            (chunkProgress) => {
              // Send progress updates during chunk processing
              updateProgress('progress', {
                stage: 'processing',
                progress: 50 + ((i + chunk.index - batch[0].index + chunkProgress) / totalChunks * 40),
                message: `Analyzing chunk ${chunk.index + 1}/${totalChunks} (${Math.round(chunkProgress * 100)}%)...`
              })
            }
          )

          return {
            chunkIndex: chunk.index,
            chunkStartOffset: chunk.startTime,
            result
          } as ChunkResult
        })

        const batchResults = await Promise.all(batchPromises)
        chunkResults.push(...batchResults)

        updateProgress('progress', {
          stage: 'processing',
          progress: 50 + (((i + batch.length) / totalChunks) * 40),
          message: `Completed ${i + batch.length}/${totalChunks} chunks`
        })
      }

      // Merge results
      sendEvent('progress', {
        stage: 'merging',
        progress: 90,
        message: 'Merging chunk results...'
      })

      const finalResult = mergeChunkResults(chunkResults)

      sendEvent('progress', {
        stage: 'complete',
        progress: 95,
        message: 'Finalizing...'
      })

      // Add chunked processing metadata
      const enrichedResult = {
        ...finalResult,
        processing_metadata: {
          chunked: true,
          total_chunks: chunks.length,
          chunk_duration_minutes: chunkDuration,
          processing_time: 'N/A'
        }
      }

      sendEvent('complete', enrichedResult)
      close()

    } catch (error) {
      console.error('[Chunked] Error:', error)
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
    if (!GEMINI_API_KEY) {
      return Response.json({ error: 'Gemini API key not configured' }, { status: 500 })
    }

    const formData = await request.formData()
    const file = formData.get('video') as File
    const modelId = (formData.get('model') as string) || 'gemini-1.5-flash'
    const chunkDuration = parseInt((formData.get('chunkDuration') as string) || CHUNK_DURATION_MINUTES.toString())

    if (!file) {
      return Response.json({ error: 'No video file provided' }, { status: 400 })
    }

    console.log(`[Chunked] Processing ${file.name} with ${chunkDuration}min chunks`)

    // Calculate chunks
    const estimatedDurationSec = estimateVideoDuration(file.size)
    const chunks = calculateChunkStrategy(file, estimatedDurationSec, {
      chunkDurationMinutes: chunkDuration
    })

    console.log(`[Chunked] Will process ${chunks.length} chunks`)

    // Upload to Gemini
    const uploadedFileUri = await uploadVideoToGemini(file)

    // Process chunks in parallel batches
    const chunkResults: ChunkResult[] = []
    
    for (let i = 0; i < chunks.length; i += MAX_CONCURRENT_CHUNKS) {
      const batch = chunks.slice(i, i + MAX_CONCURRENT_CHUNKS)
      
      const batchPromises = batch.map(async (chunk) => {
        const result = await processChunk(
          uploadedFileUri,
          file.type,
          chunk,
          modelId
        )

        return {
          chunkIndex: chunk.index,
          chunkStartOffset: chunk.startTime,
          result
        } as ChunkResult
      })

      const batchResults = await Promise.all(batchPromises)
      chunkResults.push(...batchResults)
    }

    // Merge results
    const finalResult = mergeChunkResults(chunkResults)

    // Add metadata
    const enrichedResult = {
      ...finalResult,
      processing_metadata: {
        chunked: true,
        total_chunks: chunks.length,
        chunk_duration_minutes: chunkDuration
      }
    }

    return Response.json(enrichedResult)

  } catch (error) {
    console.error('[Chunked] Error:', error)
    return Response.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

/**
 * Upload video to Gemini File API using resumable upload
 */
async function uploadVideoToGemini(
  file: File,
  onProgress?: (progress: number) => void
): Promise<string> {
  const uploadUrl = 'https://generativelanguage.googleapis.com/upload/v1beta/files'
  const mimeType = file.type || 'video/mp4'

  console.log(`[Chunked] Starting upload for ${(file.size / (1024 * 1024)).toFixed(2)}MB file`)

  // Step 1: Initiate resumable upload
  const initResponse = await fetch(`${uploadUrl}?key=${GEMINI_API_KEY}`, {
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
  })

  if (!initResponse.ok) {
    const errorText = await initResponse.text()
    throw new Error(`Failed to initiate upload: ${errorText}`)
  }

  const uploadUri = initResponse.headers.get('X-Goog-Upload-URL')
  if (!uploadUri) {
    throw new Error('No upload URL returned')
  }

  console.log(`[Chunked] Upload URL obtained, uploading file...`)
  onProgress?.(0.2)

  // Step 2: Upload the file
  const buffer = await file.arrayBuffer()
  const bytes = new Uint8Array(buffer)

  onProgress?.(0.5)

  const uploadResponse = await fetch(uploadUri, {
    method: 'PUT',
    headers: {
      'Content-Length': bytes.length.toString(),
      'X-Goog-Upload-Offset': '0',
      'X-Goog-Upload-Command': 'upload, finalize',
    },
    body: bytes,
  })

  if (!uploadResponse.ok) {
    const errorText = await uploadResponse.text()
    throw new Error(`File upload failed: ${errorText}`)
  }

  onProgress?.(0.9)

  const uploadResult = await uploadResponse.json()
  console.log(`[Chunked] Upload complete:`, uploadResult)

  const fileUri = uploadResult.file?.uri
  const fileName = uploadResult.file?.name

  if (!fileUri) {
    throw new Error('No file URI returned from upload')
  }

  // Wait for processing with proper timeout for large files
  if (fileName) {
    console.log(`[Chunked] Waiting for Gemini to process file...`)
    await waitForFileReady(fileName, file.size)
  } else {
    // Fallback: wait based on file size
    const waitTime = Math.min(180000, Math.max(30000, file.size / 1000000 * 500))
    console.log(`[Chunked] No fileName, waiting ${waitTime / 1000}s for processing...`)
    await new Promise(resolve => setTimeout(resolve, waitTime))
  }

  onProgress?.(1.0)
  console.log(`[Chunked] File ready for processing: ${fileUri}`)

  return fileUri
}

/**
 * Wait for Gemini to process the uploaded file with dynamic timeout
 */
async function waitForFileReady(fileName: string, fileSizeBytes: number): Promise<void> {
  const filesBaseUrl = 'https://generativelanguage.googleapis.com/v1beta'
  
  // Calculate max wait time based on file size
  // Large files need more time: ~500ms per MB
  const fileSizeMB = fileSizeBytes / (1024 * 1024)
  const baseAttempts = 45 // 1.5 minutes minimum
  const additionalAttempts = Math.ceil(fileSizeMB / 10) * 9 // 18 seconds per 10MB
  const maxAttempts = Math.min(450, baseAttempts + additionalAttempts) // Max 15 minutes

  console.log(`[Chunked] File size: ${fileSizeMB.toFixed(2)}MB, max wait: ${(maxAttempts * 2 / 60).toFixed(1)} minutes`)

  let lastState = ''

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const statusUrl = `${filesBaseUrl}/${fileName}?key=${GEMINI_API_KEY}`
      const response = await fetch(statusUrl)

      if (response.ok) {
        const data = await response.json()

        // Log state changes
        if (data.state !== lastState || attempt % 10 === 0) {
          console.log(`[Chunked] File status check ${attempt + 1}/${maxAttempts}: ${data.state}`)
          lastState = data.state
        }

        if (data.state === 'ACTIVE') {
          console.log('[Chunked] File is ready!')
          return
        }

        if (data.state === 'FAILED') {
          throw new Error(`File processing failed: ${data.error?.message || 'Unknown error'}`)
        }

        // PROCESSING state is expected - continue waiting
      } else {
        console.log(`[Chunked] Status check failed with HTTP ${response.status}, retrying...`)
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('File processing failed')) {
        throw error
      }
      console.error('[Chunked] Error checking file status:', error)
    }

    // Wait 2 seconds between checks
    await new Promise(resolve => setTimeout(resolve, 2000))
  }

  const totalWaitTime = (maxAttempts * 2 / 60).toFixed(1)
  throw new Error(`Timeout after ${totalWaitTime} minutes waiting for file to be ready. Large files may need more processing time.`)
}

/**
 * Process a single chunk using Gemini API with timeout handling
 */
async function processChunk(
  fileUri: string,
  mimeType: string,
  chunk: { index: number; startTime: number; endTime: number; duration: number },
  modelId: string,
  onProgress?: (progress: number) => void
): Promise<VideoAnalysisResult> {
  const GEMINI_API_URL = `${GEMINI_API_BASE}/${modelId}:generateContent`

  // Simplified, faster prompt focusing on key information
  const systemInstruction = `Analyze this video segment (${secondsToTimestamp(chunk.startTime)} to ${secondsToTimestamp(chunk.endTime)}).

RULES:
1. Use RELATIVE timestamps (start from 00:00)
2. Keep only core teaching content
3. Be concise

OUTPUT (JSON):
{
  "clean_script": "Brief cleaned transcript focusing on key teaching points",
  "chapters": [{"title": "Topic", "start_time": "00:00", "end_time": "10:00", "summary": "Brief", "key_points": ["Point 1"]}],
  "full_session_summary": "Brief segment summary",
  "important_concepts": ["Concept 1", "Concept 2"],
  "recommended_practice": ["Practice 1"],
  "content_metadata": {
    "original_duration_estimate": "${Math.floor(chunk.duration / 60)} minutes",
    "essential_content_duration": "~${Math.floor(chunk.duration * 0.7 / 60)} minutes",
    "content_removed_percentage": 30,
    "filtered_categories": [{"category": "Non-essential content", "description": "Removed filler", "approximate_duration": "~5 min"}],
    "main_content_timestamps": [{"start": "00:00", "end": "${secondsToTimestamp(chunk.duration)}", "description": "Main teaching"}]
  }
}

Analyze segment from ${secondsToTimestamp(chunk.startTime)} to ${secondsToTimestamp(chunk.endTime)}. Return ONLY JSON.`

  const requestBody = {
    contents: [
      {
        role: 'user',
        parts: [
          {
            file_data: {
              mime_type: mimeType,
              file_uri: fileUri
            }
          },
          {
            text: systemInstruction
          }
        ]
      }
    ],
    generation_config: {
      temperature: 0.3,
      top_k: 32,
      top_p: 0.95,
      max_output_tokens: 16384, // Reduced for faster response
      response_mime_type: 'application/json',
    }
  }

  console.log(`[Chunked] Starting analysis of chunk ${chunk.index + 1} (${secondsToTimestamp(chunk.duration)} long)...`)
  const startTime = Date.now()

  // Add timeout to fetch - 8 minutes max per chunk
  const controller = new AbortController()
  const timeout = setTimeout(() => {
    controller.abort()
    console.log(`[Chunked] Chunk ${chunk.index + 1} analysis timed out after 8 minutes`)
  }, 480000) // 8 minutes

  try {
    const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    })

    clearTimeout(timeout)

    if (!response.ok) {
      const errorData = await response.text()
      throw new Error(`Gemini API error for chunk ${chunk.index}: ${errorData}`)
    }

    const data = await response.json()

    if (!data.candidates?.[0]?.content?.parts?.[0]?.text) {
      throw new Error(`No content in response for chunk ${chunk.index}`)
    }

    let content = data.candidates[0].content.parts[0].text.trim()
    
    // Clean markdown code blocks
    if (content.startsWith('```json')) {
      content = content.slice(7)
    } else if (content.startsWith('```')) {
      content = content.slice(3)
    }
    if (content.endsWith('```')) {
      content = content.slice(0, -3)
    }

    const result = JSON.parse(content.trim())
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
    console.log(`[Chunked] Chunk ${chunk.index + 1} completed in ${elapsed}s`)
    
    return result
  } catch (error) {
    clearTimeout(timeout)
    
    if (error instanceof Error && error.name === 'AbortError') {
      // Return a minimal placeholder result if timeout
      console.warn(`[Chunked] Chunk ${chunk.index + 1} timed out, using placeholder`)
      return {
        clean_script: `[Content from ${secondsToTimestamp(chunk.startTime)} to ${secondsToTimestamp(chunk.endTime)} - Analysis timed out]`,
        chapters: [{
          title: `Segment ${chunk.index + 1}`,
          start_time: "00:00",
          end_time: secondsToTimestamp(chunk.duration),
          summary: "Analysis timed out for this segment",
          key_points: ["Content unavailable due to timeout"]
        }],
        full_session_summary: `Segment ${chunk.index + 1} analysis timed out`,
        important_concepts: ["Analysis incomplete"],
        recommended_practice: ["Review this segment manually"],
        content_metadata: {
          original_duration_estimate: `${Math.floor(chunk.duration / 60)} minutes`,
          essential_content_duration: "Unknown",
          content_removed_percentage: 0,
          filtered_categories: [],
          main_content_timestamps: []
        }
      }
    }
    
    throw error
  }
}
