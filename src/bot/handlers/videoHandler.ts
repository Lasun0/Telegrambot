import { Context } from 'telegraf';
import { Message } from 'telegraf/types';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { addVideoJob } from '../../queue/videoQueue';
import { getUserSettings } from '../../lib/userSettings';
import { VideoJob } from '../../queue/types';

const MAX_FILE_SIZE = 2000 * 1024 * 1024; // 2GB (Telegram limit is 2GB for bots)
const TEMP_DIR = process.env.TEMP_VIDEO_DIR || './tmp/videos';

// Ensure temp directory exists
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

/**
 * Handle video messages
 */
export async function handleVideoMessage(ctx: Context) {
  // @ts-ignore - telegraf types are sometimes tricky with message subtypes
  const message = ctx.message as Message.VideoMessage | Message.DocumentMessage;

  if (!message) return;

  const user = ctx.from;
  if (!user) return;

  // Get video details
  let fileId: string;
  let fileName: string;
  let fileSize: number;
  let mimeType: string;

  if ('video' in message) {
    fileId = message.video.file_id;
    fileName = message.video.file_name || `video_${Date.now()}.mp4`;
    fileSize = message.video.file_size || 0;
    mimeType = message.video.mime_type || 'video/mp4';
  } else if ('document' in message && message.document.mime_type?.startsWith('video/')) {
    fileId = message.document.file_id;
    fileName = message.document.file_name || `video_${Date.now()}.mp4`;
    fileSize = message.document.file_size || 0;
    mimeType = message.document.mime_type || 'video/mp4';
  } else {
    return ctx.reply('Please send a video file.');
  }

  // Check file size
  if (fileSize > MAX_FILE_SIZE) {
    return ctx.reply('❌ Video is too large. Maximum size is 2GB.');
  }

  const statusMsg = await ctx.reply('📥 Downloading video...');

  try {
    // Get file link
    const fileLink = await ctx.telegram.getFileLink(fileId);
    const videoPath = path.join(TEMP_DIR, `${fileId}_${fileName}`);

    // Download file
    const writer = fs.createWriteStream(videoPath);
    const response = await axios({
      url: fileLink.href,
      method: 'GET',
      responseType: 'stream'
    });

    response.data.pipe(writer);

    await new Promise<void>((resolve, reject) => {
      writer.on('finish', () => resolve());
      writer.on('error', reject);
    });

    // Get user settings for API preference
    const settings = getUserSettings(user.id);

    // Create job
    const job: VideoJob = {
      chatId: ctx.chat?.id!,
      messageId: message.message_id,
      videoPath,
      fileName,
      fileSize,
      mimeType,
      apiProvider: settings.apiProvider,
      model: settings.model,
      userId: user.id,
      username: user.username,
      addedAt: new Date()
    };

    // Add to queue
    const { position } = await addVideoJob(job);

    await ctx.telegram.editMessageText(
      ctx.chat?.id,
      statusMsg.message_id,
      undefined,
      `✅ Video queued successfully!\n\n` +
      `Position in queue: ${position}\n` +
      `Provider: ${settings.apiProvider === 'gemini' ? 'Google Gemini' : 'Knight (OpenAI)'}\n` +
      `Model: ${settings.model}\n\n` +
      `I'll verify the content and send you the summary when it's ready.`
    );

  } catch (error) {
    console.error('Error handling video:', error);
    await ctx.telegram.editMessageText(
      ctx.chat?.id,
      statusMsg.message_id,
      undefined,
      '❌ Failed to process video. Please try again.'
    );

    // Clean up file if it exists
    /*
    if (fs.existsSync(videoPath)) {
      fs.unlinkSync(videoPath);
    }
    */
  }
}
