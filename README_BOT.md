# Telegram Bot for Clean Class Recorder

This directory contains the implementation of a Telegram bot that interfaces with the Clean Class Recorder system. The bot allows users to upload class recordings, which are then processed by AI to generate summaries, chapters, and trimmed videos.

## Features

- **Video Upload**: Send MP4, MOV, MKV, or WebM files directly to the bot.
- **AI Processing**: Uses Google Gemini or Knight (OpenAI) to analyze educational content.
- **Smart Summarization**: Generates structured summaries and key points.
- **Chapter Extraction**: Identifies and timestamps key topics.
- **Auto-Trimming**: Creates a shortened version of the video containing only essential content.
- **User Settings**: Persists user preferences for AI provider and model.
- **Queue System**: Handles multiple concurrent requests using BullMQ and Redis.

## Prerequisites

- Node.js 18+
- Redis (running locally or remotely)
- FFmpeg (installed via `@ffmpeg-installer/ffmpeg` automatically)
- A Telegram Bot Token (from @BotFather)
- Gemini API Key (or Knight/OpenAI key)

## Installation

1. Install dependencies:
   ```bash
   npm install
   ```

2. Configure environment variables in `.env.local`:
   ```env
   # Telegram
   TELEGRAM_BOT_TOKEN=your_bot_token_here

   # Redis
   REDIS_URL=redis://localhost:6379

   # AI Providers
   GEMINI_API_KEY=your_gemini_key
   # Optional: Pool of keys
   GEMINI_API_KEYS=key1,key2,key3

   # Optional: Knight/OpenAI
   KNIGHT_API_KEY=your_knight_key

   # Configuration
   TEMP_VIDEO_DIR=./tmp/videos
   MAX_QUEUE_SIZE=10
   DEFAULT_API_PROVIDER=gemini
   DEFAULT_MODEL=gemini-2.0-flash
   ```

## Running the System

The system consists of two parts that must run simultaneously:

1. **The Bot Process**: Handles user interactions and file downloads.
   ```bash
   npm run bot
   ```

2. **The Worker Process**: Processes the video queue (AI analysis + FFmpeg trimming).
   ```bash
   npm run worker
   ```

## Bot Commands

- `/start` - Initialize the bot and see welcome message
- `/settings` - Configure AI provider (Gemini/Knight) and Model
- `/status` - Check the status of your current jobs and the global queue
- `/help` - View help information

## Architecture

1. User sends video -> **Bot** downloads it -> Adds job to **Redis Queue**.
2. **Worker** picks up job -> Uploads to **Gemini**.
3. **Gemini** analyzes content -> Returns timestamps and summary.
4. **Worker** uses **FFmpeg** to trim video based on timestamps.
5. **Worker** sends summary, chapters, and trimmed video back to User via **Telegram**.

## Troubleshooting

- **Redis Connection Error**: Ensure Redis is running and `REDIS_URL` is correct.
- **FFmpeg Error**: The system tries to use `@ffmpeg-installer/ffmpeg`. If that fails, ensure FFmpeg is installed on your system and in the PATH.
- **Telegram File Size Limit**: Bots can download files up to 20MB by default, but up to 2GB if using the local Bot API server. This implementation uses standard `telegraf` methods which support up to 20MB for direct downloads, but we use `ctx.telegram.getFileLink` which supports up to 20MB. **Note**: For larger files (up to 2GB), a local Telegram Bot API server is required, or standard HTTP download if the file is small enough. The current implementation uses `ctx.telegram.getFileLink` and `axios` stream download, which works for files < 20MB. For > 20MB files, you normally need a local Bot API server.

## Directory Structure

- `src/bot/` - Bot logic (handlers, keyboards, utils)
- `src/queue/` - Queue and Worker logic
- `src/lib/` - Shared utilities (settings, trimmer)
- `scripts/` - Startup scripts
