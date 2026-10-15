import { Emitter, EngineFailure, type EngineError, type SpeechEngine } from './engine';
import { speechRecognitionCtor } from './support';

/** Chrome ends recognition after silence; restart, but give up if it keeps dying at once. */
const RESTART_DELAY_MS = 100;
const MAX_QUICK_RESTARTS = 5;
const QUICK_MS = 1000;

const ERRORS: Record<string, EngineError> = {
  'not-allowed': 'mic-blocked',
  'service-not-allowed': 'mic-blocked',
  network: 'network',
  'audio-capture': 'no-mic',
  'language-not-supported': 'unsupported',
};

/**
 * Web Speech API engine. Note: in Chrome and Safari, audio may be sent to the browser
 * vendor's servers for recognition; the setup screen says so.
 */
export class WebSpeechEngine extends Emitter implements SpeechEngine {
  readonly kind = 'web-speech' as const;
  private rec: SpeechRecognition | null = null;
  private wanted = false;
  private heardThisTurn = false;
  private quickRestarts = 0;
  private startedAt = 0;
  private restartTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private lang = 'en-US') {
    super();
  }

  async prepare() {
    if (!speechRecognitionCtor()) throw new EngineFailure('unsupported');
    // Ask for the mic up front so the permission prompt doesn't land mid-problem. Web
    // Speech has no permission API of its own, and Firefox lacks it entirely anyway.
    if (navigator.mediaDevices?.getUserMedia) {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
    }
  }

  listenFresh() {
    this.wanted = true;
    this.heardThisTurn = false;
    this.quickRestarts = 0;
    this.kill();
    this.begin();
  }

  pause() {
    this.wanted = false;
    this.kill();
    this.emit({ type: 'state', state: 'paused' });
  }

  dispose() {
    this.wanted = false;
    this.kill();
    this.clearListeners();
  }

  private begin() {
    const Ctor = speechRecognitionCtor()!;
    const r = new Ctor();
    this.rec = r;
    r.lang = this.lang;
    r.continuous = true;
    r.interimResults = true;
    r.maxAlternatives = 3;
    this.startedAt = performance.now();

    // Every handler checks `r === this.rec` so events from an aborted instance are ignored.
    r.onstart = () => {
      if (r === this.rec) this.emit({ type: 'state', state: 'listening' });
    };
    r.onspeechstart = (e) => {
      if (r !== this.rec) return;
      this.markOnset(e.timeStamp);
    };
    r.onresult = (e) => {
      if (r !== this.rec) return;
      this.markOnset(e.timeStamp);
      let text = '';
      let final = true;
      for (let i = 0; i < e.results.length; i++) {
        const res = e.results[i]!;
        text += res[0]!.transcript + ' ';
        if (!res.isFinal) final = false;
      }
      const last = e.results[e.results.length - 1]!;
      const alts: string[] = [];
      for (let j = 1; j < last.length; j++) alts.push(last[j]!.transcript);
      this.emit({ type: 'transcript', text: text.trim(), alts, final, at: performance.now() });
    };
    r.onerror = (e) => {
      if (r !== this.rec) return;
      const reason = ERRORS[e.error];
      if (!reason) return; // 'no-speech', 'aborted': harmless, onend restarts
      this.wanted = false;
      this.emit({ type: 'state', state: 'error', detail: reason });
    };
    r.onend = () => {
      if (r !== this.rec) return;
      this.rec = null;
      if (!this.wanted) return;
      this.quickRestarts =
        performance.now() - this.startedAt < QUICK_MS ? this.quickRestarts + 1 : 0;
      if (this.quickRestarts > MAX_QUICK_RESTARTS) {
        this.wanted = false;
        this.emit({ type: 'state', state: 'error', detail: 'unknown' });
        return;
      }
      this.restartTimer = setTimeout(() => {
        if (this.wanted && !this.rec) this.begin();
      }, RESTART_DELAY_MS);
    };

    try {
      r.start();
    } catch {
      this.rec = null;
    }
  }

  private markOnset(timeStamp: number) {
    if (this.heardThisTurn) return;
    this.heardThisTurn = true;
    // Event timestamps share performance.now()'s clock; fall back if one is missing.
    const at = timeStamp > 0 && timeStamp <= performance.now() ? timeStamp : performance.now();
    this.emit({ type: 'onset', at });
    this.emit({ type: 'state', state: 'hearing' });
  }

  private kill() {
    clearTimeout(this.restartTimer);
    const r = this.rec;
    this.rec = null;
    if (r) {
      try {
        r.abort();
      } catch {
        // already stopped
      }
    }
  }
}
