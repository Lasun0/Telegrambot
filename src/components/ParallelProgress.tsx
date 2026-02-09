'use client'

import { useState, useCallback, useRef, useEffect } from 'react'

interface ChunkProgress {
  index: number
  status: 'pending' | 'uploading' | 'processing' | 'completed' | 'failed'
  progress: number
  elapsedTime?: number
}

interface ParallelProgressData {
  totalChunks: number
  completedChunks: number
  failedChunks: number
  activeChunks: number
  overallProgress: number
  chunks: ChunkProgress[]
  estimatedTimeRemaining?: number
  elapsedSeconds?: number
  apiKeysStatus?: {
    total: number
    available: number
    activeRequests: number
  }
}

interface ParallelProgressProps {
  progress: ParallelProgressData
  stage: string
  message: string
}

export default function ParallelProgress({ progress, stage, message }: ParallelProgressProps) {
  const [elapsedTime, setElapsedTime] = useState(0)
  const startTimeRef = useRef(Date.now())

  // Update elapsed time every second
  useEffect(() => {
    const interval = setInterval(() => {
      setElapsedTime(Math.floor((Date.now() - startTimeRef.current) / 1000))
    }, 1000)
    return () => clearInterval(interval)
  }, [])

  const getStatusColor = (status: ChunkProgress['status']) => {
    switch (status) {
      case 'completed':
        return 'bg-emerald-500 shadow-emerald-500/30'
      case 'processing':
        return 'bg-blue-500 shadow-blue-500/30 animate-pulse'
      case 'uploading':
        return 'bg-amber-500 shadow-amber-500/30 animate-pulse'
      case 'failed':
        return 'bg-rose-500 shadow-rose-500/30'
      default:
        return 'bg-slate-200'
    }
  }

  const getStatusIcon = (status: ChunkProgress['status']) => {
    switch (status) {
      case 'completed':
        return (
          <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
          </svg>
        )
      case 'processing':
      case 'uploading':
        return (
          <svg className="w-4 h-4 text-white animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        )
      case 'failed':
        return (
          <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
        )
      default:
        return <span className="text-xs text-slate-400 font-medium">{status === 'pending' ? '' : ''}</span>
    }
  }

  const formatTime = (seconds: number): string => {
    if (!seconds || seconds < 0) return '0:00'
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  const getStageLabel = (stage: string): string => {
    const labels: Record<string, string> = {
      'initializing': 'Initializing',
      'planning': 'Planning Chunks',
      'uploading': 'Uploading Video',
      'processing': 'Processing Chunks',
      'merging': 'Merging Results',
      'complete': 'Complete',
    }
    return labels[stage] || stage
  }

  // Calculate success rate
  const processedChunks = progress.completedChunks + progress.failedChunks
  const successRate = processedChunks > 0
    ? Math.round((progress.completedChunks / processedChunks) * 100)
    : 100

  return (
    <div className="space-y-6">
      {/* Header with Stage Badge */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">{message}</h2>
          <div className="flex items-center gap-2 mt-1">
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
              {getStageLabel(stage)}
            </span>
            {progress.apiKeysStatus && (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600">
                {progress.apiKeysStatus.activeRequests} active request{progress.apiKeysStatus.activeRequests !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>
        <div className="text-right">
          <div className="text-3xl font-bold text-blue-600">{progress.overallProgress}%</div>
          <div className="text-xs text-slate-500">Complete</div>
        </div>
      </div>

      {/* Main Progress Bar */}
      <div className="relative">
        <div className="bg-slate-100 rounded-full h-3 overflow-hidden">
          <div
            className="bg-gradient-to-r from-blue-500 via-blue-600 to-indigo-600 h-full rounded-full transition-all duration-700 ease-out relative"
            style={{ width: `${Math.max(1, progress.overallProgress)}%` }}
          >
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent animate-shimmer" />
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-4 gap-3">
        <div className="bg-gradient-to-br from-slate-50 to-slate-100 rounded-xl p-4 border border-slate-200">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-2xl font-bold text-slate-800">
                {progress.completedChunks}<span className="text-slate-400 text-lg">/{progress.totalChunks}</span>
              </div>
              <div className="text-xs text-slate-500 mt-0.5">Chunks Done</div>
            </div>
            <div className="w-10 h-10 rounded-lg bg-emerald-100 flex items-center justify-center">
              <svg className="w-5 h-5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          </div>
        </div>

        <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-xl p-4 border border-blue-200">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-2xl font-bold text-blue-700">{progress.activeChunks}</div>
              <div className="text-xs text-blue-600 mt-0.5">Active Now</div>
            </div>
            <div className="w-10 h-10 rounded-lg bg-blue-200 flex items-center justify-center">
              <svg className="w-5 h-5 text-blue-600 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
          </div>
        </div>

        <div className="bg-gradient-to-br from-slate-50 to-slate-100 rounded-xl p-4 border border-slate-200">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-2xl font-bold text-slate-800">
                {formatTime(progress.elapsedSeconds || elapsedTime)}
              </div>
              <div className="text-xs text-slate-500 mt-0.5">Elapsed</div>
            </div>
            <div className="w-10 h-10 rounded-lg bg-slate-200 flex items-center justify-center">
              <svg className="w-5 h-5 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          </div>
        </div>

        <div className="bg-gradient-to-br from-indigo-50 to-indigo-100 rounded-xl p-4 border border-indigo-200">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-2xl font-bold text-indigo-700">
                {progress.estimatedTimeRemaining
                  ? formatTime(Math.round(progress.estimatedTimeRemaining / 1000))
                  : '--:--'}
              </div>
              <div className="text-xs text-indigo-600 mt-0.5">ETA</div>
            </div>
            <div className="w-10 h-10 rounded-lg bg-indigo-200 flex items-center justify-center">
              <svg className="w-5 h-5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
              </svg>
            </div>
          </div>
        </div>
      </div>

      {/* Chunk Grid */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-slate-700">Chunk Processing Status</h3>
          <div className="flex items-center gap-4 text-xs">
            <span className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded bg-emerald-500" />
              <span className="text-slate-600">{progress.completedChunks} Done</span>
            </span>
            <span className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded bg-blue-500 animate-pulse" />
              <span className="text-slate-600">{progress.activeChunks} Active</span>
            </span>
            {progress.failedChunks > 0 && (
              <span className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded bg-rose-500" />
                <span className="text-slate-600">{progress.failedChunks} Failed</span>
              </span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-6 sm:grid-cols-8 md:grid-cols-10 lg:grid-cols-12 gap-2">
          {progress.chunks.map((chunk) => (
            <div
              key={chunk.index}
              className={`relative aspect-square rounded-lg flex items-center justify-center shadow-md transition-all duration-300 hover:scale-105 ${getStatusColor(chunk.status)}`}
              title={`Chunk ${chunk.index + 1}: ${chunk.status}${chunk.elapsedTime ? ` (${formatTime(Math.round(chunk.elapsedTime / 1000))})` : ''}`}
            >
              {getStatusIcon(chunk.status)}
              {chunk.status === 'pending' && (
                <span className="text-xs font-medium text-slate-400">{chunk.index + 1}</span>
              )}
              {(chunk.status === 'processing' || chunk.status === 'uploading') && chunk.progress > 0 && (
                <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-black/10 rounded-b-lg overflow-hidden">
                  <div
                    className="h-full bg-white/60 transition-all duration-300"
                    style={{ width: `${chunk.progress * 100}%` }}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Failed chunks warning */}
      {progress.failedChunks > 0 && (
        <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 flex items-start gap-3">
          <div className="w-8 h-8 rounded-lg bg-rose-100 flex items-center justify-center flex-shrink-0">
            <svg className="w-5 h-5 text-rose-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <div>
            <h4 className="font-medium text-rose-800">
              {progress.failedChunks} chunk{progress.failedChunks !== 1 ? 's' : ''} failed
            </h4>
            <p className="text-sm text-rose-600 mt-0.5">
              These sections will be marked as incomplete in the final results.
            </p>
          </div>
        </div>
      )}

      <style jsx>{`
        @keyframes shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
        .animate-shimmer {
          animation: shimmer 2s infinite;
        }
      `}</style>
    </div>
  )
}

/**
 * Hook for parallel video processing
 */
export function useParallelProcessing() {
  const [isProcessing, setIsProcessing] = useState(false)
  const [progress, setProgress] = useState<ParallelProgressData | null>(null)
  const [stage, setStage] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState<string | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)

  const processVideo = useCallback(async (
    file: File,
    modelId: string,
    chunkDuration: number = 5
  ): Promise<unknown> => {
    setIsProcessing(true)
    setError(null)
    setProgress(null)
    setStage('initializing')
    setMessage('Starting parallel processing...')

    abortControllerRef.current = new AbortController()

    const formData = new FormData()
    formData.append('video', file)
    formData.append('model', modelId)
    formData.append('chunkDuration', chunkDuration.toString())

    try {
      const response = await fetch('/api/process-video-parallel', {
        method: 'POST',
        headers: {
          'Accept': 'text/event-stream',
        },
        body: formData,
        signal: abortControllerRef.current.signal,
      })

      if (!response.ok) {
        throw new Error(`Server error: ${response.status}`)
      }

      const reader = response.body?.getReader()
      if (!reader) {
        throw new Error('No response body')
      }

      const decoder = new TextDecoder()
      let buffer = ''
      let result: unknown = null

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (line.startsWith('event: ')) continue
          if (line.startsWith('data: ')) {
            const dataStr = line.slice(6)
            try {
              const data = JSON.parse(dataStr)

              if (data.stage) {
                setStage(data.stage)
                setMessage(data.message || '')

                if (data.parallelProgress) {
                  setProgress(data.parallelProgress)
                } else if (data.progress !== undefined) {
                  // Create basic progress for non-parallel stages
                  setProgress(prev => prev ? {
                    ...prev,
                    overallProgress: Math.round(data.progress),
                  } : {
                    totalChunks: data.chunkInfo?.total || 1,
                    completedChunks: 0,
                    failedChunks: 0,
                    activeChunks: 0,
                    overallProgress: Math.round(data.progress),
                    chunks: [],
                  })
                }
              }

              // Handle complete event
              if ('clean_script' in data) {
                result = data
              }

              // Handle error event
              if (data.message && !data.stage && !('clean_script' in data)) {
                setError(data.message)
              }
            } catch (parseError) {
              console.error('Failed to parse SSE data:', parseError)
            }
          }
        }
      }

      setIsProcessing(false)
      return result

    } catch (err) {
      setIsProcessing(false)

      if (err instanceof Error && err.name === 'AbortError') {
        setError('Processing cancelled')
        return null
      }

      const errorMessage = err instanceof Error ? err.message : 'Unknown error'
      setError(errorMessage)
      throw err
    }
  }, [])

  const cancel = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
    setIsProcessing(false)
  }, [])

  return {
    isProcessing,
    progress,
    stage,
    message,
    error,
    processVideo,
    cancel,
  }
}
