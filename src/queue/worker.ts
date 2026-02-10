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
import { startBot } from '../bot' // Added fallback to start bot
import { VideoJob, JobProgress, JOB_STAGES } from './types'
import { trimVideoWithFFmpeg } from '../lib/serverTrimmer'
import { formatSummaryMessage, formatChaptersMessage } from '../bot/utils/messageFormatter'

// Load environment variables (supports both .env.local and .env for production)
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
dotenv.config({ path: '.env' })

const QUEUE_NAME = 'video-processing'

// Gemini API Configuration
const GEMINI_API_KEY = process.env.GEMINI_API_KEY
const GEMINI_API_KEYS = process.env.GEMINI_API_KEYS?.split(',').filter(k => k.trim()) || []
const KNIGHT_API_KEY = process.env.KNIGHT_API_KEY
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'
const KNIGHT_API_BASE = 'https://knight-omega.duckdns.org/v1'

// Telegram bot instance for sending results
let bot: Telegraf | null = null

function getBot(): Telegraf {
  if (!bot) {
    const token = process.env.TELEGRAM_BOT_TOKEN
    if (!token) {
      throw new Error('TELEGRAM_BOT_TOKEN is required')
    }
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

  // Clean and escape message to prevent Markdown parsing errors
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
    // Ignore "message not modified" and "message can't be edited" errors
    if (!error.message.includes('message is not modified') && !error.message.includes("message can't be edited")) {
      console.error('[Worker] Failed to send progress update:', error.message)
    }
  }
}

/**
 * Get an API key from the pool
 */
function getApiKey(): string {
  const allKeys = [GEMINI_API_KEY, ...GEMINI_API_KEYS].filter(k => k && k.trim())
  if (allKeys.length === 0) {
    throw new Error('No Gemini API keys configured')
  }
  // Simple round-robin selection
  const index = Math.floor(Math.random() * allKeys.length)
  return allKeys[index]!
}

/**
 * Process video with Gemini API
 */
async function processVideoWithGemini(
  videoPath: string,
  mimeType: string,
  model: string,
  onProgress: (progress: JobProgress) => Promise<void>
): Promise<{
  summary: string
  chapters: Array<{
    title: string
    start_time: string
    end_time: string
    summary: string
    key_points: string[]
  }>
  timestamps: Array<{ start: string; end: string; description: string }>
}> {
  const apiKey = getApiKey()

  // Read video file
  await onProgress({
    stage: 'uploading',
    progress: 20,
    message: 'Reading video file...'
  })

  const videoBuffer = fs.readFileSync(videoPath)
  const videoBase64 = videoBuffer.toString('base64')
  const fileSizeMB = videoBuffer.length / (1024 * 1024)

  console.log(`[Worker] Video size: ${fileSizeMB.toFixed(2)}MB`)

  // For large files, use File API
  if (fileSizeMB > 20) {
    return await processWithFileAPI(videoBuffer, mimeType, model, apiKey, onProgress)
  }

  // For smaller files, use inline base64
  await onProgress({
    stage: 'processing',
    progress: 40,
    message: 'Sending to Gemini AI...'
  })

  const systemInstruction = getSystemInstruction()

  const requestBody = {
    contents: [
      {
        role: 'user',
        parts: [
          {
            inline_data: {
              mime_type: mimeType,
              data: videoBase64
            }
          },
          {
            text: systemInstruction + '\n\nAnalyze this class recording video. Extract the core educational content and provide the structured JSON output.'
          }
        ]
      }
    ],
    generation_config: {
      temperature: 0.3,
      top_k: 32,
      top_p: 0.95,
      max_output_tokens: 65536,
      response_mime_type: 'application/json'
    }
  }

  const response = await fetch(`${GEMINI_API_BASE}/${model}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody)
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Gemini API error: ${errorText}`)
  }

  await onProgress({
    stage: 'analyzing',
    progress: 70,
    message: 'Parsing AI response...'
  })

  const data = await response.json()
  return parseGeminiResponse(data)
}

/**
 * Process large files with Gemini File API
 */
