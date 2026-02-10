import { Context } from 'telegraf';
import { Message } from 'telegraf/types';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { addVideoJob } from '../../queue/videoQueue';
import { getUserSettings } from '../../lib/userSettings';
import { VideoJob } from '../../queue/types';

const TELEGRAM_FILE_LIMIT = 20 * 1024 * 1024; // 20MB
const URL_FILE_LIMIT = 2000 * 1024 * 1024; // 2GB
const TEMP_DIR = process.env.TEMP_VIDEO_DIR || './tmp/videos';

if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

/**
 * Robustly download from Google Drive handling large file confirmation
 */
async function downloadFromGoogleDrive(url: string, destPath: string): Promise<number> {
  console.log(`[Downloader] Starting Google Drive download: ${url}`);

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  };

  // 1. Get the initial response
  let response = await axios({
    url,
    method: 'GET',
    responseType: 'stream',
    timeout: 60000,
    headers
  });

  const contentType = response.headers['content-type'] || '';
  console.log(`[Downloader] Initial Content-Type: ${contentType}`);

  // 2. Check if it's an HTML confirmation page
  if (contentType.includes('text/html')) {
    console.log('[Downloader] Detected HTML page, looking for confirmation token...');

    // Download the HTML content fully to parse it
    const chunks: Buffer[] = [];
    for await (const chunk of response.data) {
      chunks.push(chunk);
    }
    const html = Buffer.concat(chunks).toString();

    // Look for the confirm token in the HTML
    const confirmMatch = html.match(/confirm=([a-zA-Z0-9_-]+)/);

    if (confirmMatch && confirmMatch[1]) {
      const token = confirmMatch[1];
      console.log(`[Downloader] Found confirm token: ${token}`);

      const downloadUrl = new URL(url);
      downloadUrl.searchParams.set('confirm', token);

      // 3. Make the actual download request with the token
      response = await axios({
        url: downloadUrl.toString(),
        method: 'GET',
        responseType: 'stream',
        timeout: 60000,
        headers
      });
      console.log(`[Downloader] Final download started (Content-Type: ${response.headers['content-type']})`);
    } else {
      console.error('[Downloader] Failed to find confirmation token in HTML');
      // If it's HTML but no token, it might be an error page
      const errorMsg = html.length > 500 ? html.substring(0, 500) + '...' : html;
      throw new Error(`Google Drive returned an HTML page instead of a video. Possible error: ${errorMsg}`);
    }
  }

  // 4. Pipe the stream to the file
  const writer = fs.createWriteStream(destPath);
  response.data.pipe(writer);

  await new Promise<void>((resolve, reject) => {
    writer.on('finish', resolve);
    writer.on('error', (err) => {
      writer.close();
      reject(err);
    });
  });

  const finalSize = fs.statSync(destPath).size;
  console.log(`[Downloader] Download complete. Final size: ${(finalSize / (1024 * 1024)).toFixed(2)} MB`);
  return finalSize;
}

export async function handleVideoMessage(ctx: Context) {
  const message = ctx.message as any;
  if (!message) return;

  const user = ctx.from;
  if (!user) return;

  let fileId: string | undefined;
  let fileName: string;
  let fileSize: number = 0;
  let mimeType: string = 'video/mp4';
  let downloadUrl: string | undefined;
  let isLink = false;

  if (message.text && (message.text.startsWith('http://') || message.text.startsWith('https://'))) {
    isLink = true;
    const trimmedUrl = message.text.trim();
    downloadUrl = trimmedUrl;
    try {
      // Use a cleaner filename for URL downloads
      const urlObj = new URL(trimmedUrl);
      fileName = path.basename(urlObj.pathname);

      // Special handling for Google Drive IDs
      if (trimmedUrl.includes('drive.google.com')) {
        const idMatch = trimmedUrl.match(/[?&]id=([^&]+)/) || trimmedUrl.match(/\/d\/([^/]+)/);
        if (idMatch) fileName = `drive_${idMatch[1]}.mp4`;
      }

      if (!fileName || fileName === '/' || fileName === '.') {
        fileName = `video_${Date.now()}.mp4`;
      }
    } catch (e) {
      fileName = `video_${Date.now()}.mp4`;
    }
    if (!fileName.includes('.')) fileName += '.mp4';
    fileId = `url_${Date.now()}`;
  } else if ('video' in message) {
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
    return ctx.reply('Please send a video file or a direct download link.');
  }

  if (!isLink && fileSize > TELEGRAM_FILE_LIMIT) {
    return ctx.reply('❌ File too large for Telegram upload (Max 20MB).\n\n💡 Use a **direct download link** for files up to 2GB.', { parse_mode: 'Markdown' });
  }

  const statusMsg = await ctx.reply(isLink ? '🔗 Processing link...' : '📥 Downloading video...');

  try {
    const videoPath = path.join(TEMP_DIR, `${fileId}_${fileName}`);

    if (isLink && downloadUrl?.includes('drive.google.com')) {
      fileSize = await downloadFromGoogleDrive(downloadUrl, videoPath);
    } else {
      if (!isLink) {
        const fileLink = await ctx.telegram.getFileLink(fileId!);
        downloadUrl = fileLink.href;
      }

      const writer = fs.createWriteStream(videoPath);
      const response = await axios({
        url: downloadUrl,
        method: 'GET',
        responseType: 'stream',
        timeout: 60000,
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });

      response.data.pipe(writer);
      await new Promise<void>((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', (err) => {
          writer.close();
          reject(err);
        });
      });
      fileSize = fs.statSync(videoPath).size;
    }

    if (fileSize === 0) throw new Error('Downloaded file is empty');

    // Check limit after download if it was a link
    if (isLink && fileSize > URL_FILE_LIMIT) {
      if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath);
      return ctx.telegram.editMessageText(ctx.chat?.id, statusMsg.message_id, undefined, `❌ The linked file is too large (${(fileSize / (1024*1024)).toFixed(1)}MB). Max allowed is 2GB.`);
    }

    const settings = getUserSettings(user.id);
    const job: VideoJob = {
      chatId: ctx.chat?.id!,
      messageId: statusMsg.message_id,
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
      `✅ Queued successfully!\n\nSize: ${(fileSize / (1024 * 1024)).toFixed(1)} MB\nPosition: ${position}\n\nI'll update this message as I progress.`
    );

  } catch (error: any) {
    console.error('Error handling video:', error.message);
    await ctx.telegram.editMessageText(
      ctx.chat?.id,
      statusMsg.message_id,
      undefined,
      `❌ Failed to process video: ${error.message}\n\nPlease ensure it's a direct download link.`
    );

    // Cleanup if necessary
    const videoPath = path.join(TEMP_DIR, `${fileId}_${fileName}`);
    if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath);
  }
}
