require('dotenv').config();

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
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
let nextSongId = 1;

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

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton() || !interaction.guild) return;

  const serverQueue = queue.get(interaction.guild.id);
  const memberVoiceChannel = interaction.member?.voice?.channel;

  if (!serverQueue) {
    return interaction.reply({
      content: '❌ Nothing is playing!',
      ephemeral: true,
    });
  }

  if (!memberVoiceChannel || memberVoiceChannel.id !== serverQueue.voiceChannel.id) {
    return interaction.reply({
      content: '❌ Join the same voice channel as the bot to use these controls.',
      ephemeral: true,
    });
  }

  if (interaction.customId === 'music_skip') {
    cleanupCurrentProcess(serverQueue);
    serverQueue.player.stop();
    return interaction.reply('⏭️ Skipped!');
  }

  if (interaction.customId === 'music_stop') {
    stopQueue(interaction.guild.id, serverQueue);
    return interaction.reply('⏹️ Stopped!');
  }

  if (interaction.customId === 'music_queue') {
    return interaction.reply({
      content: getQueueText(serverQueue),
      ephemeral: true,
    });
  }

  if (interaction.customId.startsWith('music_next:')) {
    const songId = interaction.customId.split(':')[1];
    const songIndex = serverQueue.songs.findIndex((song) => song.id === songId);

    if (songIndex <= 0) {
      return interaction.reply({
        content: '❌ That song is already playing or is no longer in the queue.',
        ephemeral: true,
      });
    }

    const [song] = serverQueue.songs.splice(songIndex, 1);
    serverQueue.songs.splice(1, 0, song);
    return interaction.reply(`🔼 Moved next: **${song.title}**`);
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
        id: createSongId(),
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

      await message.reply({
        content: `🎶 Now playing: **${song.title}**`,
        components: [createMusicControls()],
      });
      await playSong(message.guild.id, song);
    } catch (err) {
      console.error('Connection error:', err);
      queue.delete(message.guild.id);
      return message.reply('❌ Could not join voice channel! Make sure the bot has proper permissions.');
    }
  } else {
    serverQueue.songs.push(song);
    return message.reply({
      content: `➕ Added to queue: **${song.title}**`,
      components: [createMusicControls(song.id)],
    });
  }
}

function createSongId() {
  nextSongId += 1;
  return nextSongId.toString();
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
      id: createSongId(),
      title: videoInfo.title || url,
      url: videoInfo.webpage_url || videoInfo.original_url || url,
    };
  } catch (err) {
    console.warn(`Metadata lookup failed for ${url}:`, err.message || err);
    return {
      id: createSongId(),
      title: url,
      url,
    };
  }
}

function createMusicControls(playNextSongId) {
  const buttons = [];

  if (playNextSongId) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`music_next:${playNextSongId}`)
        .setLabel('Play Next')
        .setStyle(ButtonStyle.Primary)
    );
  }

  buttons.push(
    new ButtonBuilder()
      .setCustomId('music_skip')
      .setLabel('Skip')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('music_queue')
      .setLabel('Queue')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('music_stop')
      .setLabel('Stop')
      .setStyle(ButtonStyle.Danger)
  );

  return new ActionRowBuilder().addComponents(buttons);
}

async function playSong(guildId, song) {
  const serverQueue = queue.get(guildId);
  if (!serverQueue || !song) return;

  try {
    cleanupCurrentProcess(serverQueue);

    const audioUrlOutput = await youtubedl(song.url, {
      getUrl: true,
      format: 'bestaudio[ext=webm]/bestaudio/best',
      noCheckCertificates: true,
      noWarnings: true,
      noPlaylist: true,
      preferFreeFormats: true,
      addHeader: ['referer:youtube.com', 'user-agent:googlebot'],
    });

    const audioUrl = audioUrlOutput
      .toString()
      .split(/\r?\n/)
      .find(Boolean);

    if (!audioUrl) {
      throw new Error('yt-dlp did not return an audio URL');
    }

    const resource = createAudioResource(audioUrl, {
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
  stopQueue(message.guild.id, serverQueue);
  message.reply('⏹️ Stopped!');
}

function stopQueue(guildId, serverQueue) {
  serverQueue.songs = [];
  cleanupCurrentProcess(serverQueue);
  serverQueue.player.stop();
  const conn = getVoiceConnection(guildId);
  if (conn) conn.destroy();
  queue.delete(guildId);
}

function showQueue(message, serverQueue) {
  if (!serverQueue || !serverQueue.songs.length) {
    return message.reply('❌ Queue is empty!');
  }
  message.reply(getQueueText(serverQueue));
}

function getQueueText(serverQueue) {
  const queueList = serverQueue.songs
    .map((song, i) => `${i === 0 ? '▶️' : `${i}.`} ${song.title}`)
    .join('\n');
  return `🎵 **Queue:**\n${queueList}`;
}

client.login(TOKEN);
