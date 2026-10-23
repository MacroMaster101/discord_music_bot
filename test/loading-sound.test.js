const assert = require('node:assert/strict');
const { test } = require('node:test');

const { loopingPcmStream, renderLoadingLoop } = require('../loading-sound');

test('the loading loop is quiet, stereo 48 kHz PCM, and repeats without a click', () => {
  const pcm = renderLoadingLoop();
  assert.equal(pcm.length % 4, 0, 'whole 16-bit stereo frames');
  assert.equal(pcm.length / 4 / 48_000, 9.6);
  let peak = 0;
  let largestStep = 0;
  for (let i = 0; i < pcm.length; i += 2) {
    peak = Math.max(peak, Math.abs(pcm.readInt16LE(i)));
    if (i >= 4) largestStep = Math.max(largestStep, Math.abs(pcm.readInt16LE(i) - pcm.readInt16LE(i - 4)));
  }
  assert.ok(peak > 8000 && peak < 12000, `peak ${peak} stays around a third of full scale`);
  const seam = Math.abs(pcm.readInt16LE(0) - pcm.readInt16LE(pcm.length - 4));
  assert.ok(seam <= largestStep, 'the jump where the loop repeats is no bigger than a normal sample step');
  assert.equal(renderLoadingLoop(), pcm, 'rendered once and cached');
});

test('the loop stream keeps producing audio until it is destroyed', async () => {
  const pcm = renderLoadingLoop();
  const stream = loopingPcmStream(pcm);
  let bytes = 0;
  for await (const chunk of stream) {
    bytes += chunk.length;
    if (bytes > pcm.length * 2) break;
  }
  assert.ok(bytes > pcm.length * 2, 'it wraps around instead of ending');
  assert.equal(stream.destroyed, true);
});
