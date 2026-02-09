/**
 * API Key Pool Manager
 * Manages multiple Gemini API keys for load balancing and parallel processing
 */

export interface ApiKeyStatus {
  key: string
  isAvailable: boolean
  lastUsed: number
  requestCount: number
  errorCount: number
  rateLimitedUntil: number
}

export interface ApiKeyPoolConfig {
  keys: string[]
  maxConcurrentPerKey?: number
  rateLimitCooldownMs?: number
}

class ApiKeyPool {
  private keys: ApiKeyStatus[] = []
  private maxConcurrentPerKey: number
  private rateLimitCooldownMs: number
  private activeRequests: Map<string, number> = new Map()
  private lockQueue: Array<{ resolve: (key: string) => void; reject: (err: Error) => void }> = []

  constructor(config: ApiKeyPoolConfig) {
    this.keys = config.keys.filter(k => k && k.trim()).map(key => ({
      key: key.trim(),
      isAvailable: true,
      lastUsed: 0,
      requestCount: 0,
      errorCount: 0,
      rateLimitedUntil: 0,
    }))

    this.maxConcurrentPerKey = config.maxConcurrentPerKey || 3
    this.rateLimitCooldownMs = config.rateLimitCooldownMs || 60000 // 1 minute default

    // Initialize active request counters
    this.keys.forEach(k => this.activeRequests.set(k.key, 0))

    console.log(`[ApiKeyPool] Initialized with ${this.keys.length} API key(s)`)
  }

  /**
   * Get all registered API keys
   */
  getKeys(): string[] {
    return this.keys.map(k => k.key)
  }

  /**
   * Get the total number of available keys
   */
  getKeyCount(): number {
    return this.keys.length
  }

  /**
   * Get max concurrent requests across all keys
   */
  getMaxConcurrency(): number {
    return this.keys.length * this.maxConcurrentPerKey
  }

  /**
   * Get current pool status
   */
  getStatus(): {
    totalKeys: number
    availableKeys: number
    activeRequests: number
    maxConcurrency: number
  } {
    const now = Date.now()
    const availableKeys = this.keys.filter(k =>
      k.rateLimitedUntil < now &&
      (this.activeRequests.get(k.key) || 0) < this.maxConcurrentPerKey
    ).length

    let totalActive = 0
    this.activeRequests.forEach(count => totalActive += count)

    return {
      totalKeys: this.keys.length,
      availableKeys,
      activeRequests: totalActive,
      maxConcurrency: this.getMaxConcurrency()
    }
  }

  /**
   * Acquire an available API key using round-robin with load awareness
   * Returns null if no keys are available
   */
  async acquireKey(timeoutMs: number = 30000): Promise<string | null> {
    const startTime = Date.now()

    while (Date.now() - startTime < timeoutMs) {
      const key = this.tryAcquireKey()
      if (key) {
        return key
      }

      // Wait a bit before retrying
      await new Promise(resolve => setTimeout(resolve, 100))
    }

    console.warn('[ApiKeyPool] Timeout waiting for available key')
    return null
  }

  /**
   * Try to acquire a key immediately (non-blocking)
   */
  private tryAcquireKey(): string | null {
    const now = Date.now()

    // Find the best available key (least recently used with capacity)
    let bestKey: ApiKeyStatus | null = null
    let lowestLoad = Infinity

    for (const keyStatus of this.keys) {
      // Skip rate-limited keys
      if (keyStatus.rateLimitedUntil > now) {
        continue
      }

      const activeCount = this.activeRequests.get(keyStatus.key) || 0

      // Skip fully loaded keys
      if (activeCount >= this.maxConcurrentPerKey) {
        continue
      }

      // Prefer keys with fewer active requests
      // Use lastUsed as tiebreaker for round-robin behavior
      const load = activeCount * 1000 + keyStatus.lastUsed / 1000000
      if (load < lowestLoad) {
        lowestLoad = load
        bestKey = keyStatus
      }
    }

    if (bestKey) {
      bestKey.lastUsed = now
      bestKey.requestCount++
      this.activeRequests.set(
        bestKey.key,
        (this.activeRequests.get(bestKey.key) || 0) + 1
      )
      return bestKey.key
    }

    return null
  }

