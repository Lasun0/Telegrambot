/**
 * Video Processing Worker
 * BullMQ worker that processes video jobs from the queue
 */

import { Worker, Job } from 'bullmq'
import { Telegraf } from 'telegraf'
import * as fs from 'fs'
import * as path from 'path'
import * as http from 'http'
import { getRedisOptions } from './videoQueue'
import { startBot } from '../bot'
import { VideoJob, JobProgress, JOB_STAGES } from './types'
import { trimVideoWithFFmpeg } from '../lib/serverTrimmer'
import { formatSummaryMessage, formatChaptersMessage } from '../bot/utils/messageFormatter'

// Load environment variables
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
dotenv.config({ path: '.env' })

const QUEUE_NAME = 'video-processing'

const GEMINI_API_KEY = process.env.GEMINI_API_KEY
const GEMINI_API_KEYS = process.env.GEMINI_API_KEYS?.split(',').filter(k => k.trim()) || []
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'

let bot: Telegraf | null = null

function getBot(): Telegraf {
  if (!bot) {
    const token = process.env.TELEGRAM_BOT_TOKEN
    if (!token) throw new Error('TELEGRAM_BOT_TOKEN is required')
    bot = new Telegraf(token)
  }
  return bot
}

/**
 * Send progress update to user via Telegram
 */
async function sendProgressUpdate(chatId: number, messageId: number, progress: JobProgress): Promise<void> {
  const bot = getBot()
  const stageInfo = JOB_STAGES[progress.stage] || { emoji: '🔄', description: 'Processing' }

  const safeMessage = progress.message.replace(/[_*[\]()]/g, '\\$&');

  const text = `${stageInfo.emoji} *${stageInfo.description}*\n\n` +
    `Progress: ${progress.progress}%\n` +
    `${safeMessage}` +
    (progress.estimatedTime ? `\n\nEstimated time: ${progress.estimatedTime}` : '')

  try {
    await bot.telegram.editMessageText(chatId, messageId, undefined, text, {
      parse_mode: 'Markdown'
    })
  } catch (error: any) {
    if (!error.message.includes('message is not modified') && !error.message.includes("message can't be edited")) {
      console.error('[Worker] Failed to send progress update:', error.message)
    }
  }
}

function getApiKey(): string {
  const allKeys = [GEMINI_API_KEY, ...GEMINI_API_KEYS].filter(k => k && k.trim())
  if (allKeys.length === 0) throw new Error('No Gemini API keys configured')
  const index = Math.floor(Math.random() * allKeys.length)
  return allKeys[index]!
}

/**
 * Process video with Gemini API using memory-efficient streams
 */
