import { Context } from 'telegraf';
import { getUserSettings, getModelDisplayName } from '../../lib/userSettings';
import { getSettingsKeyboard } from '../keyboards/apiSelection';
import { getUserJobStatus, getQueueStatus } from '../../queue/videoQueue';
import { JOB_STAGES } from '../../queue/types';

/**
 * Handle /start command
 */
export async function handleStart(ctx: Context) {
  const user = ctx.from;
  if (!user) return;

  const settings = getUserSettings(user.id);
  const firstName = user.first_name || 'User';

  await ctx.reply(
    `👋 *Hello ${firstName}!*\n\n` +
    `I am the Clean Class Recorder Bot 🤖\n\n` +
    `I can help you process class recordings, summarize them, and extract key points using advanced AI.\n\n` +
    `*How to use:*\n` +
    `1. Send me a video file (up to 2GB)\n` +
    `2. I'll process it using ${getModelDisplayName(settings.model)}\n` +
    `3. You'll get a summary and trimmed clips\n\n` +
    `*Commands:*\n` +
    `/settings - Change AI provider & model\n` +
    `/status - Check your current jobs\n` +
    `/help - Show this help message`,
    { parse_mode: 'Markdown' }
  );
}

/**
 * Handle /settings command
 */
export async function handleSettings(ctx: Context) {
  const user = ctx.from;
  if (!user) return;

  const settings = getUserSettings(user.id);

  await ctx.reply(
    `⚙️ *Settings*\n\n` +
    `*Current Provider:* ${settings.apiProvider === 'gemini' ? 'Google Gemini' : 'Knight (OpenAI)'}\n` +
    `*Current Model:* ${getModelDisplayName(settings.model)}\n\n` +
    `Tap the buttons below to change your preferences:`,
    {
      parse_mode: 'Markdown',
      ...getSettingsKeyboard(settings)
    }
  );
}

/**
 * Handle /help command
 */
export async function handleHelp(ctx: Context) {
  await ctx.reply(
    `🆘 *Help*\n\n` +
    `Send any video file to start processing. The bot supports MP4, MOV, MKV, and WebM formats.\n\n` +
    `*Features:*\n` +
    `• AI Summarization\n` +
    `• Chapter extraction\n` +
    `• Smart trimming\n` +
    `• Multi-provider support (Gemini, OpenAI)\n\n` +
    `*Large Videos:*\n` +
    `For videos > 500MB, the system automatically uses chunked processing to handle them efficiently.\n\n` +
    `If you encounter issues, try forwarding the message to the developer.`,
    { parse_mode: 'Markdown' }
  );
}

/**
 * Handle /status command
 */
export async function handleStatus(ctx: Context) {
  const user = ctx.from;
  if (!user) return;

  const { activeJob, queuedJobs } = await getUserJobStatus(user.id);
  const globalStatus = await getQueueStatus();

  let message = `📊 *System Status*\n\n`;
  message += `Waiting: ${globalStatus.waiting} | Active: ${globalStatus.active} | Completed: ${globalStatus.completed}\n\n`;

  message += `👤 *Your Jobs*\n\n`;

  if (!activeJob && queuedJobs.length === 0) {
    message += `_No active jobs at the moment._`;
  } else {
    if (activeJob) {
      const stageInfo = JOB_STAGES[activeJob.stage as keyof typeof JOB_STAGES] || { emoji: '🔄', description: activeJob.stage };
      message += `*Active Job:*\n` +
                 `${stageInfo.emoji} ${stageInfo.description} (${activeJob.progress}%)\n\n`;
    }

    if (queuedJobs.length > 0) {
      message += `*Queued Jobs:*\n`;
      queuedJobs.forEach((job, i) => {
        message += `${i + 1}. Position: ${job.position}\n`;
      });
    }
  }

  await ctx.reply(message, { parse_mode: 'Markdown' });
}
