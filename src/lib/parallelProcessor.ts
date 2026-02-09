/**
 * Parallel Chunk Processor
 * Manages concurrent chunk processing with queue system and progress tracking
 */

import { ChunkMetadata } from './videoChunker'
import { VideoAnalysisResult, ChunkResult } from './resultMerger'
import { getApiKeyPool } from './apiKeyPool'

export interface ChunkTask {
  chunk: ChunkMetadata
  status: 'pending' | 'uploading' | 'processing' | 'completed' | 'failed'
  progress: number
  result?: VideoAnalysisResult
  error?: string
  startTime?: number
  endTime?: number
}

export interface ParallelProcessingProgress {
  totalChunks: number
  completedChunks: number
  failedChunks: number
  activeChunks: number
  overallProgress: number
  chunks: Array<{
    index: number
    status: ChunkTask['status']
    progress: number
    elapsedTime?: number
  }>
  estimatedTimeRemaining?: number
  apiKeysStatus: {
    total: number
    available: number
    activeRequests: number
  }
}

export interface ProcessingConfig {
  apiKeyFileUris: Record<string, string> // Map of apiKey to fileUri
  mimeType: string
  modelId: string
  onProgress?: (progress: ParallelProcessingProgress) => void
  onChunkComplete?: (chunk: ChunkResult) => void
  onChunkError?: (chunkIndex: number, error: Error) => void
}

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'

/**
 * Process multiple chunks in parallel using ALL available API keys
 */
export async function processChunksInParallel(
  chunks: ChunkMetadata[],
  config: ProcessingConfig
): Promise<ChunkResult[]> {
  const pool = getApiKeyPool()
  const tasks: ChunkTask[] = chunks.map(chunk => ({
    chunk,
    status: 'pending',
    progress: 0,
  }))

  const results: ChunkResult[] = []
  const startTime = Date.now()

  // Concurrency is limited by both pool capacity and user settings
  const maxConcurrency = Math.min(
    pool.getMaxConcurrency(),
    chunks.length,
    parseInt(process.env.MAX_PARALLEL_CHUNKS || '12')
  )

  console.log(`[ParallelProcessor] Processing ${chunks.length} chunks with true parallel concurrency ${maxConcurrency}`)

  // Create progress reporter
  const reportProgress = () => {
    const completed = tasks.filter(t => t.status === 'completed').length
    const failed = tasks.filter(t => t.status === 'failed').length
    const active = tasks.filter(t => t.status === 'processing' || t.status === 'uploading').length

    const chunkProgress = tasks.reduce((sum, t) => {
      if (t.status === 'completed') return sum + 1
      if (t.status === 'failed') return sum + 1
      return sum + t.progress
    }, 0)
    const overallProgress = (chunkProgress / tasks.length) * 100

    const elapsed = Date.now() - startTime
    const completedProgress = completed + failed
    let estimatedRemaining: number | undefined
    if (completedProgress > 0) {
      const avgTimePerChunk = elapsed / completedProgress
      const remaining = tasks.length - completedProgress
      estimatedRemaining = avgTimePerChunk * remaining
    }

    const progress: ParallelProcessingProgress = {
      totalChunks: tasks.length,
      completedChunks: completed,
      failedChunks: failed,
      activeChunks: active,
      overallProgress: Math.round(overallProgress),
      chunks: tasks.map(t => ({
        index: t.chunk.index,
        status: t.status,
        progress: t.progress,
        elapsedTime: t.startTime ? (t.endTime || Date.now()) - t.startTime : undefined,
      })),
      estimatedTimeRemaining: estimatedRemaining,
      apiKeysStatus: {
        total: pool.getStatus().totalKeys,
        available: pool.getStatus().availableKeys,
        activeRequests: pool.getStatus().activeRequests,
      },
    }

    config.onProgress?.(progress)
  }

  // Process chunk with a specific API key
  const processChunkWithKey = async (task: ChunkTask, apiKey: string): Promise<ChunkResult> => {
    task.status = 'processing'
    task.startTime = Date.now()
    task.progress = 0.1
    reportProgress()

    const fileUri = config.apiKeyFileUris[apiKey]
    if (!fileUri) {
      throw new Error(`No file URI found for API key: ${apiKey.substring(0, 8)}...`)
    }

    try {
      const result = await callGeminiApi(
        apiKey,
        fileUri,
        config.mimeType,
        task.chunk,
        config.modelId,
        (progress) => {
          task.progress = progress
          reportProgress()
        }
      )

      task.status = 'completed'
      task.progress = 1
      task.endTime = Date.now()
      task.result = result
      reportProgress()

      const chunkResult: ChunkResult = {
        chunkIndex: task.chunk.index,
        chunkStartOffset: task.chunk.startTime,
        result,
      }

      config.onChunkComplete?.(chunkResult)
      return chunkResult
    } catch (error) {
      task.status = 'failed'
      task.endTime = Date.now()
      task.error = error instanceof Error ? error.message : 'Unknown error'
      reportProgress()

      config.onChunkError?.(task.chunk.index, error instanceof Error ? error : new Error(String(error)))

      return {
        chunkIndex: task.chunk.index,
        chunkStartOffset: task.chunk.startTime,
        result: createPlaceholderResult(task.chunk, task.error),
      }
    }
  }

  // Create task functions for parallel execution
  const taskFunctions = tasks.map(task => async (apiKey: string) => {
    return processChunkWithKey(task, apiKey)
  })

  // Execute all tasks with true load balancing across all keys
  const completedResults = await pool.parallelWithKeys(taskFunctions, maxConcurrency)
  results.push(...completedResults)

  // Sort by chunk index
  results.sort((a, b) => a.chunkIndex - b.chunkIndex)

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1)
  const successCount = tasks.filter(t => t.status === 'completed').length
  console.log(`[ParallelProcessor] Completed ${successCount}/${chunks.length} chunks in ${totalTime}s`)

  return results
}

