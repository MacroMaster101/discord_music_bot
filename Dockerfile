FROM node:22-slim

# Install runtime tools for Discord voice playback and yt-dlp.
RUN apt-get update && apt-get install -y \
    ca-certificates \
    ffmpeg \
    python3 \
    wget \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies, then remove the huge ffmpeg-static binary (~100MB)
# since we already have ffmpeg from apt-get above
RUN npm ci --omit=dev \
    && rm -rf node_modules/ffmpeg-static/ffmpeg node_modules/ffmpeg-static/ffmpeg.exe 2>/dev/null; true

# Download latest yt-dlp binary and replace the bundled one, then remove wget to save space
RUN wget -q https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -O /usr/local/bin/yt-dlp \
    && chmod +x /usr/local/bin/yt-dlp \
    && cp /usr/local/bin/yt-dlp ./node_modules/youtube-dl-exec/bin/yt-dlp \
    && apt-get purge -y wget && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*

# Copy application files
COPY . .

# Start the bot
CMD ["npm", "start"]
