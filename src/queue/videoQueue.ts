/**
 * Video Processing Queue
 * BullMQ queue for handling video processing jobs
 */

import { Queue, QueueEvents } from 'bullmq'
import IORedis from 'ioredis'
import { VideoJob, QueueStatus } from './types'

/**
 * Get Redis connection options for BullMQ.
 * BullMQ requires each component (Queue, Worker, QueueEvents) to have
 * its own connection. Passing options (not an instance) lets BullMQ
 * manage connections internally.
 */
export function getRedisOptions(): IORedis.RedisOptions {
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379'

  const baseOptions: IORedis.RedisOptions = {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    enableOfflineQueue: true,
    keepAlive: 30000,
    connectTimeout: 30000,
    retryStrategy: (times: number) => {
      const maxRetries = 20
      if (times > maxRetries) {
        console.error(`[Redis] Max retry attempts reached`)
        return null
      }
      const delay = Math.min(times * 2000, 30000)
      console.log(`[Redis] Retry attempt ${times}/${maxRetries}, waiting ${delay}ms`)
      return delay
    },
    reconnectOnError: (err: Error) => {
      const targetErrors = ['READONLY', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE']
      if (targetErrors.some(e => err.message.includes(e))) {
        console.log('[Redis] Reconnecting due to:', err.message)
        return 1
      }
      return false
    }
  }

  // Parse Redis URL for TLS (Upstash, Redis Cloud, etc.)
  if (redisUrl.startsWith('rediss://')) {
    const url = new URL(redisUrl)
    return {
      ...baseOptions,
      host: url.hostname,
      port: parseInt(url.port) || 6379,
      password: url.password,
      username: url.username || undefined,
      family: 4,
      tls: {
        rejectUnauthorized: false,
        servername: url.hostname
      }
    }
  }

  // Parse non-TLS Redis URL
  const url = new URL(redisUrl)
  return {
    ...baseOptions,
    host: url.hostname,
    port: parseInt(url.port) || 6379,
    password: url.password || undefined,
    username: url.username || undefined,
    family: 4
  }
}

// Queue name
const QUEUE_NAME = 'video-processing'

// Queue singleton
let videoQueue: Queue<VideoJob> | null = null
let queueEvents: QueueEvents | null = null

export function getVideoQueue(): Queue<VideoJob> {
  if (!videoQueue) {
    videoQueue = new Queue<VideoJob>(QUEUE_NAME, {
      connection: getRedisOptions(),
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000
        },
        removeOnComplete: {
          count: 100,
          age: 24 * 3600
        },
        removeOnFail: {
          count: 50
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
      connection: getRedisOptions()
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

  console.log('[Queue] Cleaned up queue resources')
}
