require('dotenv').config();

const {
  Client,
  GatewayIntentBits,
} = require('discord.js');

const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  NoSubscriberBehavior,
  getVoiceConnection,
  StreamType,
} = require('@discordjs/voice');

const ytSearch = require('yt-search');
const youtubedl = require('youtube-dl-exec');

const PREFIX = process.env.PREFIX || '!';
const TOKEN = process.env.TOKEN || process.env.DISCORD_TOKEN || process.env.BOT_TOKEN;

if (!TOKEN) {
  console.error('Missing Discord bot token. Set TOKEN in your environment.');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

const queue = new Map();

client.once('ready', () => {
  console.log(`🎵 ${client.user.tag} is online!`);
});

client.on('voiceStateUpdate', (oldState, newState) => {
  // Check if bot was disconnected by someone
  if (oldState.id === client.user?.id && oldState.channelId && !newState.channelId) {
    const serverQueue = queue.get(oldState.guild.id);
    if (serverQueue) {
      console.log('🔴 Bot was disconnected, stopping playback');
      serverQueue.songs = [];
      serverQueue.player.stop();
      queue.delete(oldState.guild.id);
    }
  }
});

client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild || !message.content.startsWith(PREFIX)) return;

  const args = message.content.slice(PREFIX.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();
  const serverQueue = queue.get(message.guild.id);

  try {
    if (command === 'play') await execute(message, serverQueue, args);
    else if (command === 'skip') skip(message, serverQueue);
    else if (command === 'stop') stop(message, serverQueue);
    else if (command === 'queue') showQueue(message, serverQueue);
  } catch (err) {
    console.error('Error:', err);
    message.reply('⚠️ Something went wrong!');
  }
});

async function execute(message, serverQueue, args) {
  const voiceChannel = message.member?.voice?.channel;
  if (!voiceChannel) return message.reply('❌ You need to be in a voice channel!');
  if (!args.length) return message.reply(`Usage: \`${PREFIX}play <song name or URL>\``);

  let song;
  const searchText = args.join(' ');

  try {
    // Check if URL or search
    if (isUrl(searchText)) {
      song = await getSongFromUrl(searchText);
    } else {
      const searchResult = await ytSearch(searchText);
      const video = searchResult.videos[0];
      if (!video) return message.reply('❌ No results found!');
      song = {
        title: video.title,
        url: video.url,
      };
    }
  } catch (err) {
    console.error('Search error:', err);
    return message.reply('❌ Could not find that song!');
  }

  if (!serverQueue) {
    const queueConstruct = {
      textChannel: message.channel,
      voiceChannel,
      connection: null,
      currentProcess: null,
      player: createAudioPlayer({
        behaviors: { noSubscriber: NoSubscriberBehavior.Play },
      }),
      songs: [song],
    };

    queue.set(message.guild.id, queueConstruct);

    try {
      const connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: message.guild.id,
        adapterCreator: message.guild.voiceAdapterCreator,
        selfDeaf: false,
        selfMute: false,
      });

      queueConstruct.connection = connection;
      
      // Handle connection errors
      connection.on('error', (error) => {
        console.error('Voice connection error:', error);
        message.channel.send('❌ Voice connection error! Trying to reconnect...');
      });

      connection.on('stateChange', (oldState, newState) => {
        console.log(`Connection state: ${oldState.status} -> ${newState.status}`);
        if (newState.status === 'disconnected') {
          // Only reconnect if queue still exists (not manually disconnected)
          const serverQueue = queue.get(message.guild.id);
          if (serverQueue && serverQueue.songs.length > 0) {
            console.log('Reconnecting...');
            setTimeout(() => connection.rejoin(), 500);
          }
        }
      });

      connection.subscribe(queueConstruct.player);

      queueConstruct.player.on('stateChange', (oldState, newState) => {
        console.log(`Player state: ${oldState.status} -> ${newState.status}`);
      });

      queueConstruct.player.on(AudioPlayerStatus.Idle, async () => {
        console.log('Song finished, checking queue...');
        cleanupCurrentProcess(queueConstruct);
        queueConstruct.songs.shift();
        if (queueConstruct.songs.length > 0) {
          console.log(`▶️ Next: ${queueConstruct.songs[0].title}`);
          await playSong(message.guild.id, queueConstruct.songs[0]);
        } else {
          console.log('✅ Queue empty, bot will stay in voice channel');
          queueConstruct.textChannel.send('✅ Queue finished! Add more songs with `!play` or use `!stop` to disconnect.');
        }
      });

      queueConstruct.player.on('error', async (error) => {
        console.error('Player error:', error.message);
        cleanupCurrentProcess(queueConstruct);
        message.channel.send(`❌ Playback error, skipping...`);
        queueConstruct.songs.shift();
        if (queueConstruct.songs.length > 0) {
          setTimeout(() => playSong(message.guild.id, queueConstruct.songs[0]), 1000);
        }
      });

      await message.reply(`🎶 Now playing: **${song.title}**`);
      await playSong(message.guild.id, song);
    } catch (err) {
      console.error('Connection error:', err);
      queue.delete(message.guild.id);
      return message.reply('❌ Could not join voice channel! Make sure the bot has proper permissions.');
    }
  } else {
    serverQueue.songs.push(song);
    return message.reply(`➕ Added to queue: **${song.title}**`);
  }
}

