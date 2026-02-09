'use client'

import { useState, useEffect } from 'react'
import { useModelCache } from '@/lib/hooks'

interface Model {
  id: string
  name: string
  description: string
  inputTokenLimit: number
  outputTokenLimit: number
  provider: 'gemini' | 'knight'
}

interface ModelSelectorProps {
  selectedModel: string
  onModelChange: (modelId: string) => void
  disabled?: boolean
}

export default function ModelSelector({ selectedModel, onModelChange, disabled }: ModelSelectorProps) {
  const [models, setModels] = useState<Model[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isOpen, setIsOpen] = useState(false)

  const { getCachedModels, setCachedModels } = useModelCache()

  useEffect(() => {
    fetchModels()
  }, [])

  const fetchModels = async () => {
    // Check cache first
    const cached = getCachedModels()
    if (cached) {
      setModels(cached.models)
      if (!selectedModel && cached.defaultModel) {
        onModelChange(cached.defaultModel)
      }
      setLoading(false)
      return
    }

    try {
      setLoading(true)
      setError(null)

      const response = await fetch('/api/models')

      if (!response.ok) {
        throw new Error('Failed to fetch models')
      }

      const data = await response.json()
      setModels(data.models || [])

      // Cache the models
      setCachedModels(data.models || [], data.defaultModel)

      // Set default model if none selected
      if (!selectedModel && data.defaultModel) {
        onModelChange(data.defaultModel)
      }
    } catch (err) {
      console.error('Error fetching models:', err)
      setError('Failed to load models')
      // Set fallback models
      setModels([
        { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash', description: 'Fast and efficient', inputTokenLimit: 1048576, outputTokenLimit: 8192, provider: 'gemini' },
        { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro', description: 'Most capable', inputTokenLimit: 2097152, outputTokenLimit: 8192, provider: 'gemini' },
        { id: 'gemini-2.0-flash-exp', name: 'Gemini 2.0 Flash (Experimental)', description: 'Latest experimental model', inputTokenLimit: 1048576, outputTokenLimit: 8192, provider: 'gemini' },
      ])
    } finally {
      setLoading(false)
    }
  }

  const selectedModelData = models.find(m => m.id === selectedModel)

  // Group models by provider
  const geminiModels = models.filter(m => m.provider === 'gemini')
  const knightModels = models.filter(m => m.provider === 'knight')

  const formatTokenLimit = (limit: number): string => {
    if (limit >= 1000000) {
      return `${(limit / 1000000).toFixed(1)}M`
    }
    if (limit >= 1000) {
      return `${(limit / 1000).toFixed(0)}K`
    }
    return limit.toString()
  }

  const getProviderIcon = (provider: 'gemini' | 'knight') => {
    if (provider === 'gemini') {
      return (
        <div className="w-6 h-6 bg-gradient-to-br from-blue-500 to-purple-600 rounded flex items-center justify-center">
          <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        </div>
      )
    }
    return (
      <div className="w-6 h-6 bg-gradient-to-br from-orange-500 to-red-600 rounded flex items-center justify-center">
        <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
        </svg>
      </div>
    )
  }

  const getProviderLabel = (provider: 'gemini' | 'knight') => {
    return provider === 'gemini' ? 'Google Gemini' : 'Knight API'
  }

  const renderModelGroup = (groupModels: Model[], provider: 'gemini' | 'knight') => {
    if (groupModels.length === 0) return null

    return (
      <div key={provider}>
        <div className="px-3 py-2 text-xs font-semibold text-gray-500 bg-gray-50 flex items-center gap-2 sticky top-0">
          {getProviderIcon(provider)}
          <span>{getProviderLabel(provider)}</span>
          <span className="text-gray-400">({groupModels.length})</span>
          {provider === 'gemini' && (
            <span className="ml-auto text-xs text-green-600 bg-green-100 px-1.5 py-0.5 rounded">Video ✓</span>
          )}
        </div>
        {groupModels.map((model) => (
          <button
            key={model.id}
            type="button"
            onClick={() => {
              onModelChange(model.id)
              setIsOpen(false)
            }}
            className={`w-full p-3 text-left hover:bg-gray-50 transition-colors border-b border-gray-100 last:border-b-0 ${selectedModel === model.id ? 'bg-primary-50' : ''
              }`}
          >
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center space-x-2">
                  <span className="text-sm font-medium text-gray-900">{model.name}</span>
                  {selectedModel === model.id && (
                    <svg className="w-4 h-4 text-primary-600" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  )}
                </div>
                {model.description && (
                  <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{model.description}</p>
                )}
              </div>
              <div className="text-right ml-3">
                <div className="text-xs text-gray-400">
                  {formatTokenLimit(model.inputTokenLimit)} in
                </div>
                <div className="text-xs text-gray-400">
                  {formatTokenLimit(model.outputTokenLimit)} out
                </div>
              </div>
            </div>
          </button>
        ))}
      </div>
    )
  }

  return (
    <div className="relative">
      <label className="block text-sm font-medium text-gray-700 mb-2">
        AI Model
      </label>

      {loading ? (
        <div className="flex items-center space-x-2 p-3 bg-gray-50 rounded-lg border border-gray-200">
          <svg className="animate-spin h-4 w-4 text-primary-600" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          <span className="text-sm text-gray-500">Loading models...</span>
        </div>
      ) : (
        <div className="relative">
          <button
            type="button"
            onClick={() => !disabled && setIsOpen(!isOpen)}
            disabled={disabled}
            className={`w-full flex items-center justify-between p-3 bg-white rounded-lg border transition-colors ${disabled
              ? 'border-gray-200 bg-gray-50 cursor-not-allowed'
              : 'border-gray-300 hover:border-primary-400 cursor-pointer'
              } ${isOpen ? 'border-primary-500 ring-2 ring-primary-100' : ''}`}
          >
            <div className="flex items-center space-x-3">
              {selectedModelData ? getProviderIcon(selectedModelData.provider) : (
                <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center">
                  <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                </div>
              )}
              <div className="text-left">
                <div className="text-sm font-medium text-gray-900">
                  {selectedModelData?.name || selectedModel || 'Select a model'}
                </div>
                <div className="text-xs text-gray-500 flex items-center gap-1">
                  {selectedModelData && (
                    <>
                      <span className={`px-1 py-0.5 rounded text-[10px] ${selectedModelData.provider === 'gemini'
                        ? 'bg-blue-100 text-blue-700'
                        : 'bg-orange-100 text-orange-700'
                        }`}>
                        {getProviderLabel(selectedModelData.provider)}
                      </span>
                      <span>• {formatTokenLimit(selectedModelData.inputTokenLimit)} tokens</span>
                    </>
                  )}
                </div>
              </div>
            </div>
            <svg
              className={`w-5 h-5 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {/* Dropdown */}
          {isOpen && !disabled && (
            <div className="absolute z-10 w-full mt-2 bg-white rounded-lg border border-gray-200 shadow-lg max-h-96 overflow-y-auto">
              {error && (
                <div className="p-3 text-sm text-amber-600 bg-amber-50 border-b border-amber-100">
                  {error} - Using fallback models
                </div>
              )}

              {/* Gemini Models */}
              {renderModelGroup(geminiModels, 'gemini')}

              {/* Knight API Models */}
              {renderModelGroup(knightModels, 'knight')}

              {/* Refresh button */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  fetchModels()
                }}
                className="w-full p-2 text-center text-xs text-primary-600 hover:bg-primary-50 transition-colors flex items-center justify-center space-x-1"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                <span>Refresh models</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* Click outside to close */}
      {isOpen && (
        <div
          className="fixed inset-0 z-0"
          onClick={() => setIsOpen(false)}
        />
      )}
    </div>
  )
}