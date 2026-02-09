'use client'

import { useState, useRef, useEffect, useCallback } from 'react'

interface TimestampRange {
  start: string
  end: string
  description: string
}

interface VideoTrimmerProps {
  videoFile: File | null
  timestamps: TimestampRange[]
  onProgress?: (progress: number, stage: string) => void
}

// Dynamic import for FFmpeg to avoid SSR issues
let FFmpegModule: typeof import('@ffmpeg/ffmpeg') | null = null
let FFmpegUtilModule: typeof import('@ffmpeg/util') | null = null

export default function VideoTrimmer({ videoFile, timestamps, onProgress }: VideoTrimmerProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [isFFmpegLoaded, setIsFFmpegLoaded] = useState(false)
  const [isFFmpegLoading, setIsFFmpegLoading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [stage, setStage] = useState('')
  const [trimmedVideoUrl, setTrimmedVideoUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [estimatedTimeRemaining, setEstimatedTimeRemaining] = useState<string | null>(null)
  const ffmpegRef = useRef<InstanceType<typeof import('@ffmpeg/ffmpeg').FFmpeg> | null>(null)
  const startTimeRef = useRef<number>(0)

  // Cleanup blob URL on unmount
  useEffect(() => {
    return () => {
      if (trimmedVideoUrl) {
        URL.revokeObjectURL(trimmedVideoUrl)
      }
    }
  }, [trimmedVideoUrl])

  // Pre-load FFmpeg when component mounts (optimization)
  useEffect(() => {
    if (videoFile && timestamps.length > 0 && !isFFmpegLoaded && !isFFmpegLoading) {
      console.log('Pre-loading FFmpeg...')
      loadFFmpeg()
    }
  }, [videoFile, timestamps.length, isFFmpegLoaded, isFFmpegLoading])

  const loadFFmpeg = useCallback(async () => {
    if (isFFmpegLoaded || isFFmpegLoading) return true

    setIsFFmpegLoading(true)
    setStage('Loading video processor...')
    setError(null)

    try {
      // Dynamic import of FFmpeg modules
      if (!FFmpegModule) {
        FFmpegModule = await import('@ffmpeg/ffmpeg')
      }
      if (!FFmpegUtilModule) {
        FFmpegUtilModule = await import('@ffmpeg/util')
      }

      const { FFmpeg } = FFmpegModule
      const { toBlobURL } = FFmpegUtilModule

      const ffmpeg = new FFmpeg()
      ffmpegRef.current = ffmpeg

      ffmpeg.on('progress', ({ progress: p, time }) => {
        const percent = Math.round(p * 100)
        setProgress(percent)
        onProgress?.(percent, stage)

        // Calculate estimated time remaining
        if (startTimeRef.current && percent > 0 && percent < 100) {
          const elapsed = (Date.now() - startTimeRef.current) / 1000
          const totalEstimate = elapsed / (percent / 100)
          const remaining = totalEstimate - elapsed
          if (remaining > 0) {
            if (remaining < 60) {
              setEstimatedTimeRemaining(`~${Math.round(remaining)}s remaining`)
            } else {
              setEstimatedTimeRemaining(`~${Math.round(remaining / 60)}m remaining`)
            }
          }
        }
      })

      ffmpeg.on('log', ({ message }) => {
        console.log('FFmpeg:', message)
      })

      // Load FFmpeg core files - use toBlobURL for proper CORS handling
      const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd'

      console.log('Loading FFmpeg core from:', baseURL)

      // Fetch and create blob URLs for the core files
      const coreURL = await toBlobURL(
        `${baseURL}/ffmpeg-core.js`,
        'text/javascript'
      )
      const wasmURL = await toBlobURL(
        `${baseURL}/ffmpeg-core.wasm`,
        'application/wasm'
      )

      console.log('Core URL:', coreURL)
      console.log('WASM URL:', wasmURL)

      await ffmpeg.load({
        coreURL,
        wasmURL,
      })

      setIsFFmpegLoaded(true)
      setStage('')
      console.log('FFmpeg loaded successfully')
      return true
    } catch (err) {
      console.error('Failed to load FFmpeg:', err)
      setError(`Failed to load video processor: ${err instanceof Error ? err.message : 'Unknown error'}. Try refreshing the page.`)
      return false
    } finally {
      setIsFFmpegLoading(false)
    }
  }, [isFFmpegLoaded, isFFmpegLoading, onProgress, stage])

  // Convert MM:SS or HH:MM:SS to seconds
  const timeToSeconds = (time: string): number => {
    const parts = time.split(':').map(Number)
    if (parts.length === 2) {
      return parts[0] * 60 + parts[1]
    } else if (parts.length === 3) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2]
    }
    return 0
  }

  // Convert seconds to FFmpeg time format (HH:MM:SS.ms)
  const secondsToTime = (seconds: number): string => {
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    const s = Math.floor(seconds % 60)
    const ms = Math.round((seconds % 1) * 1000)
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`
  }

  const trimVideo = async () => {
    if (!videoFile) {
      setError('No video file available.')
      return
    }

    if (timestamps.length === 0) {
      setError('No timestamps available for trimming.')
      return
    }

    setIsLoading(true)
    setError(null)
    setProgress(0)
    setEstimatedTimeRemaining(null)
    startTimeRef.current = Date.now()

    try {
      // Load FFmpeg if not already loaded
      if (!isFFmpegLoaded) {
        const loaded = await loadFFmpeg()
        if (!loaded) {
          throw new Error('FFmpeg failed to load')
        }
        // Wait a bit for state to update
        await new Promise(resolve => setTimeout(resolve, 100))
      }

      if (!ffmpegRef.current) {
        throw new Error('FFmpeg instance not available')
      }

      const ffmpeg = ffmpegRef.current

      // Ensure FFmpegUtilModule is loaded
      if (!FFmpegUtilModule) {
        FFmpegUtilModule = await import('@ffmpeg/util')
      }
      const { fetchFile } = FFmpegUtilModule

      // Write input file to FFmpeg virtual filesystem
      setStage('Loading video into processor...')
      const inputFileName = 'input.mp4'
      const inputData = await fetchFile(videoFile)
      await ffmpeg.writeFile(inputFileName, inputData)

      // Sort timestamps by start time
      const sortedTimestamps = [...timestamps].sort(
        (a, b) => timeToSeconds(a.start) - timeToSeconds(b.start)
      )

      // Create a filter complex to concatenate segments
      const segmentFiles: string[] = []

      setStage('Extracting essential segments (fast mode)...')

      // Track timing for progress estimation
      const totalSegments = sortedTimestamps.length

      // Extract each segment using STREAM COPY (10-100x faster than re-encoding!)
      for (let i = 0; i < sortedTimestamps.length; i++) {
        const ts = sortedTimestamps[i]
        const startSeconds = timeToSeconds(ts.start)
        const endSeconds = timeToSeconds(ts.end)
        const duration = endSeconds - startSeconds

        if (duration <= 0) continue

        const segmentFile = `segment_${i}.mp4`
        segmentFiles.push(segmentFile)

        setStage(`Extracting segment ${i + 1}/${totalSegments}...`)
        setProgress(Math.round((i / totalSegments) * 70))

        // OPTIMIZATION: Use stream copy (-c copy) instead of re-encoding
        // This is 10-100x faster because we're just copying data, not decoding/encoding!
        try {
          await ffmpeg.exec([
            '-ss', secondsToTime(startSeconds),  // Seek BEFORE input (faster)
            '-i', inputFileName,
            '-t', duration.toString(),
            '-c', 'copy',  // Stream copy - no re-encoding!
            '-avoid_negative_ts', 'make_zero',
            '-y',
            segmentFile
          ])
        } catch (segmentError) {
          // If stream copy fails (e.g., seeking issues), fall back to re-encoding
          console.warn(`Stream copy failed for segment ${i + 1}, falling back to re-encode...`)
          setStage(`Re-encoding segment ${i + 1}/${totalSegments} (slower)...`)

          await ffmpeg.exec([
            '-i', inputFileName,
            '-ss', secondsToTime(startSeconds),
            '-t', duration.toString(),
            '-c:v', 'libx264',
            '-preset', 'ultrafast',
            '-crf', '23',
            '-c:a', 'aac',
            '-y',
            segmentFile
          ])
        }
      }

      if (segmentFiles.length === 0) {
        throw new Error('No valid segments to extract')
      }

      setStage('Combining segments...')
      setProgress(75)

      // Create concat file
      const concatContent = segmentFiles.map(f => `file '${f}'`).join('\n')
      await ffmpeg.writeFile('concat.txt', concatContent)

      // Concatenate all segments using stream copy
      const outputFileName = 'trimmed_output.mp4'
      await ffmpeg.exec([
        '-f', 'concat',
        '-safe', '0',
        '-i', 'concat.txt',
        '-c', 'copy',  // Stream copy for concatenation too!
        '-y',
        outputFileName
      ])

      setStage('Finalizing...')
      setProgress(90)

      // Read the output file
      const outputData = await ffmpeg.readFile(outputFileName)
      // Handle the output data - it's a Uint8Array from FFmpeg
      const outputBlob = new Blob([outputData as BlobPart], { type: 'video/mp4' })
      const url = URL.createObjectURL(outputBlob)

      // Cleanup temporary files
      await ffmpeg.deleteFile(inputFileName)
      await ffmpeg.deleteFile('concat.txt')
      for (const segFile of segmentFiles) {
        try {
          await ffmpeg.deleteFile(segFile)
        } catch (e) {
          // Ignore cleanup errors
        }
      }
      try {
        await ffmpeg.deleteFile(outputFileName)
      } catch (e) {
        // Ignore cleanup errors
      }

      // Revoke old URL if exists
      if (trimmedVideoUrl) {
        URL.revokeObjectURL(trimmedVideoUrl)
      }

      // Calculate actual processing time
      const processingTime = (Date.now() - startTimeRef.current) / 1000
      console.log(`Video trimming completed in ${processingTime.toFixed(1)} seconds`)

      setTrimmedVideoUrl(url)
      setProgress(100)
      setStage('Complete!')
      setEstimatedTimeRemaining(null)

    } catch (err) {
      console.error('Trimming error:', err)
      setError(`Failed to trim video: ${err instanceof Error ? err.message : 'Unknown error'}`)
    } finally {
      setIsLoading(false)
    }
  }

  const downloadVideo = () => {
    if (!trimmedVideoUrl || !videoFile) return

    const link = document.createElement('a')
    link.href = trimmedVideoUrl
    const originalName = videoFile.name.replace(/\.[^/.]+$/, '')
    link.download = `${originalName}_trimmed.mp4`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  if (!videoFile) {
    return null
  }

  if (timestamps.length === 0) {
    return null
  }

  return (
    <div className="mt-6 p-6 bg-gradient-to-r from-purple-50 to-indigo-50 rounded-xl border border-purple-200">
      <h3 className="text-lg font-semibold text-purple-900 mb-4 flex items-center gap-2">
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        Video Trimmer
        {isFFmpegLoaded && (
          <span className="text-xs font-normal text-green-600 bg-green-100 px-2 py-0.5 rounded-full">
            Ready
          </span>
        )}
        {isFFmpegLoading && (
          <span className="text-xs font-normal text-purple-600 bg-purple-100 px-2 py-0.5 rounded-full animate-pulse">
            Loading...
          </span>
        )}
      </h3>

      {error && (
        <div className="mb-4 p-3 bg-red-100 border border-red-300 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      {!trimmedVideoUrl && !isLoading && (
        <div>
          <p className="text-gray-600 mb-4">
            Found <span className="font-semibold text-purple-700">{timestamps.length}</span> essential content segments.
            Click below to create a trimmed video with only the important parts.
          </p>

          {/* Fast mode indicator */}
          <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg">
            <div className="flex items-center gap-2 text-green-700">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              <span className="font-medium">Fast Mode Enabled</span>
            </div>
            <p className="text-sm text-green-600 mt-1">
              Using stream copy for instant trimming (no re-encoding). Most videos trim in under 1 minute!
            </p>
          </div>

          <div className="mb-4 max-h-40 overflow-y-auto">
            <div className="text-sm text-gray-500 space-y-1">
              {timestamps.map((ts, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="font-mono bg-purple-100 px-2 py-0.5 rounded text-purple-700">
                    {ts.start} - {ts.end}
                  </span>
                  <span className="truncate">{ts.description}</span>
                </div>
              ))}
            </div>
          </div>

          <button
            onClick={trimVideo}
            disabled={isLoading || timestamps.length === 0 || isFFmpegLoading}
            className="w-full py-3 px-4 bg-purple-600 hover:bg-purple-700 disabled:bg-purple-300 text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
          >
            {isFFmpegLoading ? (
              <>
                <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                <span>Loading video processor...</span>
              </>
            ) : (
              <>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.121 14.121L19 19m-7-7l7-7m-7 7l-2.879 2.879M12 12L9.121 9.121m0 5.758a3 3 0 10-4.243 4.243 3 3 0 004.243-4.243zm0-5.758a3 3 0 10-4.243-4.243 3 3 0 004.243 4.243z" />
                </svg>
                Create Trimmed Video
              </>
            )}
          </button>
        </div>
      )}

      {isLoading && (
        <div className="mt-4">
          <div className="flex justify-between text-sm text-gray-600 mb-1">
            <span>{stage}</span>
            <span className="flex items-center gap-2">
              {estimatedTimeRemaining && (
                <span className="text-purple-600">{estimatedTimeRemaining}</span>
              )}
              <span>{progress}%</span>
            </span>
          </div>
          <div className="w-full bg-purple-200 rounded-full h-2">
            <div
              className="bg-purple-600 h-2 rounded-full transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="text-xs text-gray-500 mt-2">
            ⚡ Fast mode: Copying video data directly without re-encoding
          </p>
        </div>
      )}

      {trimmedVideoUrl && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-green-700">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <span className="font-medium">Video trimmed successfully!</span>
          </div>

          <video
            src={trimmedVideoUrl}
            controls
            className="w-full rounded-lg shadow-lg"
            style={{ maxHeight: '300px' }}
          />

          <div className="flex gap-3">
            <button
              onClick={downloadVideo}
              className="flex-1 py-3 px-4 bg-green-600 hover:bg-green-700 text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Download Trimmed Video
            </button>

            <button
              onClick={() => {
                if (trimmedVideoUrl) {
                  URL.revokeObjectURL(trimmedVideoUrl)
                }
                setTrimmedVideoUrl(null)
                setProgress(0)
                setStage('')
                setEstimatedTimeRemaining(null)
              }}
              className="py-3 px-4 bg-gray-200 hover:bg-gray-300 text-gray-700 font-medium rounded-lg transition-colors"
            >
              Trim Again
            </button>
          </div>
        </div>
      )}
    </div>
  )
}