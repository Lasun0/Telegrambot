# Step-by-Step: Deploy Telegram Bot to Run 24/7

This guide will help you deploy your Telegram bot to **Railway.app** - a free cloud platform that runs your bot even when your PC is off.

---

## Prerequisites

Before starting, you need:

1. **GitHub Account** - Create one at https://github.com if you don't have it
2. **Railway Account** - Free at https://railway.app (sign up with GitHub)
3. **Your Bot Token** - From @BotFather on Telegram
4. **Gemini API Key** - From https://aistudio.google.com/app/apikey

---

## Step 1: Push Your Code to GitHub

### 1.1 Initialize Git (if not already done)

Open PowerShell/Terminal in your project folder:

```powershell
cd C:\Users\Public\clean-class-recorder

# Initialize git
git init

# Create .gitignore to exclude sensitive files
```

### 1.2 Create a .gitignore file

Create a file named `.gitignore` with this content:

```
node_modules/
.env
.env.local
dist/
tmp/
data/
*.log
.next/
```

### 1.3 Commit and push to GitHub

```powershell
# Add all files
git add .

# Commit
git commit -m "Initial commit - Telegram bot"

# Create a new repository on GitHub (https://github.com/new)
# Then connect and push:
git remote add origin https://github.com/YOUR_USERNAME/clean-class-recorder.git
git branch -M main
git push -u origin main
```

---

## Step 2: Set Up Redis (Free on Upstash)

Your bot needs Redis for the job queue.

### 2.1 Create Upstash Account

1. Go to https://upstash.com
2. Sign up (free tier available)
3. Click **Create Database**
4. Choose:
   - Name: `telegram-bot-queue`
   - Region: Choose closest to you
   - Type: **Regional**
5. Click **Create**

### 2.2 Get Your Redis URL

1. In the Upstash dashboard, click your database
2. Find **UPSTASH_REDIS_REST_URL** or scroll to **Connect**
3. Copy the **Redis URL** (starts with `rediss://...`)
4. Save this - you'll need it later!

---

## Step 3: Deploy Bot to Railway

### 3.1 Create Railway Project

1. Go to https://railway.app
2. Click **Start a New Project**
3. Select **Deploy from GitHub repo**
4. Connect your GitHub account if needed
5. Select your `clean-class-recorder` repository

### 3.2 Configure the Bot Service

Railway will create a service. Now configure it:

1. Click on the service
2. Go to **Settings** tab
3. Under **Build**, set:
   - **Build Command**: `npm install && npm run build:bot`
   - **Start Command**: `npm run bot:prod`

### 3.3 Add Environment Variables

1. Go to **Variables** tab
2. Click **Add Variable** for each:

| Variable | Value |
|----------|-------|
| `TELEGRAM_BOT_TOKEN` | Your bot token from @BotFather |
| `REDIS_URL` | Your Upstash Redis URL (rediss://...) |
| `GEMINI_API_KEY` | Your Gemini API key |
| `TEMP_VIDEO_DIR` | `/tmp/videos` |
| `DEFAULT_API_PROVIDER` | `gemini` |
| `DEFAULT_MODEL` | `gemini-2.0-flash` |

### 3.4 Deploy

1. Railway will automatically deploy
2. Check the **Deployments** tab for logs
3. Wait for "Bot is running!" message

---

## Step 4: Deploy Worker (Second Service)

The worker processes videos. You need a separate service for it.

### 4.1 Add Another Service

1. In your Railway project, click **+ New**
2. Select **GitHub Repo** → Same repository
3. This creates a second service

### 4.2 Configure Worker Service

1. Click the new service
2. Go to **Settings**:
   - **Build Command**: `npm install && npm run build:bot`
   - **Start Command**: `npm run worker:prod`

### 4.3 Add Same Environment Variables

Copy all the same variables from the bot service:
- `TELEGRAM_BOT_TOKEN`
- `REDIS_URL`
- `GEMINI_API_KEY`
- `TEMP_VIDEO_DIR`
- `DEFAULT_API_PROVIDER`
- `DEFAULT_MODEL`

### 4.4 Deploy

Railway will deploy the worker automatically.

---

## Step 5: Test Your Bot

1. Open Telegram
2. Find your bot (search for the username you created with @BotFather)
3. Send `/start`
4. Send a video file
5. Wait for the AI to process it!

---

## Troubleshooting

### Bot not responding?

1. Check Railway logs (Deployments → View Logs)
2. Verify `TELEGRAM_BOT_TOKEN` is correct
3. Make sure you started the bot with @BotFather (`/start` command)

### Videos not processing?

1. Check worker logs in Railway
2. Verify `REDIS_URL` is correct (should start with `rediss://` for Upstash)
3. Check `GEMINI_API_KEY` is valid

### "Redis connection error"?

1. Go to Upstash dashboard
2. Verify database is active
3. Copy the correct Redis URL (TLS version with `rediss://`)

---

## Monthly Costs

| Service | Free Tier | Notes |
|---------|-----------|-------|
| Railway | $5 credit/month | Usually enough for light use |
| Upstash Redis | 10K commands/day | Free tier is sufficient |
| Gemini API | Free tier available | Check quotas |

---

## Quick Reference

After deployment, your bot runs 24/7 automatically:

- **Bot URL**: Shown in Railway dashboard
- **Logs**: Railway → Your service → Deployments → View Logs
- **Restart**: Railway → Your service → Settings → Restart

---

## Alternative: Deploy with Render.com

If you prefer Render.com:

1. Go to https://render.com
2. Create **Background Worker** (not Web Service)
3. Connect GitHub repo
4. Build Command: `npm install && npm run build:bot`
5. Start Command: `npm run bot:prod`
6. Add environment variables
7. Create another Background Worker for the worker service

---

**Your bot is now running 24/7!** 🎉
