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

# Upgrade bundled yt-dlp to latest nightly for freshest anti-bot patches
RUN ./node_modules/youtube-dl-exec/bin/yt-dlp -U || \
    python3 -m pip install --break-system-packages -U yt-dlp 2>/dev/null || \
    echo "Warning: could not update yt-dlp, using bundled version"

# Copy application files
COPY . .

# Start the bot
CMD ["npm", "start"]
