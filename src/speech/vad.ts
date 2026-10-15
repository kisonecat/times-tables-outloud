import { rms } from './resample';

export interface VadOptions {
  /** Speech starts when RMS exceeds noiseFloor × onsetFactor … */
  onsetFactor: number;
  /** … but never below this absolute level. */
  minThreshold: number;
  /** Audio kept from before the onset so the first syllable isn't clipped. */
  preRollMs: number;
  /** Utterance ends after this much continuous silence. */
  endSilenceMs: number;
  /** Utterances are cut off at this length. */
  maxUtteranceMs: number;
  /** Voiced audio needed before we believe it's speech (rejects clicks and bumps). */
  minSpeechMs: number;
  initialNoise: number;
  /** The first audio after start is used to measure the room, not to detect speech. */
  calibrateMs: number;
}

export const DEFAULT_VAD: VadOptions = {
  onsetFactor: 3.5,
  minThreshold: 0.012,
  preRollMs: 300,
  endSilenceMs: 550,
  maxUtteranceMs: 5000,
  minSpeechMs: 120,
  initialNoise: 0.004,
  calibrateMs: 300,
};

export type VadEvent =
  /** Confirmed speech. `at` is the start time of the first voiced frame. */
  | { type: 'onset'; at: number }
  /** An utterance finished: all its audio, pre-roll included. */
  | { type: 'utterance'; audio: Float32Array[]; startedAt: number }
  /** Something loud that turned out not to be speech. */
  | { type: 'discard' };

/**
 * Energy-based voice activity detector with an adaptive noise floor. Feed it frames in
 * order with each frame's start time (ms, any clock); it returns events as they happen.
 */
export class EnergyVad {
  private opts: VadOptions;
  private noise: number;
  private pre: { frame: Float32Array; at: number }[] = [];
  private buf: Float32Array[] = [];
  private speaking = false;
  private confirmed = false;
  private firstVoicedAt = 0;
  private voicedMs = 0;
  private silenceMs = 0;
  private totalMs = 0;
  private levels: number[] = [];
  private calibratedMs = 0;
  private calibration: number[] = [];

  constructor(
    private sampleRate: number,
    opts: Partial<VadOptions> = {},
  ) {
    this.opts = { ...DEFAULT_VAD, ...opts };
    this.noise = this.opts.initialNoise;
  }

  get noiseFloor() {
    return this.noise;
  }

  get threshold() {
    return Math.max(this.opts.minThreshold, this.noise * this.opts.onsetFactor);
  }

  /** The utterance in progress (pre-roll included) and how long it's been quiet, or null. */
  inProgress(): { audio: Float32Array[]; quietMs: number } | null {
    return this.speaking && this.confirmed ? { audio: this.buf, quietMs: this.silenceMs } : null;
  }

  /** Drop any utterance in progress; the noise estimate is kept. */
  reset() {
    this.speaking = false;
    this.confirmed = false;
    this.pre = [];
    this.buf = [];
  }

  push(frame: Float32Array, at: number): VadEvent[] {
    const level = rms(frame);
    const ms = (frame.length / this.sampleRate) * 1000;
    const loud = level > this.threshold;
    const events: VadEvent[] = [];

    if (this.calibratedMs < this.opts.calibrateMs) {
      this.calibratedMs += ms;
      this.calibration.push(level);
      if (this.calibratedMs >= this.opts.calibrateMs)
        this.noise = percentile(this.calibration, 0.2);
      return events;
    }

    if (!this.speaking) {
      if (!loud) this.noise = this.noise * 0.95 + level * 0.05;
      this.pre.push({ frame, at });
      while (this.pre.length > 1 && (this.pre.length - 1) * ms > this.opts.preRollMs)
        this.pre.shift();
      if (loud) {
        this.speaking = true;
        this.confirmed = false;
        this.firstVoicedAt = at;
        this.buf = this.pre.map((p) => p.frame);
        this.pre = [];
        this.voicedMs = ms;
        this.silenceMs = 0;
        this.totalMs = this.buf.length * ms;
        this.levels = [level];
      }
      return events;
    }

    this.buf.push(frame);
    this.totalMs += ms;
    this.levels.push(level);
    if (loud) {
      this.voicedMs += ms;
      this.silenceMs = 0;
    } else {
      this.silenceMs += ms;
    }

    if (!this.confirmed && this.voicedMs >= this.opts.minSpeechMs) {
      this.confirmed = true;
      events.push({ type: 'onset', at: this.firstVoicedAt });
    }

    const hitMax = this.totalMs >= this.opts.maxUtteranceMs;
    if (this.silenceMs >= this.opts.endSilenceMs || hitMax) {
      // Five seconds without a pause is more likely a noisy room than speech: re-learn
      // the floor from the quieter part of what we heard.
      if (hitMax) this.noise = Math.max(this.noise, percentile(this.levels, 0.2));
      events.push(
        this.confirmed
          ? { type: 'utterance', audio: this.buf, startedAt: this.firstVoicedAt }
          : { type: 'discard' },
      );
      this.reset();
    }
    return events;
  }
}

function percentile(xs: readonly number[], q: number): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? 0;
}
