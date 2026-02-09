'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import FileUploader from '@/components/FileUploader'
import ResultViewer from '@/components/ResultViewer'
import LoadingSpinner from '@/components/LoadingSpinner'
import VideoTrimmer from '@/components/VideoTrimmer'
import HistoryPanel from '@/components/HistoryPanel'
import KeyboardShortcutsHelp from '@/components/KeyboardShortcutsHelp'
import ParallelProgress, { useParallelProcessing } from '@/components/ParallelProgress'
import { VideoAnalysisResult, ProcessingStatus, validateAnalysisResult } from '@/lib/utils'
import { useProcessingHistory, useKeyboardShortcuts, useAbortController } from '@/lib/hooks'

export default function Home() {
  const [isProcessing, setIsProcessing] = useState(false)
  const [result, setResult] = useState<VideoAnalysisResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [uploadedFile, setUploadedFile] = useState<File | null>(null)
  const [processingStatus, setProcessingStatus] = useState<ProcessingStatus>({
    stage: 'uploading',
    progress: 0,
    message: 'Preparing upload...'
  })

  // History state
  const [historyOpen, setHistoryOpen] = useState(false)
  const { history, addToHistory, removeFromHistory, clearHistory } = useProcessingHistory()

  // Keyboard shortcuts help
  const [shortcutsHelpOpen, setShortcutsHelpOpen] = useState(false)

  // Cancel support
  const { createController, abort } = useAbortController()
  const [canCancel, setCanCancel] = useState(false)

  // Parallel processing mode
  const [useParallelMode, setUseParallelMode] = useState(true)
  const parallelProcessing = useParallelProcessing()

  // File input ref for keyboard shortcut
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Request deduplication
  const processingRef = useRef(false)

  // Keyboard shortcuts
  useKeyboardShortcuts([
    {
      key: '?',
      handler: () => setShortcutsHelpOpen(true),
      description: 'Show keyboard shortcuts',
    },
    {
      key: 'h',
      handler: () => setHistoryOpen(prev => !prev),
      description: 'Toggle history panel',
    },
    {
      key: 'u',
      handler: () => {
        if (!isProcessing) {
          fileInputRef.current?.click()
        }
      },
      description: 'Upload new video',
    },
    {
      key: 'Escape',
      handler: () => {
        if (shortcutsHelpOpen) {
          setShortcutsHelpOpen(false)
        } else if (historyOpen) {
          setHistoryOpen(false)
        } else if (isProcessing && canCancel) {
          abort()
          setIsProcessing(false)
          setError('Processing cancelled')
          setCanCancel(false)
        }
      },
      description: 'Close panels / Cancel',
    },
  ], true)

  const handleFileSelect = useCallback(async (file: File, modelId: string) => {
    // Request deduplication - prevent double submissions
    if (processingRef.current) {
      console.log('Processing already in progress, ignoring duplicate request')
      return
    }

    processingRef.current = true
    setIsProcessing(true)
    setError(null)
    setResult(null)
    setUploadedFile(file)
    setCanCancel(true)

    // Use parallel processing for files > 50MB or when parallel mode is enabled
    const fileSizeMB = file.size / (1024 * 1024)
    const shouldUseParallel = useParallelMode && fileSizeMB > 30

    if (shouldUseParallel) {
      try {
        console.log('[Page] Using parallel processing mode')
        const parallelResult = await parallelProcessing.processVideo(file, modelId, 5)

        if (parallelResult && 'clean_script' in (parallelResult as object)) {
          const validatedResult = validateAnalysisResult(parallelResult)
          if (validatedResult) {
            setResult(validatedResult)
            addToHistory({
              fileName: file.name,
              fileSize: file.size,
              modelUsed: modelId,
              result: validatedResult,
            })
          } else {
            setError('Received invalid data from parallel processing')
          }
        } else if (parallelProcessing.error) {
          setError(parallelProcessing.error)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Parallel processing failed')
      } finally {
        setIsProcessing(false)
        setCanCancel(false)
        processingRef.current = false
      }
      return
    }

    // Standard sequential processing
    const controller = createController()

    try {
      setProcessingStatus({
        stage: 'uploading',
        progress: 5,
        message: 'Preparing video for upload...'
      })

      const formData = new FormData()
      formData.append('video', file)
      formData.append('model', modelId)

      const fileSizeMB = file.size / (1024 * 1024)

      // Try streaming first for better UX
      try {
        await processWithStreaming(formData, fileSizeMB, controller.signal, file, modelId)
        return
      } catch (streamError) {
        if (controller.signal.aborted) {
          throw new Error('Processing cancelled')
        }
        console.log('Streaming not supported, falling back to regular request')
      }

      // Fallback to regular request
      await processWithRegularRequest(formData, fileSizeMB, controller.signal, file, modelId)

    } catch (err) {
      if (err instanceof Error && err.message === 'Processing cancelled') {
        setError('Processing was cancelled')
      } else {
        const message = err instanceof Error ? err.message : 'An error occurred while processing the video'
        setError(message)
      }
      setProcessingStatus({
        stage: 'error',
        progress: 0,
        message: err instanceof Error ? err.message : 'Error occurred'
      })
    } finally {
      setIsProcessing(false)
      setCanCancel(false)
      processingRef.current = false
    }
  }, [createController, useParallelMode, parallelProcessing, addToHistory])

  const processWithStreaming = async (
    formData: FormData,
    fileSizeMB: number,
    signal: AbortSignal,
    file: File,
    modelId: string
  ) => {
    const response = await fetch('/api/process-video', {
      method: 'POST',
      headers: {
        'Accept': 'text/event-stream',
      },
      body: formData,
      signal,
    })

    if (!response.ok) {
      throw new Error('Streaming request failed')
    }

    const contentType = response.headers.get('content-type')
    if (!contentType?.includes('text/event-stream')) {
      throw new Error('Server does not support streaming')
    }

    const reader = response.body?.getReader()
    if (!reader) {
      throw new Error('No response body')
    }

    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      if (signal.aborted) {
        reader.cancel()
        throw new Error('Processing cancelled')
      }

      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (line.startsWith('event: ')) {
          continue
        }
        if (line.startsWith('data: ')) {
          const dataStr = line.slice(6)
          try {
            const data = JSON.parse(dataStr)

            if ('message' in data && 'error' in data === false && 'clean_script' in data === false) {
              // Progress update
              setProcessingStatus({
                stage: data.stage || 'processing',
                progress: data.progress || 0,
                message: data.message,
                estimatedTime: data.estimatedTime
              })
            } else if ('clean_script' in data) {
              // Complete result - validate before setting
              const validatedResult = validateAnalysisResult(data)

              if (!validatedResult) {
                throw new Error('Received invalid or incomplete data from server. Please try again.')
              }

              setProcessingStatus({
                stage: 'complete',
                progress: 100,
                message: 'Complete!'
              })
              await new Promise(resolve => setTimeout(resolve, 500))
              setResult(validatedResult)

              // Save to history
              addToHistory({
                fileName: file.name,
                fileSize: file.size,
                modelUsed: modelId,
                result: validatedResult,
              })
            } else if ('message' in data && typeof data.message === 'string') {
              // Error
              throw new Error(data.message)
            }
          } catch (parseError) {
            console.error('Error parsing SSE data:', parseError)
          }
        }
      }
    }
  }

  const processWithRegularRequest = async (
    formData: FormData,
    fileSizeMB: number,
    signal: AbortSignal,
    file: File,
    modelId: string
  ) => {
    // For large files, show incremental progress simulation
    let progressInterval: NodeJS.Timeout | undefined

    if (fileSizeMB > 50) {
      let uploadProgress = 10
      progressInterval = setInterval(() => {
        if (signal.aborted) {
          clearInterval(progressInterval)
          return
        }
        uploadProgress += Math.random() * 3
        if (uploadProgress < 30) {
          setProcessingStatus({
            stage: 'uploading',
            progress: uploadProgress,
            message: `Uploading video (${Math.round(uploadProgress)}%)...`,
            estimatedTime: getEstimatedTime(fileSizeMB)
          })
        } else if (uploadProgress < 60) {
          setProcessingStatus({
            stage: 'processing',
            progress: uploadProgress,
            message: 'Processing with AI (this may take a few minutes)...',
            estimatedTime: getEstimatedTime(fileSizeMB)
          })
        } else if (uploadProgress < 85) {
          setProcessingStatus({
            stage: 'analyzing',
            progress: uploadProgress,
            message: 'Analyzing content (please wait)...',
            estimatedTime: getEstimatedTime(fileSizeMB)
          })
        }
      }, 2000)
    } else {
      setProcessingStatus({
        stage: 'processing',
        progress: 30,
        message: 'Processing with AI...',
        estimatedTime: getEstimatedTime(fileSizeMB)
      })
    }

    try {
      const response = await fetch('/api/process-video', {
        method: 'POST',
        body: formData,
        signal,
      })

      if (progressInterval) clearInterval(progressInterval)

      setProcessingStatus({
        stage: 'analyzing',
        progress: 60,
        message: 'Analyzing content and extracting learning material...'
      })

      if (!response.ok) {
        let errorMessage = 'Failed to process video'
        try {
          const errorData = await response.json()
          errorMessage = errorData.error || errorMessage
        } catch {
          // If response is not JSON, use status text
          errorMessage = `Server error: ${response.status} ${response.statusText}`
        }
        console.error('API Error:', errorMessage)
        throw new Error(errorMessage)
      }

      setProcessingStatus({
        stage: 'complete',
        progress: 90,
        message: 'Generating structured results...'
      })

      let data: VideoAnalysisResult
      try {
        data = await response.json()
      } catch (parseError) {
        console.error('Failed to parse response:', parseError)
        throw new Error('Server returned invalid response. The video may be too large or complex. Please try a shorter video or contact support.')
      }

      // Validate the response
      const validatedResult = validateAnalysisResult(data)

      if (!validatedResult) {
        console.error('Validation failed for response:', data)
        throw new Error('Received invalid or incomplete data from server. Please try again or use a different video.')
      }

      setProcessingStatus({
        stage: 'complete',
        progress: 100,
        message: 'Complete!'
      })

      await new Promise(resolve => setTimeout(resolve, 500))
      setResult(validatedResult)

      // Save to history
      addToHistory({
        fileName: file.name,
        fileSize: file.size,
        modelUsed: modelId,
        result: validatedResult,
      })

    } finally {
      if (progressInterval) clearInterval(progressInterval)
    }
  }

  const getEstimatedTime = (sizeMB: number): string => {
    if (sizeMB < 50) return '~1-2 minutes'
    if (sizeMB < 200) return '~2-4 minutes'
    if (sizeMB < 500) return '~4-8 minutes'
    return '~8-15 minutes'
  }

  const handleCancelProcessing = () => {
    // Cancel parallel processing if active
    if (parallelProcessing.isProcessing) {
      parallelProcessing.cancel()
    }
    abort()
    setIsProcessing(false)
    setError('Processing was cancelled')
    setCanCancel(false)
    processingRef.current = false
    setProcessingStatus({
      stage: 'error',
      progress: 0,
      message: 'Cancelled'
    })
  }

  const handleHistorySelect = (entry: typeof history[0]) => {
    setResult(entry.result)
    setUploadedFile(null) // We don't have the original file
    setHistoryOpen(false)
    setError(null)
  }

  const handleReset = () => {
    setResult(null)
    setError(null)
    setUploadedFile(null)
    setProcessingStatus({
      stage: 'uploading',
      progress: 0,
      message: 'Preparing upload...'
    })
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-50 via-white to-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10 shadow-sm">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 bg-primary-600 rounded-lg flex items-center justify-center">
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
                  />
                </svg>
              </div>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">Clean Class Recorder</h1>
                <p className="text-sm text-gray-500">AI-powered class recording analyzer</p>
              </div>
            </div>

            {/* Header Actions */}
            <div className="flex items-center gap-2">
              {/* History Button */}
              <button
                onClick={() => setHistoryOpen(true)}
                className="flex items-center gap-2 px-3 py-2 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
                title="View history (H)"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                <span className="hidden sm:inline">History</span>
                {history.length > 0 && (
                  <span className="px-1.5 py-0.5 text-xs bg-primary-100 text-primary-700 rounded-full">
                    {history.length}
                  </span>
                )}
              </button>

              {/* Keyboard Shortcuts Button */}
              <button
                onClick={() => setShortcutsHelpOpen(true)}
                className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                title="Keyboard shortcuts (?)"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {!result && !isProcessing && (
          <div className="space-y-8">
            {/* Hero Section */}
            <div className="text-center space-y-4">
              <h2 className="text-4xl font-bold text-gray-900">
                Transform Your Class Recordings
              </h2>
              <p className="text-xl text-gray-600 max-w-2xl mx-auto">
                Upload a class recording and let AI automatically extract the core learning content,
                remove filler, and generate clean structured notes with chapters and summaries.
              </p>
            </div>

            {/* Features */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="bg-white p-6 rounded-xl border border-gray-200 hover:border-primary-300 hover:shadow-lg transition-all">
                <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center mb-4">
                  <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                </div>
                <h3 className="font-semibold text-gray-900 mb-2">Smart Content Filtering</h3>
                <p className="text-sm text-gray-600">
                  AI identifies and removes Q&A, chit-chat, technical issues, and off-topic discussions
                </p>
              </div>

              <div className="bg-white p-6 rounded-xl border border-gray-200 hover:border-primary-300 hover:shadow-lg transition-all">
                <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center mb-4">
                  <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                    />
                  </svg>
                </div>
                <h3 className="font-semibold text-gray-900 mb-2">Chapters & Timestamps</h3>
                <p className="text-sm text-gray-600">
                  Automatically splits content into chapters with timestamps showing essential content sections
                </p>
              </div>

              <div className="bg-white p-6 rounded-xl border border-gray-200 hover:border-primary-300 hover:shadow-lg transition-all">
                <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center mb-4">
                  <svg className="w-6 h-6 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                    />
                  </svg>
                </div>
                <h3 className="font-semibold text-gray-900 mb-2">Content Metadata</h3>
                <p className="text-sm text-gray-600">
                  See exactly what was filtered out with categories and durations of removed content
                </p>
              </div>
            </div>

            {/* Supported Formats */}
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-6">
              <div className="flex items-start space-x-4">
                <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
                  <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div>
                  <h3 className="font-semibold text-blue-900">Optimized for Live Class Recordings</h3>
                  <p className="text-sm text-blue-700 mt-1">
                    Upload recordings up to 1GB in MP4, MKV, MOV, or WebM format. Large files are automatically
                    uploaded using Gemini File API. AI will extract the core educational content and filter out
                    non-essential portions like Q&A, chit-chat, and technical issues.
                  </p>
                </div>
              </div>
            </div>

            {/* Processing Mode Toggle */}
            <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-xl p-6">
              <div className="flex items-center justify-between">
                <div className="flex items-start space-x-4">
                  <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
                    <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="font-semibold text-blue-900">Parallel Processing Mode</h3>
                    <p className="text-sm text-blue-700 mt-1">
                      {useParallelMode
                        ? 'Enabled: Files over 30MB will be processed using multiple API keys simultaneously for faster results.'
                        : 'Disabled: Standard sequential processing will be used.'}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setUseParallelMode(!useParallelMode)}
                  className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                    useParallelMode ? 'bg-blue-600' : 'bg-gray-200'
                  }`}
                  role="switch"
                  aria-checked={useParallelMode}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                      useParallelMode ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
            </div>

            {/* File Uploader */}
            <div className="bg-white p-8 rounded-xl border border-gray-200 shadow-sm">
              <FileUploader
                onFileSelect={handleFileSelect}
                isProcessing={isProcessing}
                uploadProgress={processingStatus.progress}
                fileInputRef={fileInputRef}
              />
            </div>
          </div>
        )}

        {isProcessing && (
          <div className="space-y-6">
            {/* Show ParallelProgress for parallel mode, LoadingSpinner for sequential */}
            {parallelProcessing.isProcessing && parallelProcessing.progress ? (
              <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
                <ParallelProgress
                  progress={parallelProcessing.progress}
                  stage={parallelProcessing.stage}
                  message={parallelProcessing.message}
                />
              </div>
            ) : (
              <LoadingSpinner status={processingStatus} />
            )}

            {/* Cancel Button */}
            {canCancel && (
              <div className="flex justify-center">
                <button
                  onClick={handleCancelProcessing}
                  className="px-6 py-2 text-sm font-medium text-red-600 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg transition-colors flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  Cancel Processing
                  <kbd className="ml-2 px-1.5 py-0.5 text-xs bg-red-100 border border-red-200 rounded">Esc</kbd>
                </button>
              </div>
            )}
          </div>
        )}

        {result && (
          <div className="space-y-6">
            <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-bold text-gray-900">Analysis Results</h2>
                <button
                  onClick={handleReset}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Upload Another
                </button>
              </div>
              <ResultViewer data={result} />

              {/* VideoTrimmer Section */}
              <VideoTrimmer
                videoFile={uploadedFile}
                timestamps={result.content_metadata?.main_content_timestamps || []}
              />
            </div>
          </div>
        )}

        {error && !isProcessing && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-6 space-y-4">
            <div className="flex items-start space-x-4">
              <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center flex-shrink-0">
                <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-red-900">Error Processing Video</h3>
                <p className="text-sm text-red-700 mt-1">{error}</p>
              </div>
            </div>
            <button
              onClick={handleReset}
              className="w-full px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors"
            >
              Try Again
            </button>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="bg-gray-50 border-t border-gray-200 mt-16">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex items-center justify-between text-sm text-gray-600">
            <p>&copy; 2024 Clean Class Recorder. All rights reserved.</p>
            <div className="flex items-center gap-4">
              <button
                onClick={() => setShortcutsHelpOpen(true)}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                Keyboard shortcuts
              </button>
              <p>Powered by Gemini AI & MiraAI</p>
            </div>
          </div>
        </div>
      </footer>

      {/* History Panel */}
      <HistoryPanel
        history={history}
        onSelectEntry={handleHistorySelect}
        onDeleteEntry={removeFromHistory}
        onClearAll={clearHistory}
        isOpen={historyOpen}
        onClose={() => setHistoryOpen(false)}
      />

      {/* Keyboard Shortcuts Help */}
      <KeyboardShortcutsHelp
        isOpen={shortcutsHelpOpen}
        onClose={() => setShortcutsHelpOpen(false)}
      />
    </div>
  )
}
