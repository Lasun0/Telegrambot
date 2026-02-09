'use client'

import { useState, useEffect, useCallback } from 'react'
import { VideoAnalysisResult, downloadAsJson, downloadAsText, formatChaptersAsText, copyToClipboard } from '@/lib/utils'

interface ResultViewerProps {
  data: VideoAnalysisResult
}

type TabId = 'overview' | 'script' | 'chapters' | 'summary' | 'concepts'

export default function ResultViewer({ data }: ResultViewerProps) {
  const [activeTab, setActiveTab] = useState<TabId>('overview')
  const [copied, setCopied] = useState(false)

  // Keyboard shortcuts for tab switching (1-5)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger when typing in input fields
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return
      }

      const tabMap: Record<string, TabId> = {
        '1': 'overview',
        '2': 'script',
        '3': 'chapters',
        '4': 'summary',
        '5': 'concepts',
      }

      if (tabMap[e.key]) {
        e.preventDefault()
        setActiveTab(tabMap[e.key])
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  const handleCopy = async (text: string) => {
    try {
      await copyToClipboard(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (error) {
      console.error('Failed to copy:', error)
    }
  }

  const tabs = [
    { id: 'overview', label: 'Overview', icon: '1', shortcut: '1' },
    { id: 'script', label: 'Clean Script', icon: '2', shortcut: '2' },
    { id: 'chapters', label: 'Chapters', icon: '3', shortcut: '3' },
    { id: 'summary', label: 'Full Summary', icon: '4', shortcut: '4' },
    { id: 'concepts', label: 'Key Concepts', icon: '5', shortcut: '5' },
  ] as const

  const metadata = data.content_metadata

  return (
    <div className="w-full space-y-6">
      {/* Content Extraction Summary Card */}
      {metadata && (
        <div className="bg-gradient-to-r from-primary-50 to-blue-50 border border-primary-200 rounded-xl p-6">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="text-lg font-semibold text-primary-900 flex items-center space-x-2">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>Content Extraction Complete</span>
              </h3>
              <p className="text-sm text-primary-700 mt-1">
                Core learning content has been extracted from your class recording
              </p>
            </div>
            <div className="text-right">
              <div className="text-3xl font-bold text-primary-600">
                {metadata.content_removed_percentage}%
              </div>
              <div className="text-xs text-primary-600">content filtered</div>
            </div>
          </div>
          
          <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white/60 rounded-lg p-3">
              <div className="text-xs text-gray-500 uppercase tracking-wide">Original</div>
              <div className="text-lg font-semibold text-gray-800">{metadata.original_duration_estimate}</div>
            </div>
            <div className="bg-white/60 rounded-lg p-3">
              <div className="text-xs text-gray-500 uppercase tracking-wide">Essential Content</div>
              <div className="text-lg font-semibold text-green-700">{metadata.essential_content_duration}</div>
            </div>
            <div className="bg-white/60 rounded-lg p-3">
              <div className="text-xs text-gray-500 uppercase tracking-wide">Chapters</div>
              <div className="text-lg font-semibold text-gray-800">{data.chapters.length}</div>
            </div>
            <div className="bg-white/60 rounded-lg p-3">
              <div className="text-xs text-gray-500 uppercase tracking-wide">Key Concepts</div>
              <div className="text-lg font-semibold text-gray-800">{data.important_concepts.length}</div>
            </div>
          </div>
        </div>
      )}

      {/* Download Buttons */}
      <div className="flex flex-wrap gap-3 justify-end">
        <button
          onClick={() => downloadAsJson(data, 'analysis-result.json')}
          className="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-800 text-sm font-medium rounded-lg transition-colors flex items-center space-x-2"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
            />
          </svg>
          <span>JSON</span>
        </button>
        <button
          onClick={() => downloadAsText(data.clean_script, 'clean-script.txt')}
          className="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-800 text-sm font-medium rounded-lg transition-colors flex items-center space-x-2"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
            />
          </svg>
          <span>Script</span>
        </button>
        <button
          onClick={() => downloadAsText(formatChaptersAsText(data.chapters), 'chapters.txt')}
          className="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-800 text-sm font-medium rounded-lg transition-colors flex items-center space-x-2"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
            />
          </svg>
          <span>Chapters</span>
        </button>
      </div>

      {/* Tab Navigation */}
      <div className="flex border-b border-gray-200 overflow-x-auto">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap flex items-center gap-2 ${
              activeTab === tab.id
                ? 'border-primary-600 text-primary-600'
                : 'border-transparent text-gray-600 hover:text-gray-900'
            }`}
            title={`Press ${tab.shortcut} to switch`}
          >
            <kbd className={`px-1.5 py-0.5 text-xs rounded ${
              activeTab === tab.id
                ? 'bg-primary-100 text-primary-700'
                : 'bg-gray-100 text-gray-500'
            }`}>{tab.icon}</kbd>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="space-y-4">
        {/* Overview Tab - Content Metadata */}
        {activeTab === 'overview' && metadata && (
          <div className="space-y-6">
            {/* Main Content Timestamps */}
            {metadata.main_content_timestamps && metadata.main_content_timestamps.length > 0 && (
              <div>
                <h3 className="text-lg font-semibold text-gray-800 mb-4 flex items-center space-x-2">
                  <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span>Essential Content Sections</span>
                </h3>
                <div className="space-y-3">
                  {metadata.main_content_timestamps.map((section, index) => (
                    <div key={index} className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-start space-x-4">
                      <div className="flex-shrink-0 w-20 text-center">
                        <div className="text-sm font-mono font-semibold text-green-700">{section.start}</div>
                        <div className="text-xs text-green-500">to</div>
                        <div className="text-sm font-mono font-semibold text-green-700">{section.end}</div>
                      </div>
                      <div className="flex-1">
                        <p className="text-sm text-green-800">{section.description}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Filtered Content Categories */}
            {metadata.filtered_categories && metadata.filtered_categories.length > 0 && (
              <div>
                <h3 className="text-lg font-semibold text-gray-800 mb-4 flex items-center space-x-2">
                  <svg className="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                  <span>Filtered Content</span>
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {metadata.filtered_categories.map((category, index) => (
                    <div key={index} className="bg-red-50 border border-red-200 rounded-lg p-4">
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="font-medium text-red-800">{category.category}</h4>
                        <span className="text-xs font-mono bg-red-100 text-red-700 px-2 py-1 rounded">
                          {category.approximate_duration}
                        </span>
                      </div>
                      <p className="text-sm text-red-600">{category.description}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Quick Stats */}
            <div className="bg-gray-50 rounded-lg p-6 border border-gray-200">
              <h3 className="text-lg font-semibold text-gray-800 mb-4">Analysis Summary</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-sm text-gray-500">Total Chapters</div>
                  <div className="text-2xl font-bold text-gray-800">{data.chapters.length}</div>
                </div>
                <div>
                  <div className="text-sm text-gray-500">Key Concepts</div>
                  <div className="text-2xl font-bold text-gray-800">{data.important_concepts.length}</div>
                </div>
                <div>
                  <div className="text-sm text-gray-500">Practice Items</div>
                  <div className="text-2xl font-bold text-gray-800">{data.recommended_practice.length}</div>
                </div>
                <div>
                  <div className="text-sm text-gray-500">Content Efficiency</div>
                  <div className="text-2xl font-bold text-green-600">{100 - metadata.content_removed_percentage}%</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Clean Script Tab */}
        {activeTab === 'script' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-800">Clean Teaching Script</h3>
              <button
                onClick={() => handleCopy(data.clean_script)}
                className="px-3 py-1 text-xs font-medium bg-primary-50 text-primary-600 hover:bg-primary-100 rounded transition-colors flex items-center space-x-1"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                  />
                </svg>
                <span>{copied ? 'Copied!' : 'Copy'}</span>
              </button>
            </div>
            <p className="text-sm text-gray-500">
              This is the cleaned and structured version of the teaching content, with all filler removed.
            </p>
            <div className="bg-gray-50 p-6 rounded-lg border border-gray-200 max-h-[500px] overflow-y-auto">
              <p className="text-gray-700 whitespace-pre-wrap leading-relaxed">
                {data.clean_script}
              </p>
            </div>
          </div>
        )}

        {/* Chapters Tab */}
        {activeTab === 'chapters' && (
          <div className="space-y-4">
            <p className="text-sm text-gray-500">
              The recording has been divided into {data.chapters.length} chapters based on topic changes.
            </p>
            {data.chapters.map((chapter, index) => (
              <div key={index} className="bg-gray-50 p-5 rounded-lg border border-gray-200">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h4 className="text-base font-semibold text-gray-800">
                      Chapter {index + 1}: {chapter.title}
                    </h4>
                    <p className="text-sm text-gray-500 mt-1 flex items-center space-x-1">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <span>{chapter.start_time} → {chapter.end_time}</span>
                    </p>
                  </div>
                </div>
                <div className="space-y-3">
                  <div>
                    <h5 className="text-sm font-medium text-gray-700 mb-2">Summary</h5>
                    <p className="text-sm text-gray-600">{chapter.summary}</p>
                  </div>
                  {chapter.key_points.length > 0 && (
                    <div>
                      <h5 className="text-sm font-medium text-gray-700 mb-2">Key Points</h5>
                      <ul className="space-y-1">
                        {chapter.key_points.map((point, idx) => (
                          <li key={idx} className="text-sm text-gray-600 flex items-start space-x-2">
                            <span className="text-primary-600 mt-1">•</span>
                            <span>{point}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Summary Tab */}
        {activeTab === 'summary' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-800">Full Session Summary</h3>
              <button
                onClick={() => handleCopy(data.full_session_summary)}
                className="px-3 py-1 text-xs font-medium bg-primary-50 text-primary-600 hover:bg-primary-100 rounded transition-colors flex items-center space-x-1"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                  />
                </svg>
                <span>{copied ? 'Copied!' : 'Copy'}</span>
              </button>
            </div>
            <div className="bg-gray-50 p-6 rounded-lg border border-gray-200 max-h-[500px] overflow-y-auto">
              <p className="text-gray-700 whitespace-pre-wrap leading-relaxed">
                {data.full_session_summary}
              </p>
            </div>
          </div>
        )}

        {/* Concepts Tab */}
        {activeTab === 'concepts' && (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-semibold text-gray-800 mb-4">Important Concepts</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {data.important_concepts.map((concept, index) => (
                  <div
                    key={index}
                    className="bg-primary-50 border border-primary-200 p-4 rounded-lg hover:bg-primary-100 transition-colors"
                  >
                    <p className="text-sm font-medium text-primary-900">{concept}</p>
                  </div>
                ))}
              </div>
            </div>

            {data.recommended_practice.length > 0 && (
              <div>
                <h3 className="text-lg font-semibold text-gray-800 mb-4">Recommended Practice</h3>
                <div className="bg-amber-50 border border-amber-200 p-5 rounded-lg space-y-2">
                  {data.recommended_practice.map((practice, index) => (
                    <div key={index} className="flex items-start space-x-3">
                      <span className="text-amber-600 mt-1">✓</span>
                      <p className="text-sm text-amber-900">{practice}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
