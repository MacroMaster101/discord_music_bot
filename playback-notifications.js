// Playback cleanup must still finish if Discord permissions changed or the
// original text channel was deleted while a song was being prepared.
async function sendPlaybackNotice(serverQueue, content) {
  try {
    await serverQueue.textChannel.send(content);
    return true;
  } catch (err) {
    console.warn(`Could not send playback notice (${err.code || 'unknown'}): ${err.message || err}`);
    return false;
  }
}

module.exports = { sendPlaybackNotice };