/**
 * Call Gemini API to process a single chunk
 */
async function callGeminiApi(
  apiKey: string,
  fileUri: string,
  mimeType: string,
  chunk: ChunkMetadata,
  modelId: string,
  onProgress?: (progress: number) => void
): Promise<VideoAnalysisResult> {
  const url = `${GEMINI_API_BASE}/${modelId}:generateContent?key=${apiKey}`

  // Import timestamp helper
  const secondsToTimestamp = (seconds: number): string => {
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    const s = Math.floor(seconds % 60)
    if (h > 0) {
      return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
    }
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  }

  const systemInstruction = `Analyze this video segment (from ${secondsToTimestamp(chunk.startTime)} to ${secondsToTimestamp(chunk.endTime)} in the full video).

IMPORTANT RULES:
1. Use RELATIVE timestamps starting from 00:00 for this segment
2. Focus on core teaching/learning content only
3. Be concise but comprehensive

OUTPUT FORMAT (JSON only, no markdown):
{
  "clean_script": "Cleaned transcript focusing on key teaching points. Include main explanations and demonstrations.",
  "chapters": [
    {
      "title": "Chapter Title",
      "start_time": "MM:SS",
      "end_time": "MM:SS",
      "summary": "Brief chapter summary",
      "key_points": ["Point 1", "Point 2"]
    }
  ],
  "full_session_summary": "Comprehensive summary of this segment's content",
  "important_concepts": ["Concept 1", "Concept 2"],
  "recommended_practice": ["Practice item 1"],
  "content_metadata": {
    "original_duration_estimate": "${secondsToTimestamp(Math.floor(chunk.duration))}",
    "essential_content_duration": "${secondsToTimestamp(Math.floor(chunk.duration * 0.7))}",
    "content_removed_percentage": 30,
    "filtered_categories": [
      {"category": "Off-topic", "description": "Non-essential content", "approximate_duration": "01:00"}
    ],
    "main_content_timestamps": [
      {"start": "00:00", "end": "${secondsToTimestamp(Math.floor(chunk.duration))}", "description": "Main content"}
    ]
  }
}

CRITICAL: All timestamps must be in MM:SS or HH:MM:SS format. Return ONLY valid JSON.`

  const requestBody = {
    contents: [
      {
        role: 'user',
        parts: [
          {
            file_data: {
              mime_type: mimeType,
              file_uri: fileUri,
            },
          },
          {
            text: systemInstruction,
          },
        ],
      },
    ],
    generation_config: {
      temperature: 0.3,
      top_k: 32,
      top_p: 0.95,
      max_output_tokens: 16384,
      response_mime_type: 'application/json',
    },
  }

  onProgress?.(0.3)

  // 8 minute timeout per chunk
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 480000)

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    })

    clearTimeout(timeout)
    onProgress?.(0.7)

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Gemini API error: ${response.status} - ${errorText}`)
    }

    const data = await response.json()

    if (!data.candidates?.[0]?.content?.parts?.[0]?.text) {
      throw new Error('No content in Gemini response')
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

    onProgress?.(0.9)

    return JSON.parse(content.trim())
  } catch (error) {
    clearTimeout(timeout)

    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Request timed out after 8 minutes')
    }

    throw error
  }
}

/**
 * Create placeholder result for failed chunks
 */
function createPlaceholderResult(chunk: ChunkMetadata, error: string): VideoAnalysisResult {
  const secondsToTimestamp = (seconds: number): string => {
    const m = Math.floor(seconds / 60)
    const s = Math.floor(seconds % 60)
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  }

  return {
    clean_script: `[Content from ${secondsToTimestamp(chunk.startTime)} to ${secondsToTimestamp(chunk.endTime)} - ${error}]`,
    chapters: [{
      title: `Segment ${chunk.index + 1}`,
      start_time: '00:00',
      end_time: secondsToTimestamp(chunk.duration),
      summary: `Processing failed: ${error}`,
      key_points: ['Content unavailable'],
    }],
    full_session_summary: `Segment ${chunk.index + 1} processing failed: ${error}`,
    important_concepts: ['Analysis incomplete'],
    recommended_practice: ['Review this segment manually'],
    content_metadata: {
      original_duration_estimate: `${Math.floor(chunk.duration / 60)} minutes`,
      essential_content_duration: 'Unknown',
      content_removed_percentage: 0,
      filtered_categories: [],
      main_content_timestamps: [],
    },
  }
}

/**
 * Streaming chunk processor for real-time updates
 */
export class StreamingChunkProcessor {
  private chunks: ChunkTask[] = []
  private results: ChunkResult[] = []
  private config: ProcessingConfig
  private isRunning = false
  private abortController: AbortController | null = null

  constructor(chunks: ChunkMetadata[], config: ProcessingConfig) {
    this.chunks = chunks.map(chunk => ({
      chunk,
      status: 'pending',
      progress: 0,
    }))
    this.config = config
  }

  /**
   * Start processing all chunks
   */
  async start(): Promise<ChunkResult[]> {
    if (this.isRunning) {
      throw new Error('Processing already in progress')
    }

    this.isRunning = true
    this.abortController = new AbortController()

    try {
      this.results = await processChunksInParallel(
        this.chunks.map(t => t.chunk),
        this.config
      )
      return this.results
    } finally {
      this.isRunning = false
    }
  }

  /**
   * Cancel processing
   */
  cancel(): void {
    if (this.abortController) {
      this.abortController.abort()
    }
    this.isRunning = false
  }

  /**
   * Get current status
   */
  getStatus(): ParallelProcessingProgress {
    const pool = getApiKeyPool()
    const completed = this.chunks.filter(t => t.status === 'completed').length
    const failed = this.chunks.filter(t => t.status === 'failed').length
    const active = this.chunks.filter(t => t.status === 'processing').length

    return {
      totalChunks: this.chunks.length,
      completedChunks: completed,
      failedChunks: failed,
      activeChunks: active,
      overallProgress: Math.round(((completed + failed) / this.chunks.length) * 100),
      chunks: this.chunks.map(t => ({
        index: t.chunk.index,
        status: t.status,
        progress: t.progress,
      })),
      apiKeysStatus: {
        total: pool.getStatus().totalKeys,
        available: pool.getStatus().availableKeys,
        activeRequests: pool.getStatus().activeRequests,
      },
    }
  }
}
