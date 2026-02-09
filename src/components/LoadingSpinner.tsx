'use client'

import { ProcessingStatus } from '@/lib/utils'
import { useState, useEffect, useMemo } from 'react'

interface LoadingSpinnerProps {
  status?: ProcessingStatus
}

const stages = [
  { key: 'uploading', label: 'Uploading video', icon: 'upload', color: 'blue' },
  { key: 'processing', label: 'Processing with Gemini', icon: 'processing', color: 'purple' },
  { key: 'analyzing', label: 'Analyzing content', icon: 'analyze', color: 'indigo' },
  { key: 'complete', label: 'Generating results', icon: 'complete', color: 'green' },
]

// Tips to show while processing
const processingTips = [
  "AI can identify and remove 30-40% of non-essential content from typical class recordings.",
  "The clean script will contain only the core educational content, making revision easier.",
  "Chapters and timestamps help you quickly navigate to specific topics.",
  "Key concepts are automatically extracted for a quick overview of what was covered.",
  "You'll receive practice recommendations based on the lesson content.",
  "After analysis, you can create a trimmed video with only the essential parts!",
  "Processing larger files takes longer, but the results are worth the wait.",
  "Larger videos (600MB+) may take 10-15 minutes to analyze.",
  "Content metadata shows exactly what was filtered and why.",
  "Press H to view your processing history anytime.",
]