async function processVideoWithGemini(
  videoPath: string,
  mimeType: string,
  model: string,
  onProgress: (progress: JobProgress) => Promise<void>
): Promise<any> {
  const apiKey = getApiKey()
  const stats = fs.statSync(videoPath)
  const fileSizeMB = stats.size / (1024 * 1024)

  console.log(`[Worker] Video size: ${fileSizeMB.toFixed(2)}MB`)

  // Always use File API for files > 10MB to save memory
  if (fileSizeMB > 10) {
    return await processWithFileAPI(videoPath, stats.size, mimeType, model, apiKey, onProgress)
  }

  // Small file: Inline base64
  await onProgress({ stage: 'processing', progress: 40, message: 'Sending to Gemini AI...' })
  const videoBuffer = fs.readFileSync(videoPath)
  const videoBase64 = videoBuffer.toString('base64')

  const response = await fetch(`${GEMINI_API_BASE}/${model}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        role: 'user',
        parts: [
          { inline_data: { mime_type: mimeType, data: videoBase64 } },
          { text: getSystemInstruction() + '\n\nAnalyze this video.' }
        ]
      }],
      generation_config: { response_mime_type: 'application/json' }
    })
  })

  if (!response.ok) throw new Error(`Gemini API error: ${await response.text()}`)
  const data = await response.json()
  return parseGeminiResponse(data)
}

/**
 * Process large files using Gemini Resumable Upload (Streaming)
 */
async function processWithFileAPI(
  videoPath: string,
  fileSize: number,
  mimeType: string,
  model: string,
  apiKey: string,
  onProgress: (progress: JobProgress) => Promise<void>
): Promise<any> {
  const uploadUrl = 'https://generativelanguage.googleapis.com/upload/v1beta/files'

  await onProgress({ stage: 'uploading', progress: 25, message: 'Initiating streaming upload...' })

  // 1. Start Resumable Upload
  const initResponse = await fetch(`${uploadUrl}?key=${apiKey}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': fileSize.toString(),
      'X-Goog-Upload-Header-Content-Type': mimeType
    },
    body: JSON.stringify({ file: { displayName: path.basename(videoPath) } })
  })

  const uploadUri = initResponse.headers.get('X-Goog-Upload-URL')
  if (!uploadUri) throw new Error('Failed to get upload URL')

  await onProgress({ stage: 'uploading', progress: 35, message: 'Streaming video to Gemini...' })

  // 2. Stream the file directly from disk to the API
  const fileStream = fs.createReadStream(videoPath)
  const uploadResponse = await fetch(uploadUri, {
    method: 'PUT',
    headers: {
      'Content-Length': fileSize.toString(),
      'X-Goog-Upload-Offset': '0',
      'X-Goog-Upload-Command': 'upload, finalize'
    },
    body: fileStream as any // Node 18+ fetch supports streams
  })

  if (!uploadResponse.ok) throw new Error(`Upload failed: ${await uploadResponse.text()}`)
  const uploadResult = await uploadResponse.json() as any
  const fileName = uploadResult.file?.name

  await onProgress({ stage: 'processing', progress: 50, message: 'Waiting for AI to process...' })
  await waitForFileReady(fileName, apiKey)

  await onProgress({ stage: 'analyzing', progress: 70, message: 'Analyzing with AI...' })

  // 3. Generate content from the uploaded file
  const response = await fetch(`${GEMINI_API_BASE}/${model}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        role: 'user',
        parts: [
          { file_data: { mime_type: mimeType, file_uri: uploadResult.file?.uri } },
          { text: getSystemInstruction() + '\n\nAnalyze this video.' }
        ]
      }],
      generation_config: { response_mime_type: 'application/json' }
    })
  })

  if (!response.ok) throw new Error(`Gemini API error: ${await response.text()}`)
  return parseGeminiResponse(await response.json())
}

async function waitForFileReady(fileName: string, apiKey: string): Promise<void> {
  const baseUrl = 'https://generativelanguage.googleapis.com/v1beta'
  for (let i = 0; i < 120; i++) {
    const res = await fetch(`${baseUrl}/${fileName}?key=${apiKey}`)
    const data = await res.json() as any
    if (data.state === 'ACTIVE') return
    if (data.state === 'FAILED') throw new Error('File processing failed')
    await new Promise(r => setTimeout(r, 2000))
  }
  throw new Error('Timeout waiting for file')
}

function getSystemInstruction(): string {
  return `Analyze this class recording. Extract the learning content. Return JSON:
  { "full_session_summary": "Summary", "chapters": [{"title": "Title", "start_time": "MM:SS", "end_time": "MM:SS", "summary": "Text", "key_points": []}],
    "content_metadata": { "main_content_timestamps": [{"start": "MM:SS", "end": "MM:SS", "description": "Topic"}] } }`
}

function parseGeminiResponse(data: any): any {
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text
  if (!text) throw new Error('No content in response')
  const cleaned = text.replace(/```json|```/g, '').trim()
  const parsed = JSON.parse(cleaned)
  return {
    summary: parsed.full_session_summary || 'No summary',
    chapters: parsed.chapters || [],
    timestamps: parsed.content_metadata?.main_content_timestamps || []
  }
}

async function processJob(job: Job<VideoJob>): Promise<void> {
  const { chatId, messageId, videoPath, fileName, mimeType, model, userId } = job.data
  const updateProgress = async (p: JobProgress) => {
    await job.updateProgress(p.progress)
    await sendProgressUpdate(chatId, messageId, p)
  }

  try {
    const result = await processVideoWithGemini(videoPath, mimeType, model, updateProgress)
    let outputVideoPath: string | null = null

    if (result.timestamps.length > 0) {
      await updateProgress({ stage: 'trimming', progress: 80, message: 'Trimming essential content...' })
      const outDir = path.dirname(videoPath)
      const outName = `trimmed_${path.basename(fileName, path.extname(fileName))}.mp4`
      outputVideoPath = path.join(outDir, outName)
      await trimVideoWithFFmpeg(videoPath, result.timestamps, outputVideoPath)
    }

    await updateProgress({ stage: 'sending', progress: 90, message: 'Sending results...' })
    const bot = getBot()
    await bot.telegram.sendMessage(chatId, formatSummaryMessage(result.summary, result.chapters), { parse_mode: 'Markdown' })

    if (outputVideoPath && fs.existsSync(outputVideoPath)) {
      const stats = fs.statSync(outputVideoPath)
      if (stats.size < 50 * 1024 * 1024) {
        await bot.telegram.sendVideo(chatId, { source: outputVideoPath }, { caption: '✂️ Trimmed video' })
      } else {
        await bot.telegram.sendMessage(chatId, '⚠️ Trimmed video > 50MB. Sent summary only.')
      }
    }

    await updateProgress({ stage: 'complete', progress: 100, message: 'Processing complete!' })
    if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath)
    if (outputVideoPath && fs.existsSync(outputVideoPath)) {
      setTimeout(() => { if (fs.existsSync(outputVideoPath!)) fs.unlinkSync(outputVideoPath!) }, 60000)
    }
  } catch (error: any) {
    console.error(`[Worker] Job failed:`, error.message)
    await updateProgress({ stage: 'error', progress: 0, message: error.message })
    if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath)
    throw error
  }
}

export function startWorker(): Worker<VideoJob> {
  const worker = new Worker<VideoJob>(QUEUE_NAME, processJob, {
    connection: getRedisOptions(),
    concurrency: 1,
    limiter: { max: 1, duration: 1000 }
  })
  console.log('[Worker] Video processing worker started')
  return worker
}

if (require.main === module) {
  const PORT = parseInt(process.env.PORT || '8000', 10)
  const server = http.createServer((req, res) => { res.writeHead(200); res.end('Healthy'); })
  server.listen(PORT, '0.0.0.0', () => { console.log(`[Health] Worker listening on port ${PORT}`); })
  startWorker()
  startBot().catch(err => console.error('[Bot Fallback] Failed:', err))
  process.on('SIGTERM', () => process.exit(0))
  process.on('SIGINT', () => process.exit(0))
}
