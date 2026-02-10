import { startBot } from '../src/bot';
import { startWorker } from '../src/queue/worker';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

console.log('🚀 Starting Bot and Worker...');

// Check for required environment variables
if (!process.env.TELEGRAM_BOT_TOKEN) {
  console.error('❌ Error: TELEGRAM_BOT_TOKEN is not set');
  process.exit(1);
}

if (!process.env.REDIS_URL) {
  console.warn('⚠️ Warning: REDIS_URL is not set. Defaulting to redis://localhost:6379');
}

// Start both bot and worker
Promise.all([
  startBot(),
  Promise.resolve(startWorker())
]).catch((err) => {
  console.error('❌ Failed to start services:', err);
  process.exit(1);
});

// Handle graceful shutdown
process.on('SIGTERM', async () => {
  console.log('[Main] Received SIGTERM, shutting down...');
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('[Main] Received SIGINT, shutting down...');
  process.exit(0);
});
