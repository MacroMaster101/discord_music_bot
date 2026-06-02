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

# Install dependencies
RUN npm ci --omit=dev

# Download latest yt-dlp binary and replace the bundled one
RUN wget -q https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -O /usr/local/bin/yt-dlp \
    && chmod +x /usr/local/bin/yt-dlp \
    && cp /usr/local/bin/yt-dlp ./node_modules/youtube-dl-exec/bin/yt-dlp

# Copy application files
COPY . .

# Start the bot
CMD ["npm", "start"]
