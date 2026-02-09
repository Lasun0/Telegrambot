'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { VideoAnalysisResult } from './utils'

// ============================================
// Processing History Hook
// ============================================

export interface HistoryEntry {
  id: string
  fileName: string
  fileSize: number
  processedAt: string
  modelUsed: string
  result: VideoAnalysisResult
  thumbnailUrl?: string
}

const HISTORY_KEY = 'clean-class-recorder-history'
const MAX_HISTORY_ITEMS = 20

export function useProcessingHistory() {
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [isLoaded, setIsLoaded] = useState(false)

  // Load history from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(HISTORY_KEY)
      if (stored) {
        const parsed = JSON.parse(stored) as HistoryEntry[]
        setHistory(parsed)
      }
    } catch (error) {
      console.error('Failed to load processing history:', error)
    }
    setIsLoaded(true)
  }, [])

  // Save to localStorage whenever history changes
  useEffect(() => {
    if (isLoaded) {
      try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(history))
      } catch (error) {
        console.error('Failed to save processing history:', error)
      }
    }
  }, [history, isLoaded])

  const addToHistory = useCallback((entry: Omit<HistoryEntry, 'id' | 'processedAt'>) => {
    const newEntry: HistoryEntry = {
      ...entry,
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      processedAt: new Date().toISOString(),
    }

    setHistory(prev => {
      const updated = [newEntry, ...prev].slice(0, MAX_HISTORY_ITEMS)
      return updated
    })

    return newEntry.id
  }, [])

  const removeFromHistory = useCallback((id: string) => {
    setHistory(prev => prev.filter(entry => entry.id !== id))
  }, [])

  const clearHistory = useCallback(() => {
    setHistory([])
    localStorage.removeItem(HISTORY_KEY)
  }, [])

  const getHistoryEntry = useCallback((id: string) => {
    return history.find(entry => entry.id === id) || null
  }, [history])

  return {
    history,
    isLoaded,
    addToHistory,
    removeFromHistory,
    clearHistory,
    getHistoryEntry,
  }
}

// ============================================
// Model Cache Hook
// ============================================

interface CachedModels {
  models: Array<{
    id: string
    name: string
    description: string
    inputTokenLimit: number
    outputTokenLimit: number
    provider: 'gemini' | 'knight'
  }>
  defaultModel: string
  cachedAt: number
}

const MODEL_CACHE_KEY = 'clean-class-recorder-models'
const MODEL_CACHE_TTL = 5 * 60 * 1000 // 5 minutes

export function useModelCache() {
  const getCachedModels = useCallback((): CachedModels | null => {
    try {
      const cached = localStorage.getItem(MODEL_CACHE_KEY)
      if (cached) {
        const parsed = JSON.parse(cached) as CachedModels
        if (Date.now() - parsed.cachedAt < MODEL_CACHE_TTL) {
          return parsed
        }
      }
    } catch (error) {
      console.error('Failed to get cached models:', error)
    }
    return null
  }, [])

  const setCachedModels = useCallback((models: CachedModels['models'], defaultModel: string) => {
    try {
      const cache: CachedModels = {
        models,
        defaultModel,
        cachedAt: Date.now(),
      }
      localStorage.setItem(MODEL_CACHE_KEY, JSON.stringify(cache))
    } catch (error) {
      console.error('Failed to cache models:', error)
    }
  }, [])

  const clearModelCache = useCallback(() => {
    localStorage.removeItem(MODEL_CACHE_KEY)
  }, [])

  return {
    getCachedModels,
    setCachedModels,
    clearModelCache,
  }
}

// ============================================
// Request Deduplication Hook
// ============================================

