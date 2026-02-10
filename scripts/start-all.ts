import { startBot } from '../src/bot';
import { startWorker } from '../src/queue/worker';
import * as dotenv from 'dotenv';
import * as http from 'http';

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

// Create health check server for Koyeb
const PORT = process.env.PORT || 8000;
const server = http.createServer((req, res) => {
  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('OK - Bot and Worker are running');
  } else {
    res.writeHead(404);
    res.end('Not Found');
  }
});

server.listen(PORT, () => {
  console.log(`[Health] Health check server running on port ${PORT}`);
});

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
  server.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('[Main] Received SIGINT, shutting down...');
  server.close();
  process.exit(0);
});
