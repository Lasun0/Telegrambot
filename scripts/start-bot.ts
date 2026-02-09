import { startBot } from '../src/bot';
import * as dotenv from 'dotenv';

// Load environment variables (supports both .env.local and .env for production)
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

console.log('🚀 Starting Telegram Bot...');

// Check for required environment variables
if (!process.env.TELEGRAM_BOT_TOKEN) {
  console.error('❌ Error: TELEGRAM_BOT_TOKEN is not set in .env.local');
  process.exit(1);
}

if (!process.env.REDIS_URL) {
  console.warn('⚠️ Warning: REDIS_URL is not set. Defaulting to redis://localhost:6379');
}

// Start the bot
startBot().catch((err) => {
  console.error('❌ Failed to start bot:', err);
  process.exit(1);
});
