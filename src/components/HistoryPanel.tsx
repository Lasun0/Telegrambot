'use client'

import { useState } from 'react'
import { HistoryEntry } from '@/lib/hooks'
import { formatFileSize } from '@/lib/utils'

interface HistoryPanelProps {
  history: HistoryEntry[]
  onSelectEntry: (entry: HistoryEntry) => void
  onDeleteEntry: (id: string) => void
  onClearAll: () => void
  isOpen: boolean
  onClose: () => void
}

export default function HistoryPanel({
  history,
  onSelectEntry,
  onDeleteEntry,
  onClearAll,
  isOpen,
  onClose,
}: HistoryPanelProps) {
  const [confirmClear, setConfirmClear] = useState(false)

  if (!isOpen) return null

  const formatDate = (isoString: string) => {
    const date = new Date(isoString)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)

    if (diffMins < 1) return 'Just now'
    if (diffMins < 60) return `${diffMins}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    if (diffDays < 7) return `${diffDays}d ago`

    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
    })
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/30 backdrop-blur-sm z-40 transition-opacity"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="fixed right-0 top-0 h-full w-full max-w-md bg-white shadow-2xl z-50 flex flex-col animate-slide-in">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Processing History</h2>
            <p className="text-sm text-gray-500">{history.length} recordings</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            aria-label="Close history"
          >
            <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* History List */}
        <div className="flex-1 overflow-y-auto">
          {history.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-400 p-8">
              <svg className="w-16 h-16 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <p className="text-center">No processing history yet.</p>
              <p className="text-center text-sm mt-1">Your processed recordings will appear here.</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {history.map((entry) => (
                <div
                  key={entry.id}
                  className="p-4 hover:bg-gray-50 transition-colors cursor-pointer group"
                  onClick={() => onSelectEntry(entry)}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-medium text-gray-900 truncate pr-2">
                        {entry.fileName}
                      </h3>
                      <div className="flex items-center gap-2 mt-1 text-sm text-gray-500">
                        <span>{formatFileSize(entry.fileSize)}</span>
                        <span>-</span>
                        <span>{formatDate(entry.processedAt)}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-2">
                        <span className="text-xs px-2 py-0.5 bg-primary-100 text-primary-700 rounded">
                          {entry.result.chapters.length} chapters
                        </span>
                        <span className="text-xs px-2 py-0.5 bg-green-100 text-green-700 rounded">
                          {entry.result.content_metadata?.content_removed_percentage || 0}% filtered
                        </span>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          onDeleteEntry(entry.id)
                        }}
                        className="p-1.5 hover:bg-red-100 rounded transition-colors"
                        title="Delete from history"
                      >
                        <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                          />
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        {history.length > 0 && (
          <div className="p-4 border-t border-gray-200">
            {confirmClear ? (
              <div className="flex items-center justify-between bg-red-50 p-3 rounded-lg">
                <span className="text-sm text-red-700">Clear all history?</span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setConfirmClear(false)}
                    className="px-3 py-1 text-sm text-gray-600 hover:bg-gray-100 rounded transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      onClearAll()
                      setConfirmClear(false)
                    }}
                    className="px-3 py-1 text-sm text-white bg-red-500 hover:bg-red-600 rounded transition-colors"
                  >
                    Clear All
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setConfirmClear(true)}
                className="w-full px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                  />
                </svg>
                Clear History
              </button>
            )}
          </div>
        )}
      </div>

      {/* Animation styles */}
      <style jsx>{`
        @keyframes slide-in {
          from {
            transform: translateX(100%);
          }
          to {
            transform: translateX(0);
          }
        }
        .animate-slide-in {
          animation: slide-in 0.2s ease-out;
        }
      `}</style>
    </>
  )
}