export function useRequestDeduplication() {
  const pendingRequests = useRef<Map<string, Promise<unknown>>>(new Map())

  const deduplicate = useCallback(<T>(
    key: string,
    requestFn: () => Promise<T>
  ): Promise<T> => {
    // Check if request is already in flight
    const existing = pendingRequests.current.get(key) as Promise<T> | undefined
    if (existing) {
      return existing
    }

    // Create new request and store it
    const request = requestFn().finally(() => {
      pendingRequests.current.delete(key)
    })

    pendingRequests.current.set(key, request)
    return request
  }, [])

  return { deduplicate }
}

// ============================================
// Keyboard Shortcuts Hook
// ============================================

type KeyboardShortcut = {
  key: string
  ctrl?: boolean
  shift?: boolean
  alt?: boolean
  handler: () => void
  description: string
}

export function useKeyboardShortcuts(shortcuts: KeyboardShortcut[], enabled = true) {
  useEffect(() => {
    if (!enabled) return

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger shortcuts when typing in input fields
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return
      }

      for (const shortcut of shortcuts) {
        const keyMatch = e.key.toLowerCase() === shortcut.key.toLowerCase()
        const ctrlMatch = !!shortcut.ctrl === (e.ctrlKey || e.metaKey)
        const shiftMatch = !!shortcut.shift === e.shiftKey
        const altMatch = !!shortcut.alt === e.altKey

        if (keyMatch && ctrlMatch && shiftMatch && altMatch) {
          e.preventDefault()
          shortcut.handler()
          return
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [shortcuts, enabled])
}

// ============================================
// Abort Controller Hook for Cancel Support
// ============================================

export function useAbortController() {
  const controllerRef = useRef<AbortController | null>(null)

  const createController = useCallback(() => {
    // Abort any existing controller
    if (controllerRef.current) {
      controllerRef.current.abort()
    }
    controllerRef.current = new AbortController()
    return controllerRef.current
  }, [])

  const abort = useCallback(() => {
    if (controllerRef.current) {
      controllerRef.current.abort()
      controllerRef.current = null
    }
  }, [])

  const getSignal = useCallback(() => {
    return controllerRef.current?.signal
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (controllerRef.current) {
        controllerRef.current.abort()
      }
    }
  }, [])

  return {
    createController,
    abort,
    getSignal,
    isAborted: controllerRef.current?.signal.aborted ?? false,
  }
}

// ============================================
// Lazy Load Hook for FFmpeg
// ============================================

type FFmpegStatus = 'idle' | 'loading' | 'ready' | 'error'

export function useLazyFFmpeg() {
  const [status, setStatus] = useState<FFmpegStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const ffmpegRef = useRef<unknown>(null)
  const loadPromiseRef = useRef<Promise<boolean> | null>(null)

  const load = useCallback(async () => {
    // Return existing promise if already loading
    if (loadPromiseRef.current) {
      return loadPromiseRef.current
    }

    // Already loaded
    if (status === 'ready' && ffmpegRef.current) {
      return true
    }

    setStatus('loading')
    setError(null)

    loadPromiseRef.current = (async () => {
      try {
        const FFmpegModule = await import('@ffmpeg/ffmpeg')
        const FFmpegUtilModule = await import('@ffmpeg/util')

        const { FFmpeg } = FFmpegModule
        const { toBlobURL } = FFmpegUtilModule

        const ffmpeg = new FFmpeg()

        const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd'

        const coreURL = await toBlobURL(
          `${baseURL}/ffmpeg-core.js`,
          'text/javascript'
        )
        const wasmURL = await toBlobURL(
          `${baseURL}/ffmpeg-core.wasm`,
          'application/wasm'
        )

        await ffmpeg.load({ coreURL, wasmURL })

        ffmpegRef.current = ffmpeg
        setStatus('ready')
        return true
      } catch (err) {
        setStatus('error')
        setError(err instanceof Error ? err.message : 'Failed to load FFmpeg')
        loadPromiseRef.current = null
        return false
      }
    })()

    return loadPromiseRef.current
  }, [status])

  return {
    status,
    error,
    ffmpeg: ffmpegRef.current,
    load,
    isReady: status === 'ready',
    isLoading: status === 'loading',
  }
}
