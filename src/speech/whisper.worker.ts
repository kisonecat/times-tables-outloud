/// <reference lib="webworker" />
import {
  env,
  pipeline,
  type AutomaticSpeechRecognitionPipeline,
  type ProgressInfo,
} from '@huggingface/transformers';
// Self-host the ONNX runtime instead of letting transformers.js fetch it from a CDN.
import ortWasmUrl from '../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.wasm?url';
import {
  WHISPER_MODEL,
  type AdapterInfo,
  type FromWorker,
  type LoadOptions,
  type ToWorker,
  type WhisperDevice,
} from './whisperProtocol';

declare const self: DedicatedWorkerGlobalScope;

env.allowLocalModels = false;
env.useBrowserCache = true; // model files live in Cache Storage after the first download
const onnx = env.backends.onnx as { wasm?: { wasmPaths?: unknown; proxy?: boolean } };
if (onnx.wasm) {
  onnx.wasm.wasmPaths = { wasm: new URL(ortWasmUrl, self.location.href).href };
  onnx.wasm.proxy = false;
}

const post = (m: FromWorker) => self.postMessage(m);
const MULTILINGUAL_OPTIONS = { language: 'english', task: 'transcribe' } as const;
/** English-only (".en") models take no language/task options. */
let OPTIONS: Record<string, string> = MULTILINGUAL_OPTIONS;

let asr: AutomaticSpeechRecognitionPipeline | null = null;
let loading: Promise<void> | null = null;

type GpuAdapter = {
  info?: Partial<AdapterInfo> & { isFallbackAdapter?: boolean };
  isFallbackAdapter?: boolean;
};

/** The GPU WebGPU would run on, if any. Software adapters are reported as such. */
async function findAdapter(): Promise<AdapterInfo | null> {
  try {
    const gpu = (
      navigator as unknown as {
        gpu?: { requestAdapter(o?: object): Promise<GpuAdapter | null> };
      }
    ).gpu;
    const adapter = await gpu?.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) return null;
    const info = adapter.info ?? {};
    return {
      vendor: info.vendor ?? '',
      architecture: info.architecture ?? '',
      description: info.description ?? '',
      fallback: !!(info.isFallbackAdapter ?? adapter.isFallbackAdapter),
    };
  } catch {
    return null;
  }
}

async function load(opts: LoadOptions) {
  const t0 = performance.now();
  const adapter = await findAdapter();
  // A software GPU (e.g. SwiftShader) emulates the GPU on the CPU and is slower than
  // WASM, so only a real one counts.
  const device: WhisperDevice =
    opts.device && opts.device !== 'auto'
      ? opts.device
      : adapter && !adapter.fallback
        ? 'webgpu'
        : 'wasm';
  OPTIONS = (opts.model ?? WHISPER_MODEL).endsWith('.en') ? {} : MULTILINGUAL_OPTIONS;
  const dtype =
    opts.dtype ??
    (device === 'webgpu'
      ? ({ encoder_model: 'fp32', decoder_model_merged: 'q4' } as const)
      : ({ encoder_model: 'q8', decoder_model_merged: 'q8' } as const));
  // pipeline()'s overloads are too large for TS to resolve here; pin the one we use.
  const asrPipeline = pipeline as (
    task: 'automatic-speech-recognition',
    model: string,
    opts: Record<string, unknown>,
  ) => Promise<AutomaticSpeechRecognitionPipeline>;
  asr = await asrPipeline('automatic-speech-recognition', opts.model ?? WHISPER_MODEL, {
    device,
    dtype,
    progress_callback: (p: ProgressInfo) => {
      if (p.status === 'progress')
        post({ type: 'progress', file: p.file, loaded: p.loaded, total: p.total });
    },
  });
  // Warm-up: the first inference compiles shaders / allocates, so do it before the learner waits on it.
  await asr(new Float32Array(16000), OPTIONS);
  post({ type: 'ready', device, loadMs: Math.round(performance.now() - t0), adapter });
}

self.onmessage = async (e: MessageEvent<ToWorker>) => {
  const m = e.data;
  if (m.type === 'load') {
    loading ??= load(m).catch((err: unknown) => {
      loading = null;
      post({ type: 'error', message: String((err as Error)?.message ?? err) });
    });
    return;
  }
  const t0 = performance.now();
  try {
    if (!asr) throw new Error('Model not loaded');
    const out = await asr(m.audio, OPTIONS);
    const text = Array.isArray(out) ? out.map((o) => o.text).join(' ') : out.text;
    post({ type: 'result', id: m.id, text: text.trim(), ms: Math.round(performance.now() - t0) });
  } catch (err) {
    post({ type: 'result', id: m.id, text: '', ms: 0, error: String(err) });
  }
};
