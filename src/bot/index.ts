import { Telegraf, session } from 'telegraf';
import { handleStart, handleSettings, handleHelp, handleStatus } from './handlers/commandHandler';
import { handleVideoMessage } from './handlers/videoHandler';
import { handleCallback } from './handlers/callbackHandler';
import * as path from 'path';
import * as fs from 'fs';
import * as dotenv from 'dotenv';

// Load environment variables (supports both .env.local and .env for production)
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

// Initialize bot
const botToken = process.env.TELEGRAM_BOT_TOKEN;
if (!botToken) {
  throw new Error('TELEGRAM_BOT_TOKEN must be provided!');
}

export const bot = new Telegraf(botToken);

// Middleware
bot.use(session());

// Logging middleware
bot.use(async (ctx, next) => {
  const start = Date.now();
  await next();
  const ms = Date.now() - start;
  if (ctx.message && 'text' in ctx.message) {
    console.log(`[Bot] Response time ${ms}ms - Message: ${ctx.message.text}`);
  } else if (ctx.callbackQuery && 'data' in ctx.callbackQuery) {
    console.log(`[Bot] Response time ${ms}ms - Callback: ${ctx.callbackQuery.data}`);
  }
});

// Command handlers
bot.command('start', handleStart);
bot.command('settings', handleSettings);
bot.command('help', handleHelp);
bot.command('status', handleStatus);

// Message handlers
bot.on(['video', 'document'], handleVideoMessage);

// Callback query handlers
bot.on('callback_query', handleCallback);

// Error handling
bot.catch((err: any, ctx) => {
  console.error(`[Bot] Error for ${ctx.updateType}`, err);
  ctx.reply('❌ An error occurred while processing your request.');
});

// Start bot
export async function startBot() {
  console.log('[Bot] Starting Telegram bot...');

  // Ensure temp directories exist
  const tempDir = process.env.TEMP_VIDEO_DIR || './tmp/videos';
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  // Graceful stop
  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));

  await bot.launch();
  console.log('[Bot] Bot is running!');
}
