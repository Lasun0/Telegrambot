/**
 * Queue Types
 * TypeScript interfaces for the video processing queue system
 */

export interface VideoJob {
  chatId: number
  messageId: number
  videoPath: string
  fileName: string
  fileSize: number
  mimeType: string
  apiProvider: 'gemini' | 'knight'
  model: string
  userId: number
  username?: string
  addedAt: Date
}

export interface JobProgress {
  stage: 'queued' | 'downloading' | 'uploading' | 'processing' | 'analyzing' | 'trimming' | 'sending' | 'complete' | 'error'
  progress: number
  message: string
  estimatedTime?: string
}

export interface JobResult {
  success: boolean
  outputVideoPath?: string
  summary?: string
  chapters?: Array<{
    title: string
    start_time: string
    end_time: string
    summary: string
    key_points: string[]
  }>
  error?: string
}

export interface QueueStatus {
  waiting: number
  active: number
  completed: number
  failed: number
}

export const JOB_STAGES: Record<JobProgress['stage'], { emoji: string; description: string }> = {
  queued: { emoji: '⏳', description: 'Waiting in queue' },
  downloading: { emoji: '📥', description: 'Downloading video' },
  uploading: { emoji: '📤', description: 'Uploading to AI' },
  processing: { emoji: '🔄', description: 'Processing video' },
  analyzing: { emoji: '🔍', description: 'Analyzing content' },
  trimming: { emoji: '✂️', description: 'Trimming video' },
  sending: { emoji: '📨', description: 'Sending result' },
  complete: { emoji: '✅', description: 'Complete' },
  error: { emoji: '❌', description: 'Error occurred' }
}
