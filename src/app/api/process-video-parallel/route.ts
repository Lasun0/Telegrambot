import { NextRequest } from 'next/server'
import { calculateChunkStrategy, estimateVideoDuration, secondsToTimestamp } from '@/lib/videoChunker'
import { mergeChunkResults, ChunkResult } from '@/lib/resultMerger'
import { getApiKeyPool } from '@/lib/apiKeyPool'
import { processChunksInParallel, ParallelProcessingProgress } from '@/lib/parallelProcessor'

// Configuration
const CHUNK_DURATION_MINUTES = parseInt(process.env.CHUNK_SIZE_MINUTES || '5')

export const runtime = 'nodejs'
export const maxDuration = 900 // 15 minutes

// SSE helper with improved reliability
function createSSEStream() {
  const encoder = new TextEncoder()
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null
  let isClosed = false

  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c
    },
    cancel() {
      isClosed = true
    },
  })

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

  return { stream, sendEvent, close, isClosed: () => isClosed }
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
  const { stream, sendEvent, close, isClosed } = createSSEStream()

  // Keep-alive heartbeat
  let heartbeatInterval: NodeJS.Timeout | null = null
  let lastProgressUpdate = Date.now()

  const startHeartbeat = () => {
    heartbeatInterval = setInterval(() => {
      if (Date.now() - lastProgressUpdate > 15000) {
        sendEvent('heartbeat', { timestamp: Date.now() })
      }
    }, 15000)
  }

  const stopHeartbeat = () => {
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval)
      heartbeatInterval = null
    }
  }

  const updateProgress = (event: string, data: unknown) => {
    if (!isClosed()) {
      lastProgressUpdate = Date.now()
      sendEvent(event, data)
    }
  }

  // Process in background
  ;(async () => {
    try {
      const pool = getApiKeyPool()
      const poolStatus = pool.getStatus()

      if (poolStatus.totalKeys === 0) {
        sendEvent('error', { message: 'No API keys configured. Add GEMINI_API_KEY or GEMINI_API_KEYS to .env.local' })
        close()
        return
      }

      startHeartbeat()

      updateProgress('progress', {
        stage: 'initializing',
        progress: 2,
        message: `Initializing parallel processing with ${poolStatus.totalKeys} API key(s)...`,
        parallelInfo: {
          apiKeys: poolStatus.totalKeys,
          maxConcurrency: pool.getMaxConcurrency(),
        },
      })

      const formData = await request.formData()
      const file = formData.get('video') as File
      const modelId = (formData.get('model') as string) || 'gemini-1.5-flash'
      const chunkDuration = parseInt((formData.get('chunkDuration') as string) || CHUNK_DURATION_MINUTES.toString())

      if (!file) {
        sendEvent('error', { message: 'No video file provided' })
        stopHeartbeat()
        close()
        return
      }

      const fileSizeMB = (file.size / (1024 * 1024)).toFixed(2)
      console.log(`[ParallelAPI] Processing ${file.name}: ${fileSizeMB}MB with ${chunkDuration}min chunks`)
      console.log(`[ParallelAPI] Using ${poolStatus.totalKeys} API key(s), max concurrency: ${pool.getMaxConcurrency()}`)

      // Calculate chunks
      const estimatedDurationSec = estimateVideoDuration(file.size)
      const chunks = calculateChunkStrategy(file, estimatedDurationSec, {
        chunkDurationMinutes: chunkDuration,
      })

      updateProgress('progress', {
        stage: 'planning',
        progress: 5,
        message: `Video will be split into ${chunks.length} chunks of ~${chunkDuration} minutes`,
        chunkInfo: {
          total: chunks.length,
          durationMinutes: chunkDuration,
          estimatedTotalDuration: Math.round(estimatedDurationSec / 60),
        },
      })

      // Upload the video to ALL API keys in parallel
      updateProgress('progress', {
        stage: 'uploading',
        progress: 8,
        message: 'Uploading video to multiple Gemini API keys for faster parallel processing...',
      })

      const allApiKeys = pool.getKeys()
      console.log(`[ParallelAPI] Uploading to ${allApiKeys.length} API keys in parallel`)

      const uploadResults = await Promise.all(
        allApiKeys.map(async (key, index) => {
          // Only report progress for the first key to avoid jumping UI
          const onKeyProgress = index === 0 ? (progress: number) => {
            updateProgress('progress', {
              stage: 'uploading',
              progress: 8 + progress * 32, // 8-40%
              message: `Uploading: ${Math.round(progress * 100)}%`,
            })
          } : undefined

          const fileUri = await uploadVideoToSpecificKey(file, key, onKeyProgress)
          return { key, fileUri }
        })
      )

      const apiKeyFileUris: Record<string, string> = {}
      uploadResults.forEach(res => {
        apiKeyFileUris[res.key] = res.fileUri
      })

      updateProgress('progress', {
        stage: 'processing',
        progress: 42,
        message: 'Uploads complete. Starting true parallel chunk processing across all keys...',
        parallelInfo: {
          totalChunks: chunks.length,
          maxConcurrency: pool.getMaxConcurrency(),
        },
      })

      // Process chunks in parallel using ALL API keys with their respective file URIs
      const startTime = Date.now()
      const chunkResults = await processChunksInParallel(chunks, {
        apiKeyFileUris, // Provide the mapping of key to file URI
        mimeType: file.type || 'video/mp4',
        modelId,
        onProgress: (parallelProgress: ParallelProcessingProgress) => {
          // Map parallel progress to overall progress (42-90%)
          const overallProgress = 42 + (parallelProgress.overallProgress * 0.48)

          updateProgress('progress', {
            stage: 'processing',
            progress: Math.round(overallProgress),
            message: `Processing chunks: ${parallelProgress.completedChunks}/${parallelProgress.totalChunks} complete, ${parallelProgress.activeChunks} active`,
            parallelProgress: {
              ...parallelProgress,
              elapsedSeconds: Math.round((Date.now() - startTime) / 1000),
            },
          })
        },
        onChunkComplete: (result) => {
          updateProgress('chunkComplete', {
            chunkIndex: result.chunkIndex,
            chunkStartOffset: result.chunkStartOffset,
          })
        },
        onChunkError: (chunkIndex, error) => {
          updateProgress('chunkError', {
            chunkIndex,
            error: error.message,
          })
        },
      })

      const processingTime = ((Date.now() - startTime) / 1000).toFixed(1)
      console.log(`[ParallelAPI] All chunks processed in ${processingTime}s`)

      // Merge results
      updateProgress('progress', {
        stage: 'merging',
        progress: 92,
        message: 'Merging chunk results...',
      })

      const finalResult = mergeChunkResults(chunkResults)

      updateProgress('progress', {
        stage: 'complete',
        progress: 98,
        message: 'Finalizing results...',
      })

      // Add processing metadata
      const enrichedResult = {
        ...finalResult,
        processing_metadata: {
          parallel: true,
          total_chunks: chunks.length,
          chunk_duration_minutes: chunkDuration,
          api_keys_used: poolStatus.totalKeys,
          max_concurrency: pool.getMaxConcurrency(),
          processing_time_seconds: parseFloat(processingTime),
          successful_chunks: chunkResults.filter(r => !r.result.clean_script.includes('failed')).length,
          failed_chunks: chunkResults.filter(r => r.result.clean_script.includes('failed')).length,
        },
      }

      sendEvent('complete', enrichedResult)
      stopHeartbeat()
      close()

    } catch (error) {
      console.error('[ParallelAPI] Error:', error)
      sendEvent('error', { message: error instanceof Error ? error.message : 'Unknown error' })
      stopHeartbeat()
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
    const pool = getApiKeyPool()
    const poolStatus = pool.getStatus()

    if (poolStatus.totalKeys === 0) {
      return Response.json({ error: 'No API keys configured' }, { status: 500 })
    }

    const formData = await request.formData()
    const file = formData.get('video') as File
    const modelId = (formData.get('model') as string) || 'gemini-1.5-flash'
    const chunkDuration = parseInt((formData.get('chunkDuration') as string) || CHUNK_DURATION_MINUTES.toString())

    if (!file) {
      return Response.json({ error: 'No video file provided' }, { status: 400 })
    }

    console.log(`[ParallelAPI] Processing ${file.name} with ${chunkDuration}min chunks`)

    // Calculate chunks
    const estimatedDurationSec = estimateVideoDuration(file.size)
    const chunks = calculateChunkStrategy(file, estimatedDurationSec, {
      chunkDurationMinutes: chunkDuration,
    })

    // Upload to all Gemini API keys in parallel
    const allApiKeys = pool.getKeys()
    const uploadResults = await Promise.all(
      allApiKeys.map(async (key) => {
        const fileUri = await uploadVideoToSpecificKey(file, key)
        return { key, fileUri }
      })
    )

    const apiKeyFileUris: Record<string, string> = {}
    uploadResults.forEach(res => {
      apiKeyFileUris[res.key] = res.fileUri
    })

    // Process chunks in parallel using all keys
    const startTime = Date.now()
    const chunkResults = await processChunksInParallel(chunks, {
      apiKeyFileUris,
      mimeType: file.type || 'video/mp4',
      modelId,
    })

    // Merge results
    const finalResult = mergeChunkResults(chunkResults)

    // Add metadata
    const processingTime = ((Date.now() - startTime) / 1000).toFixed(1)
    const enrichedResult = {
      ...finalResult,
      processing_metadata: {
        parallel: true,
        total_chunks: chunks.length,
        chunk_duration_minutes: chunkDuration,
        api_keys_used: poolStatus.totalKeys,
        processing_time_seconds: parseFloat(processingTime),
      },
    }

    return Response.json(enrichedResult)

  } catch (error) {
    console.error('[ParallelAPI] Error:', error)
    return Response.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

/**
 * Upload video to a specific Gemini File API key
 */
async function uploadVideoToSpecificKey(
  file: File,
  apiKey: string,
  onProgress?: (progress: number) => void
): Promise<string> {
  try {
    const uploadUrl = 'https://generativelanguage.googleapis.com/upload/v1beta/files'
    const mimeType = file.type || 'video/mp4'

    // Initiate resumable upload
    const initResponse = await fetch(`${uploadUrl}?key=${apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Upload-Protocol': 'resumable',
        'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Length': file.size.toString(),
        'X-Goog-Upload-Header-Content-Type': mimeType,
      },
      body: JSON.stringify({
        file: { displayName: file.name },
      }),
    })

    if (!initResponse.ok) {
      throw new Error(`Failed to initiate upload for key: ${await initResponse.text()}`)
    }

    const uploadUri = initResponse.headers.get('X-Goog-Upload-URL')
    if (!uploadUri) {
      throw new Error('No upload URL returned')
    }

    onProgress?.(0.2)

    // Upload the file
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
      throw new Error(`File upload failed: ${await uploadResponse.text()}`)
    }

    onProgress?.(0.8)

    const uploadResult = await uploadResponse.json()
    const fileUri = uploadResult.file?.uri
    const fileName = uploadResult.file?.name

    if (!fileUri) {
      throw new Error('No file URI returned from upload')
    }

    // Wait for file processing
    if (fileName) {
      await waitForFileReady(fileName, file.size, apiKey)
    } else {
      const waitTime = Math.min(180000, Math.max(30000, file.size / 1000000 * 500))
      await new Promise(resolve => setTimeout(resolve, waitTime))
    }

    onProgress?.(1.0)
    return fileUri

  } catch (error) {
    console.error(`[ParallelAPI] Upload failed for key ${apiKey.substring(0, 8)}...:`, error)
    throw error
  }
}

/**
 * Upload video to Gemini File API
 * Returns both the file URI and the API key used (needed for chunk processing)
 */
async function uploadVideoToGemini(
  file: File,
  onProgress?: (progress: number) => void
): Promise<{ fileUri: string; apiKey: string }> {
  const pool = getApiKeyPool()
  const apiKey = await pool.acquireKey()

  if (!apiKey) {
    throw new Error('No API keys available for upload')
  }

  try {
    const uploadUrl = 'https://generativelanguage.googleapis.com/upload/v1beta/files'
    const mimeType = file.type || 'video/mp4'

    console.log(`[ParallelAPI] Starting upload for ${(file.size / (1024 * 1024)).toFixed(2)}MB file`)
    console.log(`[ParallelAPI] Using API key for upload (will use same key for all chunks)`)

    // Initiate resumable upload
    const initResponse = await fetch(`${uploadUrl}?key=${apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Upload-Protocol': 'resumable',
        'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Length': file.size.toString(),
        'X-Goog-Upload-Header-Content-Type': mimeType,
      },
      body: JSON.stringify({
        file: { displayName: file.name },
      }),
    })

    if (!initResponse.ok) {
      throw new Error(`Failed to initiate upload: ${await initResponse.text()}`)
    }

    const uploadUri = initResponse.headers.get('X-Goog-Upload-URL')
    if (!uploadUri) {
      throw new Error('No upload URL returned')
    }

    onProgress?.(0.2)

    // Upload the file
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
      throw new Error(`File upload failed: ${await uploadResponse.text()}`)
    }

    onProgress?.(0.8)

    const uploadResult = await uploadResponse.json()
    const fileUri = uploadResult.file?.uri
    const fileName = uploadResult.file?.name

    if (!fileUri) {
      throw new Error('No file URI returned from upload')
    }

    // Wait for file processing
    if (fileName) {
      await waitForFileReady(fileName, file.size, apiKey)
    } else {
      const waitTime = Math.min(180000, Math.max(30000, file.size / 1000000 * 500))
      await new Promise(resolve => setTimeout(resolve, waitTime))
    }

    onProgress?.(1.0)
    // Don't release the key - we'll use it for all chunk processing
    // pool.releaseKey(apiKey)

    return { fileUri, apiKey }

  } catch (error) {
    pool.releaseKey(apiKey, true)
    throw error
  }
}

/**
 * Wait for Gemini to process the uploaded file
 */
async function waitForFileReady(fileName: string, fileSizeBytes: number, apiKey: string): Promise<void> {
  const filesBaseUrl = 'https://generativelanguage.googleapis.com/v1beta'

  const fileSizeMB = fileSizeBytes / (1024 * 1024)
  const baseAttempts = 45
  const additionalAttempts = Math.ceil(fileSizeMB / 10) * 9
  const maxAttempts = Math.min(450, baseAttempts + additionalAttempts)

  console.log(`[ParallelAPI] Waiting for file processing: ${fileSizeMB.toFixed(2)}MB, max ${(maxAttempts * 2 / 60).toFixed(1)} min`)

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const response = await fetch(`${filesBaseUrl}/${fileName}?key=${apiKey}`)

      if (response.ok) {
        const data = await response.json()

        if (data.state === 'ACTIVE') {
          console.log('[ParallelAPI] File is ready!')
          return
        }

        if (data.state === 'FAILED') {
          throw new Error(`File processing failed: ${data.error?.message || 'Unknown error'}`)
        }
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('File processing failed')) {
        throw error
      }
    }

    await new Promise(resolve => setTimeout(resolve, 2000))
  }

  throw new Error(`Timeout waiting for file to be ready`)
}
