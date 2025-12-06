# J4FN MUSIC - Discord Music Bot 🎵

A powerful Discord music bot that plays music from YouTube.

## Features
- 🎵 Play music from YouTube (URL or search)
- ⏭️ Skip songs
- ⏹️ Stop playback
- 📋 View queue
- 🔄 Auto-disconnect when manually removed
- 🎚️ Volume control (50% default)

## Commands
- `!play <song name or URL>` - Play a song
- `!skip` - Skip current song
- `!stop` - Stop playback and disconnect
- `!queue` - Show current queue

## Setup

1. Clone this repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Create a `.env` file with:
   ```
   TOKEN=your_discord_bot_token
   PREFIX=!
   ```
4. Run the bot:
   ```bash
   npm start
   ```

## Deployment

### Railway.app (Recommended)
1. Push code to GitHub
2. Connect Railway to your GitHub repo
3. Add environment variables (TOKEN, PREFIX)
4. Deploy!

### Local
Just run `npm start` and keep your PC on.

## Requirements
- Node.js 18+ 
- Discord Bot Token
- FFmpeg (included via ffmpeg-static)

## Tech Stack
- discord.js v14
- @discordjs/voice
- youtube-dl-exec
- yt-search
- ffmpeg-static

## License
MIT
