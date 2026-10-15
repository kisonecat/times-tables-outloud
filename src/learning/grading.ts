import type { Attempt, EngineKind, ModelParams } from '../data/schema';
import type { Grade } from './types';

/** No answer within this long counts as a fail. */
export const TIMEOUT_MS = 10_000;
/** Correct but slower than this multiple of the fluency target looks like counting. */
export const SLOW_FACTOR = 1.6;

/** Observed recall used to train the memory model, per grade (PLAN §8.2). */
export const GRADE_RECALL: Record<Grade, number> = { fail: 0, slow: 0.6, ok: 0.85, fast: 1 };

export const BASE_TARGET_MS: Record<EngineKind, number> = {
  'web-speech': 3000,
  whisper: 3000,
  typed: 3500,
};

/** Adapt the target once there's enough data: 40th-percentile RT × 1.5, within 2–4 s. */
const ADAPT_AFTER = 50;
const Z_40 = -0.2533;

/** Response time: speech/keystroke onset when available (retrieval), else commit. */
export function responseTimeMs(a: Pick<Attempt, 'onsetMs' | 'commitMs'>): number {
  return a.onsetMs ?? a.commitMs;
}

/** The fluency target for this learner on this engine, in ms. */
export function fluencyTarget(engine: EngineKind, params?: ModelParams): number {
  const b = params?.rt[engine];
  if (!b || b.n < ADAPT_AFTER) return BASE_TARGET_MS[engine];
  const p40 = Math.exp(b.mu + Z_40 * Math.sqrt(b.s2));
  return Math.min(4000, Math.max(2000, p40 * 1.5));
}

export function grade(
  a: Pick<Attempt, 'correct' | 'answer' | 'onsetMs' | 'commitMs'>,
  targetMs: number,
): Grade {
  const rt = responseTimeMs(a);
  if (!a.correct || a.answer === null || rt > TIMEOUT_MS) return 'fail';
  if (rt <= targetMs) return 'fast';
  if (rt <= targetMs * SLOW_FACTOR) return 'ok';
  return 'slow';
}
