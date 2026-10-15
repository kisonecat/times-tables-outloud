/** Messages between the app and whisper.worker.ts. */

export type WhisperDevice = 'webgpu' | 'wasm';

type Precision = 'fp32' | 'fp16' | 'q8' | 'q4' | 'q4f16';

/** Overrides for benchmarking; the app uses the defaults. */
export interface LoadOptions {
  device?: WhisperDevice | 'auto';
  model?: string;
  dtype?: { encoder_model: Precision; decoder_model_merged: Precision };
}

export interface AdapterInfo {
  vendor: string;
  architecture: string;
  description: string;
  /** A software (CPU-emulated) WebGPU adapter: slower than plain WASM. */
  fallback: boolean;
}

export type ToWorker =
  | ({ type: 'load' } & LoadOptions)
  /** 16 kHz mono audio. `id` comes back with the result. */
  | { type: 'run'; id: number; audio: Float32Array };

export type FromWorker =
  | { type: 'progress'; file: string; loaded: number; total: number }
  | { type: 'ready'; device: WhisperDevice; loadMs: number; adapter: AdapterInfo | null }
  | { type: 'error'; message: string }
  | { type: 'result'; id: number; text: string; ms: number; error?: string };

export const WHISPER_MODEL = 'onnx-community/whisper-base';
