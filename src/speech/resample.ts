/** Concatenate audio chunks into one buffer. */
export function concat(chunks: readonly Float32Array[]): Float32Array {
  let n = 0;
  for (const c of chunks) n += c.length;
  const out = new Float32Array(n);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

/**
 * Resample mono audio to `toRate` (16 kHz for Whisper). Averages over each output
 * sample's input window when downsampling, which is a cheap low-pass that avoids the
 * worst aliasing; linear interpolation otherwise.
 */
export function resample(input: Float32Array, fromRate: number, toRate = 16000): Float32Array {
  if (fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const len = Math.floor(input.length / ratio);
  const out = new Float32Array(len);
  if (ratio > 1) {
    for (let i = 0; i < len; i++) {
      const start = i * ratio;
      const end = Math.min(input.length, start + ratio);
      let sum = 0;
      let n = 0;
      for (let j = Math.floor(start); j < end; j++) {
        sum += input[j]!;
        n++;
      }
      out[i] = n ? sum / n : 0;
    }
  } else {
    for (let i = 0; i < len; i++) {
      const x = i * ratio;
      const i0 = Math.floor(x);
      const f = x - i0;
      out[i] = input[i0]! * (1 - f) + (input[i0 + 1] ?? 0) * f;
    }
  }
  return out;
}

export function rms(frame: Float32Array): number {
  let s = 0;
  for (let i = 0; i < frame.length; i++) s += frame[i]! * frame[i]!;
  return frame.length ? Math.sqrt(s / frame.length) : 0;
}
