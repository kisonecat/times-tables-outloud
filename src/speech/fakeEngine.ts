import type { EngineKind } from '../data/schema';
import { Emitter, type EngineEvent, type SpeechEngine } from './engine';

/**
 * Scriptable engine for tests and development. Never included in production builds:
 * createEngine only reaches it behind import.meta.env.DEV.
 */
export class FakeEngine extends Emitter implements SpeechEngine {
  listening = false;
  log: string[] = [];

  constructor(readonly kind: Exclude<EngineKind, 'typed'> = 'web-speech') {
    super();
  }

  /** Registers itself as the page's test hook; only an engine that's actually used gets here. */
  async prepare() {
    window.__ttFakeSpeech = this;
  }

  listenFresh() {
    this.listening = true;
    this.log.push('listenFresh');
    this.emit({ type: 'state', state: 'listening' });
  }

  pause() {
    this.listening = false;
    this.log.push('pause');
    this.emit({ type: 'state', state: 'paused' });
  }

  dispose() {
    this.listening = false;
    this.clearListeners();
  }

  /** Speech onset, then a transcript `delayMs` later (interim first if `interim` is given). */
  async say(text: string, opts: { delayMs?: number; interim?: string } = {}) {
    this.fire({ type: 'onset', at: performance.now() });
    this.fire({ type: 'state', state: 'hearing' });
    await new Promise((r) => setTimeout(r, opts.delayMs ?? 50));
    if (opts.interim) {
      this.fire({
        type: 'transcript',
        text: opts.interim,
        alts: [],
        final: false,
        at: performance.now(),
      });
    }
    this.fire({ type: 'transcript', text, alts: [], final: true, at: performance.now() });
  }

  fire(e: EngineEvent) {
    if (this.listening || e.type === 'state') this.emit(e);
  }
}

declare global {
  interface Window {
    /** Dev/test hook: when set to true before a quiz starts, the quiz uses a FakeEngine. */
    __ttFakeSpeech?: boolean | FakeEngine;
    /** Dev/test hook: force Whisper's streaming interim results on or off. */
    __ttWhisperStreaming?: 'auto' | 'on' | 'off';
  }
}