async function processWithFileAPI(
  videoBuffer: Buffer,
  mimeType: string,
  model: string,
  apiKey: string,
  onProgress: (progress: JobProgress) => Promise<void>
): Promise<{
  summary: string
  chapters: Array<{
    title: string
    start_time: string
    end_time: string
    summary: string
    key_points: string[]
  }>
  timestamps: Array<{ start: string; end: string; description: string }>
}> {
  const uploadUrl = 'https://generativelanguage.googleapis.com/upload/v1beta/files'

  await onProgress({
    stage: 'uploading',
    progress: 25,
    message: 'Initiating file upload...'
  })

  // Initiate resumable upload
  const initResponse = await fetch(`${uploadUrl}?key=${apiKey}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': videoBuffer.length.toString(),
      'X-Goog-Upload-Header-Content-Type': mimeType
    },
    body: JSON.stringify({
      file: { displayName: 'telegram_video' }
    })
  })

  if (!initResponse.ok) {
    throw new Error(`Failed to initiate upload: ${await initResponse.text()}`)
  }

  const uploadUri = initResponse.headers.get('X-Goog-Upload-URL')
  if (!uploadUri) {
    throw new Error('No upload URI received')
  }

  await onProgress({
    stage: 'uploading',
    progress: 35,
    message: 'Uploading video to Gemini...'
  })

  // Upload the file
  const uploadResponse = await fetch(uploadUri, {
    method: 'PUT',
    headers: {
      'Content-Length': videoBuffer.length.toString(),
      'X-Goog-Upload-Offset': '0',
      'X-Goog-Upload-Command': 'upload, finalize'
    },
    body: new Uint8Array(videoBuffer) as any
  })

  if (!uploadResponse.ok) {
    throw new Error(`Upload failed: ${await uploadResponse.text()}`)
  }

  const uploadResult = await uploadResponse.json() as { file?: { uri?: string; name?: string } }
  const fileUri = uploadResult.file?.uri
  const fileName = uploadResult.file?.name

  if (!fileUri || !fileName) {
    throw new Error('No file URI or name returned')
  }

  await onProgress({
    stage: 'processing',
    progress: 50,
    message: 'Waiting for video processing...'
  })

  // Wait for file to be ready
  await waitForFileReady(fileName, apiKey)

  await onProgress({
    stage: 'analyzing',
    progress: 65,
    message: 'Analyzing with AI...'
  })

  // Call Gemini with file reference
  const systemInstruction = getSystemInstruction()

  const requestBody = {
    contents: [
      {
        role: 'user',
        parts: [
          {
            file_data: {
              mime_type: mimeType,
              file_uri: fileUri
            }
          },
          {
            text: systemInstruction + '\n\nAnalyze this class recording video. Extract the core educational content and provide the structured JSON output.'
          }
        ]
      }
    ],
    generation_config: {
      temperature: 0.3,
      top_k: 32,
      top_p: 0.95,
      max_output_tokens: 65536,
      response_mime_type: 'application/json'
    }
  }

  const response = await fetch(`${GEMINI_API_BASE}/${model}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody)
  })

  if (!response.ok) {
    throw new Error(`Gemini API error: ${await response.text()}`)
  }

  const data = await response.json()
  return parseGeminiResponse(data)
}

/**
 * Wait for uploaded file to be ready
 */
async function waitForFileReady(fileName: string, apiKey: string): Promise<void> {
  const filesBaseUrl = 'https://generativelanguage.googleapis.com/v1beta'
  const maxAttempts = 120 // 4 minutes max

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const response = await fetch(`${filesBaseUrl}/${fileName}?key=${apiKey}`)

    if (response.ok) {
      const data = await response.json() as { state?: string; error?: { message?: string } }

      if (data.state === 'ACTIVE') {
        return
      }

      if (data.state === 'FAILED') {
        throw new Error(`File processing failed: ${data.error?.message || 'Unknown error'}`)
      }
    }

    await new Promise(resolve => setTimeout(resolve, 2000))
  }

  throw new Error('Timeout waiting for file to be ready')
}

/**
 * Get system instruction for video analysis
 */
function getSystemInstruction(): string {
  return `You are an expert video-analysis AI specialized in educational content. Analyze this class recording and extract the core learning content.

OUTPUT FORMAT (JSON):
{
  "clean_script": "The cleaned teaching script with essential content",
  "chapters": [
    {
      "title": "Chapter title",
      "start_time": "MM:SS",
      "end_time": "MM:SS",
      "summary": "Brief summary",
      "key_points": ["Key point 1", "Key point 2"]
    }
  ],
  "full_session_summary": "Comprehensive summary",
  "important_concepts": ["Concept 1", "Concept 2"],
  "recommended_practice": ["Practice item 1"],
  "content_metadata": {
    "original_duration_estimate": "Duration",
    "essential_content_duration": "Duration",
    "content_removed_percentage": 35,
    "main_content_timestamps": [
      { "start": "02:30", "end": "15:45", "description": "Topic" }
    ]
  }
}

Return ONLY valid JSON.`
}

/**
 * Parse Gemini API response
 */
function parseGeminiResponse(data: unknown): {
  summary: string
  chapters: Array<{
    title: string
    start_time: string
    end_time: string
    summary: string
    key_points: string[]
  }>
  timestamps: Array<{ start: string; end: string; description: string }>
} {
  const response = data as {
    candidates?: Array<{
      content?: {
        parts?: Array<{ text?: string }>
      }
    }>
  }

  const content = response.candidates?.[0]?.content?.parts?.[0]?.text
  if (!content) {
    throw new Error('No content in Gemini response')
  }

  // Clean markdown code blocks
  let cleaned = content.trim()
  if (cleaned.startsWith('```json')) {
    cleaned = cleaned.slice(7)
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.slice(3)
  }
  if (cleaned.endsWith('```')) {
    cleaned = cleaned.slice(0, -3)
  }

  const parsed = JSON.parse(cleaned.trim())

  return {
    summary: parsed.full_session_summary || 'No summary available',
    chapters: parsed.chapters || [],
    timestamps: parsed.content_metadata?.main_content_timestamps || []
  }
}

