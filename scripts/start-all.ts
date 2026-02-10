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

// Minimal health check server to satisfy Koyeb
const PORT = process.env.PORT || 8000;
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Healthy');
});

server.listen(PORT, () => {
  console.log(`[Health] Simple health check server listening on port ${PORT}`);
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
