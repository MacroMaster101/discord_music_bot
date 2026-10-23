const { spawn } = require('node:child_process');
const { Readable } = require('node:stream');

// The "getting your song ready" loop. It is composed here (soft pads, a bass
// note, and a plucked arpeggio over Cmaj7 - Am7 - Fmaj7 - G6), so it needs no
// licence and no file. LOADING_SOUND_PATH can point at any audio file instead.
const SAMPLE_RATE = 48_000;
const CHANNELS = 2;
const BEAT = 0.6; // 100 BPM
const BEATS_PER_CHORD = 4;
const CHORDS = [
  [261.63, 329.63, 392.0, 493.88], // Cmaj7
  [220.0, 261.63, 329.63, 392.0], // Am7
  [174.61, 220.0, 261.63, 329.63], // Fmaj7
  [196.0, 246.94, 293.66, 329.63], // G6
];
const ARPEGGIO = [0, 1, 2, 3, 2, 1, 2, 3];
const PEAK = 0.32;

let cachedLoop = null;

// Renders one seamless loop as 16-bit little-endian stereo PCM at 48 kHz, the
// raw format @discordjs/voice encodes to Opus. Notes that run past the end
// wrap to the start, so the loop has no click where it repeats.
function renderLoadingLoop() {
  if (cachedLoop) return cachedLoop;
  const chordSeconds = BEAT * BEATS_PER_CHORD;
  const loopSeconds = chordSeconds * CHORDS.length;
  const frames = Math.round(loopSeconds * SAMPLE_RATE);
  const left = new Float64Array(frames);
  const right = new Float64Array(frames);

  const addNote = ({ start, length, freq, gain, attack, release, decay = 0, pan = 0, detune = 0, harmonic = 0 }) => {
    const total = Math.round((length + release) * SAMPLE_RATE);
    const first = Math.round(start * SAMPLE_RATE);
    const leftGain = gain * Math.cos((pan + 1) * Math.PI / 4);
    const rightGain = gain * Math.sin((pan + 1) * Math.PI / 4);
    for (let i = 0; i < total; i += 1) {
      const t = i / SAMPLE_RATE;
      let env = t < attack ? 0.5 - 0.5 * Math.cos(Math.PI * t / attack) : 1;
      if (t > length) env *= 0.5 + 0.5 * Math.cos(Math.PI * Math.min(1, (t - length) / release));
      if (decay) env *= Math.exp(-t / decay);
      const phase = 2 * Math.PI * t;
      const l = Math.sin(phase * (freq - detune)) + harmonic * Math.sin(phase * 2 * (freq - detune));
      const r = Math.sin(phase * (freq + detune)) + harmonic * Math.sin(phase * 2 * (freq + detune));
      const index = (first + i) % frames;
      left[index] += l * env * leftGain;
      right[index] += r * env * rightGain;
    }
  };

  CHORDS.forEach((chord, c) => {
    const start = c * chordSeconds;
    chord.forEach((freq, n) => addNote({
      start, length: chordSeconds, freq, gain: 0.11, attack: 0.35, release: 0.4,
      pan: (n - 1.5) * 0.35, detune: 0.6, harmonic: 0.25,
    }));
    addNote({ start, length: chordSeconds - 0.2, freq: chord[0] / 2, gain: 0.16, attack: 0.05, release: 0.3, decay: 1.6 });
    ARPEGGIO.forEach((tone, step) => addNote({
      start: start + step * (BEAT / 2), length: 0.05, freq: chord[tone] * 2, gain: 0.07, attack: 0.006,
      release: 0.5, decay: 0.32, pan: step % 2 ? 0.45 : -0.45, harmonic: 0.4,
    }));
  });

  let max = 0;
  for (let i = 0; i < frames; i += 1) max = Math.max(max, Math.abs(left[i]), Math.abs(right[i]));
  const scale = max ? PEAK / max : 0;
  const pcm = Buffer.alloc(frames * CHANNELS * 2);
  for (let i = 0; i < frames; i += 1) {
    pcm.writeInt16LE(Math.round(left[i] * scale * 32767), i * 4);
    pcm.writeInt16LE(Math.round(right[i] * scale * 32767), i * 4 + 2);
  }
  cachedLoop = pcm;
  return pcm;
}

// An endless stream of the loop. Destroy it to stop.
function loopingPcmStream(pcm = renderLoadingLoop()) {
  let offset = 0;
  return new Readable({
    read(size) {
      const end = Math.min(pcm.length, offset + Math.max(size || 0, 3840));
      this.push(pcm.subarray(offset, end));
      offset = end % pcm.length;
    },
  });
}

// A custom loop file is decoded to the same raw PCM by FFmpeg, repeated forever.
function fileLoopStream(file, spawnProcess = spawn) {
  const child = spawnProcess('ffmpeg', [
    '-loglevel', 'error', '-stream_loop', '-1', '-i', file,
    '-vn', '-f', 's16le', '-ar', String(SAMPLE_RATE), '-ac', String(CHANNELS), 'pipe:1',
  ], { windowsHide: true });
  child.on('error', () => {});
  child.stdout.once('close', () => { try { child.kill('SIGKILL'); } catch {} });
  return child.stdout;
}

function createLoadingStream(file = process.env.LOADING_SOUND_PATH) {
  return file ? fileLoopStream(file) : loopingPcmStream();
}

module.exports = { SAMPLE_RATE, createLoadingStream, loopingPcmStream, renderLoadingLoop };