/**
 * Main job processor
 */
async function processJob(job: Job<VideoJob>): Promise<void> {
  const { chatId, messageId, videoPath, fileName, mimeType, model, userId } = job.data

  console.log(`[Worker] Processing job ${job.id} for user ${userId}: ${fileName}`)

  const updateProgress = async (progress: JobProgress) => {
    await job.updateProgress(progress.progress)
    await sendProgressUpdate(chatId, messageId, progress)
  }

  try {
    // Step 1: Process video with AI
    await updateProgress({
      stage: 'uploading',
      progress: 10,
      message: 'Starting video analysis...'
    })

    const result = await processVideoWithGemini(videoPath, mimeType, model, updateProgress)

    // Step 2: Trim video if timestamps available
    let outputVideoPath: string | null = null

    if (result.timestamps.length > 0) {
      await updateProgress({
        stage: 'trimming',
        progress: 80,
        message: 'Trimming video to essential content...'
      })

      const outputDir = path.dirname(videoPath)
      const outputFileName = `trimmed_${path.basename(fileName, path.extname(fileName))}.mp4`
      outputVideoPath = path.join(outputDir, outputFileName)

      await trimVideoWithFFmpeg(videoPath, result.timestamps, outputVideoPath)
    }

    // Step 3: Send results to user
    await updateProgress({
      stage: 'sending',
      progress: 90,
      message: 'Sending results...'
    })

    const bot = getBot()

    // Send summary message
    const summaryMessage = formatSummaryMessage(result.summary, result.chapters)
    await bot.telegram.sendMessage(chatId, summaryMessage, { parse_mode: 'Markdown' })

    // Send chapters if available
    if (result.chapters.length > 0) {
      const chaptersMessage = formatChaptersMessage(result.chapters)
      await bot.telegram.sendMessage(chatId, chaptersMessage, { parse_mode: 'Markdown' })
    }

    // Send trimmed video if available
    if (outputVideoPath && fs.existsSync(outputVideoPath)) {
      const videoStats = fs.statSync(outputVideoPath)

      // Telegram has a 50MB limit for bots
      if (videoStats.size < 50 * 1024 * 1024) {
        await bot.telegram.sendVideo(chatId, { source: outputVideoPath }, {
          caption: '✂️ Trimmed video with essential content only'
        })
      } else {
        await bot.telegram.sendMessage(
          chatId,
          '⚠️ The trimmed video is too large to send via Telegram (>50MB). Please use the web interface for large files.'
        )
      }
    }

    // Update final status
    await updateProgress({
      stage: 'complete',
      progress: 100,
      message: 'Processing complete!'
    })

    // Cleanup
    if (fs.existsSync(videoPath)) {
      fs.unlinkSync(videoPath)
    }
    if (outputVideoPath && fs.existsSync(outputVideoPath)) {
      // Keep for a bit then clean up
      setTimeout(() => {
        if (fs.existsSync(outputVideoPath!)) {
          fs.unlinkSync(outputVideoPath!)
        }
      }, 60000) // Clean up after 1 minute
    }

    console.log(`[Worker] Job ${job.id} completed successfully`)

  } catch (error) {
    console.error(`[Worker] Job ${job.id} failed:`, error)

    await updateProgress({
      stage: 'error',
      progress: 0,
      message: error instanceof Error ? error.message : 'Unknown error occurred'
    })

    // Cleanup on error
    if (fs.existsSync(videoPath)) {
      fs.unlinkSync(videoPath)
    }

    throw error
  }
}

/**
 * Start the worker
 */
export function startWorker(): Worker<VideoJob> {
  const worker = new Worker<VideoJob>(QUEUE_NAME, processJob, {
    connection: getRedisOptions(),
    concurrency: 1, // Process one video at a time
    limiter: {
      max: 1,
      duration: 1000
    }
  })

  worker.on('completed', (job) => {
    console.log(`[Worker] Job ${job.id} completed`)
  })

  worker.on('failed', (job, err) => {
    console.error(`[Worker] Job ${job?.id} failed:`, err.message)
  })

  worker.on('error', (err) => {
    console.error('[Worker] Error:', err)
  })

  console.log('[Worker] Video processing worker started')

  return worker
}

// Run worker if executed directly
if (require.main === module) {
  // Minimal health check server to satisfy Koyeb
  const PORT = parseInt(process.env.PORT || '8000', 10);
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Healthy');
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[Health] Worker health check server listening on 0.0.0.0:${PORT}`);
    console.log('[Health] Ready');
  });

  console.log('[Worker] Starting video processing worker and bot fallback...');
  startWorker();
  startBot().catch(err => console.error('[Bot Fallback] Failed to start:', err));

  // Handle graceful shutdown
  process.on('SIGTERM', async () => {
    console.log('[Worker] Received SIGTERM, shutting down...');
    server.close();
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    console.log('[Worker] Received SIGINT, shutting down...');
    server.close();
    process.exit(0);
  });
}
