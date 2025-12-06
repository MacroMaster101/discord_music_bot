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
} = require('@discordjs/voice');

const ytSearch = require('yt-search');
const play = require('play-dl');

const PREFIX = process.env.PREFIX || '!';

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
  if (oldState.member.id === client.user.id && oldState.channelId && !newState.channelId) {
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
    if (searchText.match(/^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\//)) {
      // YouTube URL - validate and get info
      const info = await play.video_info(searchText);
      song = {
        title: info.video_details.title,
        url: info.video_details.url,
      };
    } else {
      // Search query
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

      const subscription = connection.subscribe(queueConstruct.player);
      if (!subscription) {
        console.error('❌ Failed to subscribe player to connection');
        throw new Error('Could not subscribe player to voice connection');
      }
      console.log('✅ Player subscribed to voice connection');

      queueConstruct.player.on('stateChange', (oldState, newState) => {
        console.log(`Player state: ${oldState.status} -> ${newState.status}`);
      });

      queueConstruct.player.on(AudioPlayerStatus.Idle, async () => {
        console.log('Song finished, checking queue...');
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

async function playSong(guildId, song) {
  const serverQueue = queue.get(guildId);
  if (!serverQueue || !song) return;

  try {
    console.log(`🎵 Attempting to play: ${song.url}`);
    
    // Use play-dl for better YouTube support
    const stream = await play.stream(song.url);
    
    const resource = createAudioResource(stream.stream, {
      inputType: stream.type,
      inlineVolume: true,
    });
    
    resource.volume?.setVolume(0.5);
    serverQueue.player.play(resource);
    serverQueue.textChannel.send(`🎶 Now playing: **${song.title}**`);
    console.log(`✅ Successfully started playing: ${song.title}`);
  } catch (err) {
    console.error('❌ Play error details:', err.message || err);
    serverQueue.textChannel.send(`❌ Could not play: ${song.title}`);
    serverQueue.songs.shift();
    if (serverQueue.songs.length > 0) {
      setTimeout(() => playSong(guildId, serverQueue.songs[0]), 1000);
    }
  }
}

function skip(message, serverQueue) {
  if (!serverQueue) return message.reply('❌ Nothing is playing!');
  serverQueue.player.stop();
  message.reply('⏭️ Skipped!');
}

function stop(message, serverQueue) {
  if (!serverQueue) return message.reply('❌ Nothing is playing!');
  serverQueue.songs = [];
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

client.login(process.env.TOKEN || process.env.DISCORD_TOKEN || process.env.BOT_TOKEN);
