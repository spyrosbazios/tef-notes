// Raw 16-bit little-endian mono PCM, the audio of Talk's socket (core/talk.ts), and the floats the browser's audio runs on.
// Pure: test/talk.test.ts.

/** Float samples (-1..1) as 16-bit little-endian PCM; a sample past the range is clipped. */
export function pcm16(samples: Float32Array): ArrayBuffer {
  const out = new ArrayBuffer(samples.length * 2), view = new DataView(out);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return out;
}

/** 16-bit little-endian PCM as float samples; a trailing odd byte is not a sample and is dropped. */
export function floats(pcm: ArrayBuffer): Float32Array<ArrayBuffer> {
  const view = new DataView(pcm), out = new Float32Array(pcm.byteLength >> 1);
  for (let i = 0; i < out.length; i++) out[i] = view.getInt16(i * 2, true) / 0x8000;
  return out;
}

/** The loudness of `samples`, 0..1: their root mean square. */
export function rms(samples: ArrayLike<number>): number {
  if (!samples.length) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.min(1, Math.sqrt(sum / samples.length));
}
