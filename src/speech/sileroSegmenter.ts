import { MicVAD } from '@ricky0123/vad-web';
import { concat, rms } from './resample';
import type { PartialSpeech, Segmenter, SegmenterEvents } from './segmenter';

/** Where the Vite plugin in vite.config.ts serves vad-web's assets (self-hosted, no CDN). */
const ASSETS = `${import.meta.env.BASE_URL}vad/`;
const MODEL = 'v5';
const FRAME_MS = 32; // Silero v5: 512 samples at 16 kHz
const PRE_ROLL_FRAMES = Math.round(300 / FRAME_MS);
const POSITIVE = 0.5;
const NEGATIVE = 0.35;

/**
 * Silero VAD (via @ricky0123/vad-web): a small neural speech detector, far better than an
 * energy threshold at telling a voice from a fan, a TV or a chair scraping.
 * Settings follow PLAN §5: 300 ms pre-roll, end after 550 ms of silence.
 */
export class SileroSegmenter implements Segmenter {
  readonly kind = 'silero' as const;
  private vad: MicVAD | null = null;
  /** performance.now() of the first frame of the speech in progress. */
  private speechStart = 0;
  /** Our own copy of the audio, so it can be transcribed before the utterance ends. */
  private recent: Float32Array[] = [];
  private speech: Float32Array[] | null = null;
  lastVoiceAt = 0;

  async start(ctx: AudioContext, stream: MediaStream, events: SegmenterEvents) {
    this.vad = await MicVAD.new({
      model: MODEL,
      baseAssetPath: ASSETS,
      onnxWASMBasePath: ASSETS,
      audioContext: ctx,
      getStream: async () => stream,
      pauseStream: async () => {},
      resumeStream: async () => stream,
      positiveSpeechThreshold: POSITIVE,
      negativeSpeechThreshold: NEGATIVE,
      preSpeechPadMs: 300,
      redemptionMs: 550,
      minSpeechMs: 150,
      submitUserSpeechOnPause: false,
      startOnLoad: true,
      onFrameProcessed: (p, frame) => {
        events.level(Math.min(1, rms(frame) * 12));
        const copy = frame.slice();
        if (this.speech) this.speech.push(copy);
        else {
          this.recent.push(copy);
          if (this.recent.length > PRE_ROLL_FRAMES) this.recent.shift();
        }
        if (p.isSpeech >= POSITIVE) this.lastVoiceAt = performance.now();
      },
      // The callback lands just after the frame that crossed the threshold is processed,
      // so that frame began about one frame ago: report onset from there, not now.
      onSpeechStart: () => {
        this.speechStart = performance.now() - FRAME_MS;
        this.lastVoiceAt = performance.now();
        this.speech = this.recent;
        this.recent = [];
      },
      onSpeechRealStart: () => events.onset(this.speechStart),
      onVADMisfire: () => {
        this.speech = null;
        events.misfire();
      },
      onSpeechEnd: (audio) => {
        this.speech = null;
        events.utterance(audio);
      },
    });
  }

  partial(): PartialSpeech | null {
    if (!this.speech) return null;
    return { audio16k: concat(this.speech), quietMs: performance.now() - this.lastVoiceAt };
  }

  reset() {
    this.speech = null;
    // Pausing drops the segment in progress; starting again resumes from silence.
    const vad = this.vad;
    if (!vad) return;
    void vad.pause().then(() => vad.start());
  }

  dispose() {
    void this.vad?.destroy();
    this.vad = null;
  }
}
