import { startBot } from '../src/bot';
import * as dotenv from 'dotenv';
import * as http from 'http';

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

// Create a simple HTTP server for health checks (Koyeb requires this)
const PORT = process.env.PORT || 8000;
const server = http.createServer((req, res) => {
  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('OK - Bot is running');
  } else {
    res.writeHead(404);
    res.end('Not Found');
  }
});

server.listen(PORT, () => {
  console.log(`[Health] Health check server running on port ${PORT}`);
});

// Start the bot
startBot().catch((err) => {
  console.error('❌ Failed to start bot:', err);
  process.exit(1);
});