export default function LoadingSpinner({ status }: LoadingSpinnerProps) {
  const currentStage = status?.stage || 'uploading'
  const progress = status?.progress || 0
  const message = status?.message || 'Processing your video...'
  const estimatedTime = status?.estimatedTime

  const [currentTip, setCurrentTip] = useState(0)
  const [startTime] = useState(Date.now())
  const [elapsedTime, setElapsedTime] = useState('0:00')
  const [etaSeconds, setEtaSeconds] = useState<number | null>(null)

  // Rotate tips every 6 seconds
  useEffect(() => {
    const tipInterval = setInterval(() => {
      setCurrentTip(prev => (prev + 1) % processingTips.length)
    }, 6000)
    return () => clearInterval(tipInterval)
  }, [])

  // Update elapsed time and calculate ETA
  useEffect(() => {
    const timeInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000)
      const minutes = Math.floor(elapsed / 60)
      const seconds = elapsed % 60
      setElapsedTime(`${minutes}:${seconds.toString().padStart(2, '0')}`)

      // Calculate ETA based on progress
      if (progress > 5 && progress < 95) {
        const estimatedTotal = elapsed / (progress / 100)
        const remaining = Math.max(0, Math.round(estimatedTotal - elapsed))
        setEtaSeconds(remaining)
      } else {
        setEtaSeconds(null)
      }
    }, 1000)
    return () => clearInterval(timeInterval)
  }, [startTime, progress])

  const formatEta = (seconds: number): string => {
    if (seconds < 60) return `~${seconds}s`
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `~${mins}m ${secs}s`
  }

  const getStageIndex = (stage: string) => {
    const index = stages.findIndex(s => s.key === stage)
    return index >= 0 ? index : 0
  }

  const currentIndex = getStageIndex(currentStage)

  const getStageStatus = (stageKey: string) => {
    const stageIndex = getStageIndex(stageKey)
    if (stageIndex < currentIndex) return 'completed'
    if (stageIndex === currentIndex) return 'active'
    return 'pending'
  }

  // Smooth progress animation
  const progressWidth = useMemo(() => {
    return Math.max(3, progress)
  }, [progress])

  return (
    <div className="w-full max-w-2xl mx-auto">
      <div className="space-y-8">
        {/* Header */}
        <div className="text-center">
          <div className="inline-block">
            <div className="relative">
              <div className="animate-spin">
                <svg className="w-16 h-16 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
                  />
                </svg>
              </div>
              {/* Pulsing ring */}
              <div className="absolute inset-0 animate-ping opacity-25">
                <svg className="w-16 h-16 text-primary-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="10" strokeWidth={2} />
                </svg>
              </div>
            </div>
          </div>
          <h2 className="mt-6 text-xl font-semibold text-gray-800">{message}</h2>

          {/* Time indicators */}
          <div className="mt-3 flex items-center justify-center gap-4 text-sm">
            <span className="text-gray-500 flex items-center gap-1">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Elapsed: <span className="font-mono font-medium text-gray-700">{elapsedTime}</span>
            </span>
            {etaSeconds !== null && etaSeconds > 0 && (
              <span className="text-primary-600 flex items-center gap-1">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                ETA: <span className="font-medium">{formatEta(etaSeconds)}</span>
              </span>
            )}
            {estimatedTime && !etaSeconds && (
              <span className="text-primary-600">
                Est. total: <span className="font-medium">{estimatedTime}</span>
              </span>
            )}
          </div>
        </div>

        {/* Progress Bar */}
        <div className="space-y-2">
          <div className="flex justify-between text-sm text-gray-600">
            <span>Progress</span>
            <span className="font-medium">{Math.round(progress)}%</span>
          </div>
          <div className="bg-gray-200 rounded-full h-3 overflow-hidden">
            <div
              className="bg-gradient-to-r from-primary-500 to-primary-600 h-full rounded-full transition-all duration-700 ease-out relative overflow-hidden"
              style={{ width: `${progressWidth}%` }}
            >
              {/* Animated shimmer effect */}
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent animate-shimmer" />
            </div>
          </div>
        </div>

        {/* Stage Indicators */}
        <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
          <h3 className="text-sm font-medium text-gray-700 mb-4">Processing Stages</h3>
          <div className="space-y-4">
            {stages.map((stage, index) => {
              const stageStatus = getStageStatus(stage.key)
              return (
                <div key={stage.key} className="flex items-center space-x-4">
                  {/* Status Icon */}
                  <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${stageStatus === 'completed'
                    ? 'bg-green-100'
                    : stageStatus === 'active'
                      ? 'bg-primary-100'
                      : 'bg-gray-100'
                    }`}>
                    {stageStatus === 'completed' ? (
                      <svg className="w-5 h-5 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                        <path
                          fillRule="evenodd"
                          d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                          clipRule="evenodd"
                        />
                      </svg>
                    ) : stageStatus === 'active' ? (
                      <svg className="w-5 h-5 text-primary-600 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                    ) : (
                      <div className="w-3 h-3 rounded-full bg-gray-300" />
                    )}
                  </div>

                  {/* Stage Label */}
                  <div className="flex-1">
                    <p className={`text-sm font-medium ${stageStatus === 'completed'
                      ? 'text-green-700'
                      : stageStatus === 'active'
                        ? 'text-primary-700'
                        : 'text-gray-400'
                      }`}>
                      {stage.label}
                    </p>
                    {stageStatus === 'active' && (
                      <p className="text-xs text-gray-500 mt-0.5">In progress...</p>
                    )}
                  </div>

                  {/* Connector Line */}
                  {index < stages.length - 1 && (
                    <div className="absolute left-4 mt-8 w-0.5 h-4 bg-gray-200" />
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* Rotating Tips */}
        <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg p-4 border border-blue-100">
          <div className="flex items-start space-x-3">
            <div className="flex-shrink-0 w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
              <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-medium text-blue-800">Did you know?</p>
              <p className="text-sm text-blue-700 mt-1 transition-all duration-500">
                {processingTips[currentTip]}
              </p>
            </div>
          </div>
          {/* Tip indicator dots */}
          <div className="flex justify-center gap-1 mt-3">
            {processingTips.map((_, i) => (
              <div
                key={i}
                className={`w-1.5 h-1.5 rounded-full transition-colors ${i === currentTip ? 'bg-blue-500' : 'bg-blue-200'
                  }`}
              />
            ))}
          </div>
        </div>

        {/* Don't leave message */}
        <div className="text-center text-sm text-gray-500">
          <p>Please keep this tab open. Your video is being processed...</p>
        </div>
      </div>

      {/* Add shimmer animation */}
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
