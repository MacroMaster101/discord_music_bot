# J4FN MUSIC - Discord Music Bot 🎵

A powerful and reliable Discord music bot that plays music from YouTube, featuring robust anti-bot bypass mechanisms and interactive controls.

## Features
- 🎵 **Play music from YouTube** (Supports direct URLs and search queries)
- 🎛️ **Interactive Controls** (Play Next, Skip, Queue, and Stop buttons right in chat)
- 🔊 **Voice Channel Status** (Displays the currently playing song dynamically in the Voice Channel status)
- 🍪 **YouTube Anti-Bot Bypass** (Cookies support to prevent getting blocked by YouTube)
- 🔄 **Auto-disconnect & Cleanup** (Leaves when idle or manually disconnected, auto-resets nickname on startup)
- 🎚️ **Volume control** (Optimized default volume for comfortable listening)
- 📋 **View Queue** (See what's coming up next)

## Commands
- `!play <song name or URL>` - Play a song or add it to the queue
- `!skip` - Skip current song
- `!stop` - Stop playback and clear queue
- `!queue` - Show the current queue

## Setup

1. Clone this repository
2. Use Node.js 22.12 or newer
3. Install dependencies:
   ```bash
   npm ci
   ```
4. Create a `.env` file with:
   ```env
   TOKEN=your_discord_bot_token
   PREFIX=!
   
   # Optional: Provide YouTube cookies to bypass bot detection/age restrictions
   # YTDLP_COOKIES_PATH=./cookies.txt 
   # YTDLP_COOKIES_BASE64=base64_encoded_cookies_here
   ```
5. Run the bot:
   ```bash
   npm start
   ```

## YouTube Cookies Setup (Bypass Blockers)
If YouTube starts blocking playback ("Sign in to confirm you're not a bot"), you need to provide cookies:
1. Extract your YouTube cookies using a browser extension like "Get cookies.txt LOCALLY".
2. Save them as `cookies.txt` and set `YTDLP_COOKIES_PATH=./cookies.txt` in your `.env`.
3. Alternatively, encode the file contents into Base64 and set `YTDLP_COOKIES_BASE64`.

## Deployment

### Railway.app / Render (Recommended)
1. Push code to GitHub
2. Connect your hosting provider to your GitHub repo
3. Add environment variables (`TOKEN`, `PREFIX`, `YTDLP_COOKIES_BASE64`)
4. Deploy!

### Local
Just run `npm start` and keep your PC on.

## Requirements
- Node.js 22.12+
- Discord Bot Token (with Message Content and Voice State intents enabled)
- FFmpeg (installed automatically in Docker/Nixpacks or available via ffmpeg-static)

## Tech Stack
- discord.js v14
- @discordjs/voice
- opusscript
- youtube-dl-exec (yt-dlp)
- yt-search
- ffmpeg-static

## License
MIT