  /**
   * Release a key back to the pool
   */
  releaseKey(key: string, hadError: boolean = false): void {
    const keyStatus = this.keys.find(k => k.key === key)
    if (!keyStatus) return

    const currentCount = this.activeRequests.get(key) || 0
    this.activeRequests.set(key, Math.max(0, currentCount - 1))

    if (hadError) {
      keyStatus.errorCount++
    }

    // Process waiting requests in queue
    if (this.lockQueue.length > 0) {
      const nextKey = this.tryAcquireKey()
      if (nextKey) {
        const waiting = this.lockQueue.shift()
        if (waiting) {
          waiting.resolve(nextKey)
        } else {
          // No one waiting, release the key we just acquired
          this.releaseKey(nextKey)
        }
      }
    }
  }

  /**
   * Mark a key as rate limited
   */
  markRateLimited(key: string): void {
    const keyStatus = this.keys.find(k => k.key === key)
    if (keyStatus) {
      keyStatus.rateLimitedUntil = Date.now() + this.rateLimitCooldownMs
      console.log(`[ApiKeyPool] Key marked as rate limited until ${new Date(keyStatus.rateLimitedUntil).toISOString()}`)
    }
  }

  /**
   * Execute a function with an acquired API key
   * Automatically handles acquiring and releasing the key
   */
  async withKey<T>(
    fn: (key: string) => Promise<T>,
    timeoutMs: number = 30000
  ): Promise<T> {
    const key = await this.acquireKey(timeoutMs)

    if (!key) {
      throw new Error('No API keys available')
    }

    try {
      const result = await fn(key)
      this.releaseKey(key, false)
      return result
    } catch (error) {
      // Check if it's a rate limit error
      const isRateLimit = error instanceof Error &&
        (error.message.includes('429') ||
         error.message.includes('rate limit') ||
         error.message.includes('quota'))

      if (isRateLimit) {
        this.markRateLimited(key)
      }

      this.releaseKey(key, true)
      throw error
    }
  }

  /**
   * Execute multiple functions in parallel with load balancing
   */
  async parallelWithKeys<T>(
    tasks: Array<(key: string) => Promise<T>>,
    maxConcurrent?: number
  ): Promise<T[]> {
    const concurrency = maxConcurrent || this.getMaxConcurrency()
    const results: T[] = []
    const errors: Error[] = []

    // Process tasks in batches based on available concurrency
    const executing: Promise<void>[] = []

    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i]
      const taskIndex = i

      const promise = (async () => {
        try {
          const result = await this.withKey(task)
          results[taskIndex] = result
        } catch (error) {
          errors[taskIndex] = error instanceof Error ? error : new Error(String(error))
          throw error
        }
      })()

      executing.push(promise)

      // If we've hit the concurrency limit, wait for one to complete
      if (executing.length >= concurrency) {
        await Promise.race(executing.map(p => p.catch(() => {})))
        // Remove completed promises
        for (let j = executing.length - 1; j >= 0; j--) {
          const state = await Promise.race([
            executing[j].then(() => 'fulfilled').catch(() => 'rejected'),
            Promise.resolve('pending')
          ])
          if (state !== 'pending') {
            executing.splice(j, 1)
          }
        }
      }
    }

    // Wait for remaining tasks
    await Promise.allSettled(executing)

    // If all tasks failed, throw the first error
    if (errors.filter(e => e).length === tasks.length) {
      throw errors.find(e => e) || new Error('All tasks failed')
    }

    return results
  }
}

// Global singleton instance
let globalPool: ApiKeyPool | null = null

/**
 * Initialize or get the global API key pool
 */
export function getApiKeyPool(): ApiKeyPool {
  if (!globalPool) {
    // Parse API keys from environment
    const primaryKey = process.env.GEMINI_API_KEY || ''
    const additionalKeys = (process.env.GEMINI_API_KEYS || '')
      .split(',')
      .map(k => k.trim())
      .filter(k => k.length > 0)

    // Combine all keys (primary + additional)
    const allKeys = [primaryKey, ...additionalKeys].filter(k => k.length > 0)

    // Remove duplicates
    const uniqueKeys = [...new Set(allKeys)]

    const maxConcurrent = parseInt(process.env.MAX_CONCURRENT_PER_KEY || '3')
    const rateLimitCooldown = parseInt(process.env.RATE_LIMIT_COOLDOWN_MS || '60000')

    globalPool = new ApiKeyPool({
      keys: uniqueKeys,
      maxConcurrentPerKey: maxConcurrent,
      rateLimitCooldownMs: rateLimitCooldown,
    })
  }

  return globalPool
}

/**
 * Reset the global pool (useful for testing)
 */
export function resetApiKeyPool(): void {
  globalPool = null
}

export { ApiKeyPool }
