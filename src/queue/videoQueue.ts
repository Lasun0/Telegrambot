/**
 * Video Processing Queue
 * BullMQ queue for handling video processing jobs
 */

import { Queue, QueueEvents } from 'bullmq'
import IORedis from 'ioredis'
import { VideoJob, QueueStatus } from './types'

// Redis connection singleton
let redisConnection: IORedis | null = null

export function getRedisConnection(): IORedis {
  if (!redisConnection) {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379'

    // Parse Redis URL for Upstash compatibility
    if (redisUrl.startsWith('rediss://')) {
      // TLS connection (Upstash)
      const url = new URL(redisUrl)
      redisConnection = new IORedis({
        host: url.hostname,
        port: parseInt(url.port) || 6379,
        password: url.password,
        tls: {
          rejectUnauthorized: false
        },
        maxRetriesPerRequest: null,
        enableReadyCheck: false
      })
    } else {
      // Standard Redis connection
      redisConnection = new IORedis(redisUrl, {
        maxRetriesPerRequest: null,
        enableReadyCheck: false
      })
    }

    redisConnection.on('error', (err) => {
      console.error('[Redis] Connection error:', err.message)
    })

    redisConnection.on('connect', () => {
      console.log('[Redis] Connected successfully')
    })
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
      connection: getRedisConnection(),
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
      connection: getRedisConnection()
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
