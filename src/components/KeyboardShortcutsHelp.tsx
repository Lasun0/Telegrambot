'use client'

interface KeyboardShortcutsHelpProps {
  isOpen: boolean
  onClose: () => void
}

const shortcuts = [
  { keys: ['?'], description: 'Show keyboard shortcuts' },
  { keys: ['H'], description: 'Toggle history panel' },
  { keys: ['U'], description: 'Upload new video' },
  { keys: ['Esc'], description: 'Close panels / Cancel' },
  { keys: ['Ctrl', 'C'], description: 'Copy current content' },
  { keys: ['1-5'], description: 'Switch result tabs' },
]

export default function KeyboardShortcutsHelp({ isOpen, onClose }: KeyboardShortcutsHelpProps) {
  if (!isOpen) return null

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50 transition-opacity"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden animate-scale-in">
          {/* Header */}
          <div className="flex items-center justify-between p-5 border-b border-gray-200">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-primary-100 rounded-lg flex items-center justify-center">
                <svg className="w-5 h-5 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707"
                  />
                </svg>
              </div>
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Keyboard Shortcuts</h2>
                <p className="text-sm text-gray-500">Quick actions for power users</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Shortcuts List */}
          <div className="p-5 space-y-3">
            {shortcuts.map((shortcut, index) => (
              <div
                key={index}
                className="flex items-center justify-between py-2"
              >
                <span className="text-sm text-gray-700">{shortcut.description}</span>
                <div className="flex items-center gap-1">
                  {shortcut.keys.map((key, keyIndex) => (
                    <span key={keyIndex}>
                      {keyIndex > 0 && <span className="text-gray-400 mx-1">+</span>}
                      <kbd className="px-2 py-1 text-xs font-semibold text-gray-700 bg-gray-100 border border-gray-200 rounded shadow-sm">
                        {key}
                      </kbd>
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Footer */}
          <div className="px-5 py-4 bg-gray-50 border-t border-gray-200">
            <p className="text-xs text-gray-500 text-center">
              Press <kbd className="px-1.5 py-0.5 text-xs font-medium bg-white border border-gray-200 rounded">Esc</kbd> to close
            </p>
          </div>
        </div>
      </div>

      {/* Animation styles */}
      <style jsx>{`
        @keyframes scale-in {
          from {
            opacity: 0;
            transform: scale(0.95);
          }
          to {
            opacity: 1;
            transform: scale(1);
          }
        }
        .animate-scale-in {
          animation: scale-in 0.15s ease-out;
        }
      `}</style>
    </>
  )
}
