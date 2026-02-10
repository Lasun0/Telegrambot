import { Context } from 'telegraf';
import { Message } from 'telegraf/types';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { addVideoJob } from '../../queue/videoQueue';
import { getUserSettings } from '../../lib/userSettings';
import { VideoJob } from '../../queue/types';

const TELEGRAM_FILE_LIMIT = 20 * 1024 * 1024; // 20MB
const URL_FILE_LIMIT = 2000 * 1024 * 1024; // 2GB for URL downloads
const TEMP_DIR = process.env.TEMP_VIDEO_DIR || './tmp/videos';

// Ensure temp directory exists
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

/**
 * Handle video messages or video links
 */
export async function handleVideoMessage(ctx: Context) {
  const message = ctx.message as any;
  if (!message) return;

  const user = ctx.from;
  if (!user) return;

  let fileId: string | undefined;
  let fileName: string;
  let fileSize: number;
  let mimeType: string;
  let downloadUrl: string | undefined;
  let isLink = false;

  // 1. Check for Direct Link
  if (message.text && (message.text.startsWith('http://') || message.text.startsWith('https://'))) {
    isLink = true;
    downloadUrl = message.text.trim();
    fileName = path.basename(new URL(downloadUrl).pathname) || `video_${Date.now()}.mp4`;
    if (!fileName.includes('.')) fileName += '.mp4';
    fileSize = 0; // Unknown yet
    mimeType = 'video/mp4';
    fileId = `url_${Date.now()}`;
  }
  // 2. Check for Uploaded Video
  else if ('video' in message) {
    fileId = message.video.file_id;
    fileName = message.video.file_name || `video_${Date.now()}.mp4`;
    fileSize = message.video.file_size || 0;
    mimeType = message.video.mime_type || 'video/mp4';
  }
  // 3. Check for Uploaded Document (Video)
  else if ('document' in message && message.document.mime_type?.startsWith('video/')) {
    fileId = message.document.file_id;
    fileName = message.document.file_name || `video_${Date.now()}.mp4`;
    fileSize = message.document.file_size || 0;
    mimeType = message.document.mime_type || 'video/mp4';
  } else {
    return ctx.reply('Please send a video file or a direct download link (HTTP/HTTPS).');
  }

  // Size Check for Uploaded Files
  if (!isLink && fileSize > TELEGRAM_FILE_LIMIT) {
    return ctx.reply('❌ This file is too large for Telegram upload (Max 20MB).\n\n💡 *Tip:* For larger videos (up to 2GB), please send a **direct download link** (e.g. from Google Drive or a direct URL).', { parse_mode: 'Markdown' });
  }

  const statusMsg = await ctx.reply(isLink ? '🔗 Processing link...' : '📥 Downloading video...');

  try {
    const videoPath = path.join(TEMP_DIR, `${fileId}_${fileName}`);

    if (!isLink) {
      // Handle Telegram File Download
      const fileLink = await ctx.telegram.getFileLink(fileId!);
      downloadUrl = fileLink.href;
    }

    // Download Logic (for both Link and Telegram)
    const writer = fs.createWriteStream(videoPath);
    const response = await axios({
      url: downloadUrl,
      method: 'GET',
      responseType: 'stream',
      timeout: 30000, // 30s timeout for connection
    });

    // For links, check Content-Length if available
    const contentLength = response.headers['content-length'];
    if (isLink && contentLength) {
      fileSize = parseInt(contentLength, 10);
      if (fileSize > URL_FILE_LIMIT) {
        writer.close();
        if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath);
        return ctx.telegram.editMessageText(ctx.chat?.id, statusMsg.message_id, undefined, '❌ The linked file is too large (Max 2GB).');
      }
    }

    response.data.pipe(writer);

    await new Promise<void>((resolve, reject) => {
      writer.on('finish', () => resolve());
      writer.on('error', (err) => {
        writer.close();
        reject(err);
      });
    });

    // Verify file exists and has size
    const stats = fs.statSync(videoPath);
    fileSize = stats.size;

    if (fileSize === 0) {
      throw new Error('Downloaded file is empty');
    }

    // Get user settings
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

    const { position } = await addVideoJob(job);

    await ctx.telegram.editMessageText(
      ctx.chat?.id,
      statusMsg.message_id,
      undefined,
      `✅ ${isLink ? 'Link' : 'Video'} queued successfully!\n\n` +
      `Size: ${(fileSize / (1024 * 1024)).toFixed(1)} MB\n` +
      `Position in queue: ${position}\n` +
      `Model: ${settings.model}\n\n` +
      `I'll process it and send the results shortly.`
    );

  } catch (error: any) {
    console.error('Error handling video:', error);
    let errorMsg = '❌ Failed to process video.';

    if (error.response?.status === 404) errorMsg = '❌ Video link not found (404).';
    else if (error.code === 'ECONNABORTED') errorMsg = '❌ Download timed out.';

    await ctx.telegram.editMessageText(
      ctx.chat?.id,
      statusMsg.message_id,
      undefined,
      errorMsg + ' Please ensure it\'s a direct download link.'
    );
  }
}
