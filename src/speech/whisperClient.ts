import type {
  AdapterInfo,
  FromWorker,
  LoadOptions,
  ToWorker,
  WhisperDevice,
} from './whisperProtocol';

/**
 * App-wide handle on the Whisper worker. The model loads once and stays loaded across
 * sessions; engines come and go around it.
 */
export class WhisperClient {
  private worker: Worker | null = null;
  private loading: Promise<void> | null = null;
  private files = new Map<string, { loaded: number; total: number }>();
  private progressListeners = new Set<(pct: number) => void>();
  private pending = new Map<number, (r: { text: string; ms: number }) => void>();
  private nextId = 1;
  device: WhisperDevice | null = null;
  adapter: AdapterInfo | null = null;
  loadMs: number | null = null;
  /** Rolling inference times (ms), for diagnostics. */
  readonly inferMs: number[] = [];

  get ready() {
    return this.device !== null;
  }

  /** Load the model; resolves when warmed up. Safe to call repeatedly. */
  load(onProgress?: (pct: number) => void, options: LoadOptions = {}): Promise<void> {
    if (onProgress) {
      this.progressListeners.add(onProgress);
      if (this.ready) onProgress(100);
    }
    if (this.loading) return this.loading;

    this.loading = new Promise<void>((resolve, reject) => {
      let worker: Worker;
      try {
        worker = new Worker(new URL('./whisper.worker.ts', import.meta.url), { type: 'module' });
      } catch (err) {
        reject(err);
        return;
      }
      this.worker = worker;
      worker.onerror = (e) => reject(new Error(e.message || 'Speech worker failed to start'));
      worker.onmessage = (e: MessageEvent<FromWorker>) => {
        const m = e.data;
        switch (m.type) {
          case 'progress':
            if (m.total > 0) {
              this.files.set(m.file, { loaded: m.loaded, total: m.total });
              this.reportProgress();
            }
            break;
          case 'ready':
            this.device = m.device;
            this.adapter = m.adapter;
            this.loadMs = m.loadMs;
            this.progressListeners.forEach((cb) => cb(100));
            resolve();
            break;
          case 'error':
            reject(new Error(m.message));
            break;
          case 'result': {
            const cb = this.pending.get(m.id);
            this.pending.delete(m.id);
            if (!m.error) {
              this.inferMs.push(m.ms);
              if (this.inferMs.length > 50) this.inferMs.shift();
            }
            cb?.({ text: m.error ? '' : m.text, ms: m.ms });
            break;
          }
        }
      };
      this.post({ type: 'load', ...options });
    }).catch((err: unknown) => {
      // Allow a retry after a failed load.
      this.worker?.terminate();
      this.worker = null;
      this.loading = null;
      throw err;
    });
    return this.loading;
  }

  /** Stop the worker (and free the model). */
  terminate() {
    this.worker?.terminate();
    this.worker = null;
    this.loading = null;
    this.device = null;
  }

  offProgress(cb: (pct: number) => void) {
    this.progressListeners.delete(cb);
  }

  /** Transcribe 16 kHz mono audio. The buffer is transferred, so don't reuse it. */
  transcribe(audio: Float32Array): Promise<{ text: string; ms: number }> {
    if (!this.worker || !this.ready) return Promise.reject(new Error('Whisper not loaded'));
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.post({ type: 'run', id, audio }, [audio.buffer]);
    });
  }

  private post(m: ToWorker, transfer: Transferable[] = []) {
    this.worker!.postMessage(m, transfer);
  }

  /** Aggregate download progress across every file seen so far, capped at 99 until ready. */
  private reportProgress() {
    let loaded = 0;
    let total = 0;
    for (const f of this.files.values()) {
      loaded += f.loaded;
      total += f.total;
    }
    const pct = Math.min(99, Math.round((loaded / total) * 100));
    this.progressListeners.forEach((cb) => cb(pct));
  }
}

export const whisper = new WhisperClient();
