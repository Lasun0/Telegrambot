/**
 * Video Processing Queue
 * BullMQ queue for handling video processing jobs
 */

import { Queue, QueueEvents } from 'bullmq'
import IORedis from 'ioredis'
import { VideoJob, QueueStatus } from './types'

// Redis connection singleton
let redisConnection: IORedis | null = null
let connectionInitialized = false

// Create a new connection with shared configuration
function createRedisConnection(): IORedis {
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379'

  const baseOptions = {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    enableOfflineQueue: true,
    lazyConnect: false,
    keepAlive: 30000, // Keep connection alive
    connectTimeout: 30000, // Increased timeout for slower connections
    commandTimeout: 30000, // Add command timeout
    retryStrategy: (times: number) => {
      const maxRetries = 20 // Increased retries
      if (times > maxRetries) {
        console.error(`[Redis] Max retry attempts reached`)
        return null
      }
      const delay = Math.min(times * 2000, 30000) // Exponential backoff up to 30s
      console.log(`[Redis] Retry attempt ${times}/${maxRetries}, waiting ${delay}ms`)
      return delay
    },
    reconnectOnError: (err: Error) => {
      console.log('[Redis] Reconnect on error triggered:', err.message)
      const targetErrors = ['READONLY', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'ENOTFOUND', 'ECONNREFUSED']
      return targetErrors.some(e => err.message.includes(e)) ? 1 : false
    },
    autoResubscribe: true,
    autoResendUnfulfilledCommands: true
  }

  let connection: IORedis

  // Parse Redis URL for Upstash compatibility
  if (redisUrl.startsWith('rediss://')) {
    const url = new URL(redisUrl)
    connection = new IORedis({
      ...baseOptions,
      host: url.hostname,
      port: parseInt(url.port) || 6379,
      password: url.password,
      username: url.username || undefined,
      family: 4, // Force IPv4
      tls: {
        rejectUnauthorized: false,
        servername: url.hostname
      }
    })
  } else {
    connection = new IORedis(redisUrl, {
      ...baseOptions,
      family: 4 // Force IPv4
    })
  }

  connection.on('error', (err) => {
    console.error('[Redis] Connection error:', err.message)
  })

  connection.on('connect', () => {
    console.log('[Redis] Connected successfully')
  })

  connection.on('ready', () => {
    console.log('[Redis] Ready to accept commands')
  })

  connection.on('close', () => {
    console.warn('[Redis] Connection closed, will attempt to reconnect')
  })

  connection.on('reconnecting', (delay: number) => {
    console.log(`[Redis] Reconnecting in ${delay}ms...`)
  })

  connection.on('end', () => {
    console.warn('[Redis] Connection ended')
  })

  return connection
}

export function getRedisConnection(): IORedis {
  if (!redisConnection || redisConnection.status === 'end' || redisConnection.status === 'close') {
    if (connectionInitialized && redisConnection) {
      console.log('[Redis] Recreating connection due to status:', redisConnection.status)
    }
    redisConnection = createRedisConnection()
    connectionInitialized = true
  }
  return redisConnection
}

// Queue name
const QUEUE_NAME = 'video-processing'

// Queue singleton
let videoQueue: Queue<VideoJob> | null = null
let queueEvents: QueueEvents | null = null

export function getVideoQueue(): Queue<VideoJob> {
  if (!videoQueue) {
    videoQueue = new Queue<VideoJob>(QUEUE_NAME, {
      connection: getRedisConnection(), // Reuse the shared connection
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000
        },
        removeOnComplete: {
          count: 100, // Keep last 100 completed jobs
          age: 24 * 3600 // Remove after 24 hours
        },
        removeOnFail: {
          count: 50 // Keep last 50 failed jobs for debugging
        }
      }
    })

    console.log('[Queue] Video processing queue initialized')
  }

  return videoQueue
}

export function getQueueEvents(): QueueEvents {
  if (!queueEvents) {
    queueEvents = new QueueEvents(QUEUE_NAME, {
      connection: getRedisConnection() // Reuse the shared connection
    })
  }

  return queueEvents
}

/**
 * Add a video processing job to the queue
 */
export async function addVideoJob(job: VideoJob): Promise<{ jobId: string; position: number }> {
  const queue = getVideoQueue()

  // Check queue size limit
  const maxQueueSize = parseInt(process.env.MAX_QUEUE_SIZE || '10')
  const waitingCount = await queue.getWaitingCount()

  if (waitingCount >= maxQueueSize) {
    throw new Error(`Queue is full (${waitingCount}/${maxQueueSize}). Please try again later.`)
  }

  // Add job with priority based on FIFO
  const addedJob = await queue.add('process-video', job, {
    priority: Date.now() // Lower = higher priority, so earlier jobs have priority
  })

  // Get position in queue
  const position = await getJobPosition(addedJob.id!)

  console.log(`[Queue] Job ${addedJob.id} added for user ${job.userId} (position ${position})`)

  return {
    jobId: addedJob.id!,
    position
  }
}

/**
 * Get the position of a job in the queue
 */
export async function getJobPosition(jobId: string): Promise<number> {
  const queue = getVideoQueue()
  const waiting = await queue.getWaiting()

  const index = waiting.findIndex(job => job.id === jobId)
  return index === -1 ? 0 : index + 1
}

/**
 * Get queue status
 */
export async function getQueueStatus(): Promise<QueueStatus> {
  const queue = getVideoQueue()

  const [waiting, active, completed, failed] = await Promise.all([
    queue.getWaitingCount(),
    queue.getActiveCount(),
    queue.getCompletedCount(),
    queue.getFailedCount()
  ])

  return { waiting, active, completed, failed }
}

/**
 * Get user's job status
 */
export async function getUserJobStatus(userId: number): Promise<{
  activeJob?: { jobId: string; progress: number; stage: string }
  queuedJobs: Array<{ jobId: string; position: number }>
}> {
  const queue = getVideoQueue()

  // Get active jobs
  const active = await queue.getActive()
  const userActiveJob = active.find(job => job.data.userId === userId)

  // Get waiting jobs
  const waiting = await queue.getWaiting()
  const userWaitingJobs = waiting
    .map((job, index) => ({ job, position: index + 1 }))
    .filter(({ job }) => job.data.userId === userId)

  return {
    activeJob: userActiveJob ? {
      jobId: userActiveJob.id!,
      progress: (await userActiveJob.progress as number) || 0,
      stage: 'processing'
    } : undefined,
    queuedJobs: userWaitingJobs.map(({ job, position }) => ({
      jobId: job.id!,
      position
    }))
  }
}

/**
 * Clean up resources
 */
export async function closeQueue(): Promise<void> {
  if (queueEvents) {
    await queueEvents.close()
    queueEvents = null
  }

  if (videoQueue) {
    await videoQueue.close()
    videoQueue = null
  }

  if (redisConnection) {
    await redisConnection.quit()
    redisConnection = null
  }

  console.log('[Queue] Cleaned up queue resources')
}
