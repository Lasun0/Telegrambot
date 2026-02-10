/**
 * Video Processing Queue
 * BullMQ queue for handling video processing jobs
 */

import { Queue, QueueEvents } from 'bullmq'
import IORedis, { RedisOptions } from 'ioredis'
import { VideoJob, QueueStatus } from './types'

/**
 * Get Redis connection options for BullMQ.
 */
export function getRedisOptions(): RedisOptions {
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379'

  let host = '127.0.0.1'
  let port = 6379
  let password = undefined
  let username = undefined
  const isTls = redisUrl.startsWith('rediss://')

  try {
    const url = new URL(redisUrl)
    host = url.hostname
    port = parseInt(url.port) || 6379
    password = url.password || undefined
    username = url.username || undefined

    // Auto-detect TLS for Upstash or if protocol is rediss
    const forceTls = redisUrl.startsWith('rediss://') || host.includes('upstash.io') || redisUrl.includes('tls=true')

    // Mask password for logging
    const maskedPassword = password ? '****' : 'none'
    console.log(`[Redis] Configuration: host=${host}, port=${port}, username=${username || 'none'}, password=${maskedPassword}, tls=${forceTls}`)

    const options: RedisOptions = {
      host,
      port,
      password,
      username,
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      enableOfflineQueue: true,
      connectTimeout: 30000,
      keepAlive: 5000, // More frequent keep-alive for cloud providers
      family: 4,
      enableAutoPipelining: true, // Recommended for performance/stability
      retryStrategy: (times) => {
        return Math.min(times * 1000, 30000);
      }
    }

    if (forceTls) {
      options.tls = {
        rejectUnauthorized: false,
        servername: host
      }
    }

    return options
  } catch (e) {
    console.error('[Redis] Failed to parse REDIS_URL, using defaults', e)
    return {
      host: '127.0.0.1',
      port: 6379,
      maxRetriesPerRequest: null
    }
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

  // Add job (FIFO is default in BullMQ)
  const addedJob = await queue.add('process-video', job);

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
