import { describe, expect, it } from 'vitest';
import { EnergyVad, type VadEvent } from './vad';

const RATE = 16000;
const FRAME = 320; // 20 ms
const FRAME_MS = 20;

function frame(amplitude: number, seed = 1): Float32Array {
  let s = seed;
  return Float32Array.from({ length: FRAME }, () => {
    s = (s * 16807) % 2147483647;
    return amplitude * ((s / 2147483647) * 2 - 1) * Math.SQRT2 * Math.sqrt(1.5);
  });
}

/** Feed a script of [amplitude, durationMs] segments; collect events with their frame times. */
function run(vad: EnergyVad, script: [number, number][]) {
  const events: (VadEvent & { frameAt: number })[] = [];
  let t = 0;
  for (const [amp, ms] of script) {
    for (let i = 0; i < ms / FRAME_MS; i++) {
      for (const e of vad.push(frame(amp, t + 7), t)) events.push({ ...e, frameAt: t });
      t += FRAME_MS;
    }
  }
  return events;
}

describe('EnergyVad', () => {
  it('reports onset at the first voiced frame, then the utterance after trailing silence', () => {
    const vad = new EnergyVad(RATE);
    const events = run(vad, [
      [0.002, 1000],
      [0.1, 600],
      [0.002, 700],
    ]);
    const onset = events.find((e) => e.type === 'onset')!;
    expect(onset.at).toBe(1000); // first voiced frame, not when we were sure
    expect(onset.frameAt).toBeGreaterThan(1000);
    const utt = events.find((e) => e.type === 'utterance')!;
    expect(utt.type === 'utterance' && utt.startedAt).toBe(1000);
    // ends ~550 ms into the silence
    expect(utt.frameAt).toBeGreaterThanOrEqual(1600 + 540);
    expect(utt.frameAt).toBeLessThan(1600 + 600);
    // pre-roll (≈300 ms) + speech + silence
    const samples = utt.type === 'utterance' ? utt.audio.reduce((n, a) => n + a.length, 0) : 0;
    expect(samples / RATE).toBeGreaterThan(1.4);
    expect(samples / RATE).toBeLessThan(1.6);
  });

  it('discards a short click instead of reporting speech', () => {
    const vad = new EnergyVad(RATE);
    const events = run(vad, [
      [0.002, 500],
      [0.2, 40],
      [0.002, 800],
    ]);
    expect(events.map((e) => e.type)).toEqual(['discard']);
  });

  it('cuts off long utterances at 5 s', () => {
    const vad = new EnergyVad(RATE);
    const events = run(vad, [
      [0.002, 400],
      [0.1, 7000],
    ]);
    const utt = events.find((e) => e.type === 'utterance')!;
    expect(utt.frameAt).toBeLessThanOrEqual(400 + 5000);
  });

  it('calibrates to the room at start', () => {
    const vad = new EnergyVad(RATE);
    expect(run(vad, [[0.02, 2000]])).toEqual([]);
    expect(vad.noiseFloor).toBeGreaterThan(0.015);
  });

  it('re-learns the floor when the room gets noisy mid-session', () => {
    const vad = new EnergyVad(RATE);
    run(vad, [[0.002, 1000]]);
    run(vad, [[0.02, 6000]]);
    expect(vad.noiseFloor).toBeGreaterThan(0.015);
    // Speech at the noise level of a quiet room no longer triggers.
    expect(run(vad, [[0.03, 600]]).filter((e) => e.type === 'onset')).toHaveLength(0);
    // Clearly louder speech still does.
    expect(
      run(vad, [
        [0.2, 600],
        [0.02, 700],
      ]).some((e) => e.type === 'utterance'),
    ).toBe(true);
  });

  it('reset drops an utterance in progress', () => {
    const vad = new EnergyVad(RATE);
    run(vad, [
      [0.002, 500],
      [0.1, 300],
    ]);
    vad.reset();
    expect(run(vad, [[0.002, 800]])).toEqual([]);
  });
});
