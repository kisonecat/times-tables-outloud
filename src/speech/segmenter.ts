import { concat, resample, rms } from './resample';
import { EnergyVad } from './vad';
import captureWorkletUrl from './capture.worklet.js?url';

/**
 * Turns a live mic stream into utterances for Whisper: level for the meter, onset (the
 * time speech actually began, on the performance.now() clock) and 16 kHz mono audio once
 * the speaker stops.
 */
export interface SegmenterEvents {
  level(rms: number): void;
  onset(at: number): void;
  utterance(audio16k: Float32Array): void;
  /** Something loud that wasn't speech. */
  misfire(): void;
}

/** Speech captured so far in an utterance that hasn't ended yet. */
export interface PartialSpeech {
  /** 16 kHz mono, pre-roll included. */
  audio16k: Float32Array;
  /** How long the speaker has been quiet at the end of it. */
  quietMs: number;
}

export interface Segmenter {
  readonly kind: 'silero' | 'energy';
  start(ctx: AudioContext, stream: MediaStream, events: SegmenterEvents): Promise<void>;
  /** The utterance in progress, for transcribing while the learner is still talking. */
  partial(): PartialSpeech | null;
  /** performance.now() of the most recent frame that sounded like speech. */
  readonly lastVoiceAt: number;
  /** Drop any utterance in progress (new problem, or paused). */
  reset(): void;
  dispose(): void;
}

/** The original energy VAD, running on our own AudioWorklet. The fallback. */
export class EnergySegmenter implements Segmenter {
  readonly kind = 'energy' as const;
  private node: AudioWorkletNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private vad: EnergyVad | null = null;
  private rate = 48000;
  lastVoiceAt = 0;

  async start(ctx: AudioContext, stream: MediaStream, events: SegmenterEvents) {
    await ctx.audioWorklet.addModule(captureWorkletUrl);
    const source = ctx.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(ctx, 'tt-capture', { numberOfInputs: 1, numberOfOutputs: 0 });
    source.connect(node);
    const vad = new EnergyVad(ctx.sampleRate);
    node.port.onmessage = (e: MessageEvent<{ frame: Float32Array; time: number }>) => {
      const { frame, time } = e.data;
      events.level(Math.min(1, rms(frame) * 12));
      const out = vad.push(frame, contextToPerf(ctx, time));
      const progress = vad.inProgress();
      if (progress) this.lastVoiceAt = performance.now() - progress.quietMs;
      for (const ev of out) {
        if (ev.type === 'onset') events.onset(ev.at);
        else if (ev.type === 'utterance')
          events.utterance(resample(concat(ev.audio), ctx.sampleRate));
        else events.misfire();
      }
    };
    this.node = node;
    this.source = source;
    this.vad = vad;
    this.rate = ctx.sampleRate;
  }

  partial(): PartialSpeech | null {
    const p = this.vad?.inProgress();
    return p ? { audio16k: resample(concat(p.audio), this.rate), quietMs: p.quietMs } : null;
  }

  reset() {
    this.vad?.reset();
  }

  dispose() {
    this.node?.port.close();
    this.node?.disconnect();
    this.source?.disconnect();
    this.node = this.source = this.vad = null;
  }
}

/** AudioContext time → performance.now() time. */
export function contextToPerf(ctx: AudioContext, contextTime: number): number {
  const ts = ctx.getOutputTimestamp?.();
  if (ts?.contextTime !== undefined && ts.performanceTime !== undefined) {
    return ts.performanceTime + (contextTime - ts.contextTime) * 1000;
  }
  return performance.now() - (ctx.currentTime - contextTime) * 1000;
}
