import { Emitter, EngineFailure, failureReason, type SpeechEngine } from './engine';
import { parseNumbers } from './parseNumbers';
import { EnergySegmenter, type Segmenter } from './segmenter';
import { whisper } from './whisperClient';

/** Only transcribe early once there's at least this much speech past the pre-roll. */
const MIN_PARTIAL_MS = 250;
const PRE_ROLL_MS = 300;
/** A pause this long counts as "settled": a right answer can be accepted right away. */
export const SETTLE_MS = 150;

/**
 * On-device recognition: mic → voice activity detection (Silero, or an energy detector if
 * Silero can't load) → 16 kHz utterance → Whisper in a worker. Audio never leaves the
 * device.
 *
 * Streaming: when Whisper runs on a real GPU (a few hundred ms per pass), the speech so
 * far is transcribed as soon as the learner pauses, before the end-of-speech wait is
 * over. A right answer is accepted from that pass; anything else shows in the slot while
 * the final pass decides. On the CPU a pass takes seconds, so it waits for the end of the
 * utterance as before.
 */
export class WhisperEngine extends Emitter implements SpeechEngine {
  readonly kind = 'whisper' as const;
  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private segmenter: Segmenter | null = null;
  private listening = false;
  /** Bumped on every listenFresh/pause so late results from an old problem are dropped. */
  private generation = 0;
  private inFlight = 0;
  private disposed = false;

  constructor(private options: { streaming?: 'auto' | 'on' | 'off' } = {}) {
    super();
  }

  /** Whether interim results are transcribed while the learner is still talking. */
  get streaming() {
    const mode = this.options.streaming ?? 'auto';
    return mode === 'on' || (mode === 'auto' && whisper.device === 'webgpu');
  }

  /** Which voice detector is running, for diagnostics. */
  get vadKind() {
    return this.segmenter?.kind ?? null;
  }

  async prepare(onProgress?: (pct: number) => void) {
    const model = whisper.load(onProgress).catch((err: unknown) => {
      throw new EngineFailure('model-failed', String((err as Error)?.message ?? err));
    });
    try {
      await this.openMic();
    } catch (err) {
      model.catch(() => {}); // keep loading in the background for next time
      throw err instanceof EngineFailure ? err : new EngineFailure(failureReason(err), String(err));
    }
    await model;
    if (onProgress) whisper.offProgress(onProgress);
  }

  listenFresh() {
    this.generation++;
    this.segmenter?.reset();
    this.listening = true;
    void this.ctx?.resume();
    this.emit({ type: 'state', state: this.inFlight ? 'thinking' : 'listening' });
  }

  pause() {
    this.generation++;
    this.segmenter?.reset();
    this.listening = false;
    this.emit({ type: 'state', state: 'paused' });
  }

  dispose() {
    this.disposed = true;
    this.listening = false;
    this.generation++;
    this.segmenter?.dispose();
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close().catch(() => {});
    this.stream = this.ctx = this.segmenter = null;
    this.clearListeners();
  }

  private async openMic() {
    if (!navigator.mediaDevices?.getUserMedia) throw new EngineFailure('unsupported');
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    if (this.disposed) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    const ctx = new AudioContext();
    this.stream = stream;
    this.ctx = ctx;
    if (ctx.state === 'suspended') await ctx.resume();

    // The detector keeps running between problems so it keeps tracking the room; its
    // events only count while we're listening.
    const events = {
      level: (rms: number) => this.emit({ type: 'level', rms }),
      onset: (at: number) => {
        if (!this.listening) return;
        this.emit({ type: 'onset', at });
        this.emit({ type: 'state', state: 'hearing' });
        if (this.streaming) void this.streamPartials(this.generation);
      },
      utterance: (audio: Float32Array) => {
        if (this.listening) this.transcribe(audio);
      },
      misfire: () => {
        if (this.listening) this.emit({ type: 'state', state: 'listening' });
      },
    };
    try {
      const { SileroSegmenter } = await import('./sileroSegmenter');
      const silero = new SileroSegmenter();
      await silero.start(ctx, stream, events);
      this.segmenter = silero;
    } catch (err) {
      console.warn('Silero VAD unavailable; using the energy detector.', err);
      const energy = new EnergySegmenter();
      await energy.start(ctx, stream, events);
      this.segmenter = energy;
    }
  }

  /**
   * While an utterance is in progress, transcribe it whenever the learner pauses. A pass
   * starts as soon as they've been quiet for SETTLE_MS (rather than running passes back
   * to back), so the pass that hears the whole answer never waits behind one that started
   * mid-word. If they start talking again, the next pause gets a fresh pass.
   */
  private async streamPartials(gen: number) {
    const minSamples = ((PRE_ROLL_MS + MIN_PARTIAL_MS) / 1000) * 16000;
    let transcribedUpTo = 0; // lastVoiceAt covered by the latest pass
    while (gen === this.generation && this.listening) {
      const partial = this.segmenter?.partial();
      if (!partial) return; // the utterance ended (the final pass takes over) or misfired
      const lastVoice = this.segmenter!.lastVoiceAt;
      const paused = partial.quietMs >= SETTLE_MS;
      if (!paused || lastVoice <= transcribedUpTo || partial.audio16k.length < minSamples) {
        await sleep(15);
        continue;
      }
      transcribedUpTo = lastVoice;
      const { text } = await whisper.transcribe(partial.audio16k).catch(() => ({ text: '' }));
      if (gen !== this.generation || !this.listening) return;
      // Settled if nothing was said after this audio was captured: it holds the whole answer.
      const settled = (this.segmenter?.lastVoiceAt ?? 0) <= transcribedUpTo;
      if (parseNumbers(text).length > 0) {
        this.emit({
          type: 'transcript',
          text,
          alts: [],
          final: false,
          settled,
          at: performance.now(),
        });
      }
    }
  }

  private transcribe(audio: Float32Array) {
    const gen = this.generation;
    this.inFlight++;
    this.emit({ type: 'state', state: 'thinking' });
    whisper
      .transcribe(audio)
      .then(({ text }) => {
        if (gen !== this.generation || !this.listening) return;
        // Whisper invents "Thank you." and the like on noise: only numbers count.
        if (parseNumbers(text).length > 0) {
          this.emit({ type: 'transcript', text, alts: [], final: true, at: performance.now() });
          return true;
        }
        return false;
      })
      .catch(() => false)
      .then((usable) => {
        this.inFlight--;
        if (gen !== this.generation || !this.listening) return;
        this.emit(
          this.inFlight
            ? { type: 'state', state: 'thinking' }
            : // Heard speech but no number: say so, so the learner knows to repeat it.
              { type: 'state', state: 'listening', detail: usable ? undefined : 'unclear' },
        );
      });
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
