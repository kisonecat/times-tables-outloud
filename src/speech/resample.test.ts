import { describe, expect, it } from 'vitest';
import { concat, resample, rms } from './resample';

const tone = (hz: number, rate: number, seconds: number) =>
  Float32Array.from({ length: Math.round(rate * seconds) }, (_, i) =>
    Math.sin((2 * Math.PI * hz * i) / rate),
  );

describe('resample', () => {
  it('converts length by the rate ratio', () => {
    expect(resample(new Float32Array(48000), 48000).length).toBe(16000);
    expect(resample(new Float32Array(44100), 44100).length).toBe(16000);
    expect(resample(new Float32Array(8000), 8000).length).toBe(16000);
  });

  it('passes through at the same rate', () => {
    const x = new Float32Array([1, 2, 3]);
    expect(resample(x, 16000)).toBe(x);
  });

  it('keeps a speech-band tone at about the same level', () => {
    const out = resample(tone(300, 48000, 1), 48000);
    expect(rms(out)).toBeGreaterThan(0.65);
    expect(rms(out)).toBeLessThan(0.72);
  });

  it('attenuates a tone above the new Nyquist', () => {
    // 15 kHz would alias badly at 16 kHz; averaging knocks it down.
    expect(rms(resample(tone(15000, 48000, 1), 48000))).toBeLessThan(0.3);
  });
});

describe('concat / rms', () => {
  it('joins chunks', () => {
    expect([...concat([new Float32Array([1, 2]), new Float32Array([3])])]).toEqual([1, 2, 3]);
  });
  it('computes RMS', () => {
    expect(rms(new Float32Array([0.5, -0.5]))).toBeCloseTo(0.5);
    expect(rms(new Float32Array())).toBe(0);
  });
});
