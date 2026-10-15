import type { EngineKind } from '../data/schema';

export type EngineState =
  'idle' | 'loading' | 'listening' | 'hearing' | 'thinking' | 'paused' | 'error';

/** Why an engine stopped working. The quiz falls back to typing on any of these. */
export type EngineError =
  'mic-blocked' | 'no-mic' | 'network' | 'unsupported' | 'model-failed' | 'unknown';

export type EngineEvent =
  | { type: 'state'; state: EngineState; detail?: EngineError | string }
  /** Input level 0–1, about 60 Hz (engines with access to raw audio only). */
  | { type: 'level'; rms: number }
  /** performance.now() when speech began. */
  | { type: 'onset'; at: number }
  | {
      type: 'transcript';
      text: string;
      alts: string[];
      final: boolean;
      at: number;
      /**
       * For interim results from audio that's still being captured: whether the speaker
       * had paused at the end of it. Engines that can't tell leave it undefined.
       */
      settled?: boolean;
    };

export interface SpeechEngine {
  readonly kind: Exclude<EngineKind, 'typed'>;
  /** Permissions, model load. Rejects with an EngineFailure. */
  prepare(onProgress?: (pct: number) => void): Promise<void>;
  /** Start listening, or clear what was heard, for a new problem. */
  listenFresh(): void;
  /** Stop listening, e.g. while TTS speaks or during feedback. */
  pause(): void;
  dispose(): void;
  on(cb: (e: EngineEvent) => void): () => void;
}

export class EngineFailure extends Error {
  constructor(
    readonly reason: EngineError,
    message: string = reason,
  ) {
    super(message);
    this.name = 'EngineFailure';
  }
}

export function failureReason(err: unknown): EngineError {
  if (err instanceof EngineFailure) return err.reason;
  if (err instanceof DOMException) {
    if (err.name === 'NotAllowedError' || err.name === 'SecurityError') return 'mic-blocked';
    if (err.name === 'NotFoundError' || err.name === 'OverconstrainedError') return 'no-mic';
  }
  return 'unknown';
}

/** Minimal listener set shared by the engines. */
export class Emitter {
  private listeners = new Set<(e: EngineEvent) => void>();

  on(cb: (e: EngineEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  protected emit(e: EngineEvent) {
    for (const cb of this.listeners) cb(e);
  }

  protected clearListeners() {
    this.listeners.clear();
  }
}