function isUrl(input) {
  try {
    const url = new URL(input);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function normalizeMediaUrl(input) {
  const url = new URL(input);

  if (url.hostname === 'youtu.be') {
    const videoId = url.pathname.split('/').filter(Boolean)[0];
    if (videoId) return `https://www.youtube.com/watch?v=${videoId}`;
  }

  if (url.hostname.endsWith('youtube.com')) {
    const videoId = url.searchParams.get('v');
    if (videoId) return `https://www.youtube.com/watch?v=${videoId}`;

    const pathParts = url.pathname.split('/').filter(Boolean);
    if ((pathParts[0] === 'live' || pathParts[0] === 'shorts') && pathParts[1]) {
      return `https://www.youtube.com/watch?v=${pathParts[1]}`;
    }
  }

  return input;
}

async function getSongFromUrl(input) {
  const url = normalizeMediaUrl(input);

  try {
    const videoInfo = await youtubedl(url, {
      dumpSingleJson: true,
      noCheckCertificates: true,
      noWarnings: true,
      noPlaylist: true,
      skipDownload: true,
    });

    return {
      title: videoInfo.title || url,
      url: videoInfo.webpage_url || videoInfo.original_url || url,
    };
  } catch (err) {
    console.warn(`Metadata lookup failed for ${url}:`, err.message || err);
    return {
      title: url,
      url,
    };
  }
}

async function playSong(guildId, song) {
  const serverQueue = queue.get(guildId);
  if (!serverQueue || !song) return;

  try {
    cleanupCurrentProcess(serverQueue);

    const subprocess = youtubedl.exec(song.url, {
      output: '-',
      format: 'bestaudio/best',
      noCheckCertificates: true,
      noWarnings: true,
      noPlaylist: true,
      preferFreeFormats: true,
      addHeader: ['referer:youtube.com', 'user-agent:googlebot'],
    });

    serverQueue.currentProcess = subprocess;

    let stderr = '';
    subprocess.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    subprocess.catch((err) => {
      const details = stderr.trim() || err.stderr || err.message || err;
      console.error(`yt-dlp process error for ${song.url}:`, details);
    });

    const resource = createAudioResource(subprocess.stdout, {
      inputType: StreamType.Arbitrary,
      inlineVolume: true,
      metadata: {
        title: song.title,
      },
    });
    
    resource.volume?.setVolume(0.5);
    serverQueue.player.play(resource);
    serverQueue.textChannel.send(`▶️ Now playing: **${song.title}**`);
    console.log(`▶️ Playing: ${song.title}`);
  } catch (err) {
    console.error('Play error:', err);
    cleanupCurrentProcess(serverQueue);
    serverQueue.textChannel.send(`❌ Could not play: ${song.title}`);
    serverQueue.songs.shift();
    if (serverQueue.songs.length > 0) await playSong(guildId, serverQueue.songs[0]);
  }
}

function cleanupCurrentProcess(serverQueue) {
  if (!serverQueue?.currentProcess) return;

  try {
    serverQueue.currentProcess.kill('SIGKILL');
  } catch (err) {
    console.warn('Could not stop yt-dlp process:', err.message || err);
  } finally {
    serverQueue.currentProcess = null;
  }
}

function skip(message, serverQueue) {
  if (!serverQueue) return message.reply('❌ Nothing is playing!');
  cleanupCurrentProcess(serverQueue);
  serverQueue.player.stop();
  message.reply('⏭️ Skipped!');
}

function stop(message, serverQueue) {
  if (!serverQueue) return message.reply('❌ Nothing is playing!');
  serverQueue.songs = [];
  cleanupCurrentProcess(serverQueue);
  serverQueue.player.stop();
  const conn = getVoiceConnection(message.guild.id);
  if (conn) conn.destroy();
  queue.delete(message.guild.id);
  message.reply('⏹️ Stopped!');
}

function showQueue(message, serverQueue) {
  if (!serverQueue || !serverQueue.songs.length) {
    return message.reply('❌ Queue is empty!');
  }
  const queueList = serverQueue.songs
    .map((song, i) => `${i === 0 ? '▶️' : `${i}.`} ${song.title}`)
    .join('\n');
  message.reply(`🎵 **Queue:**\n${queueList}`);
}

client.login(TOKEN);
