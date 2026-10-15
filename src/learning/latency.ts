import type { EngineKind, FactState, ModelParams, RtBaseline } from '../data/schema';
import { priorRtOffset } from './priors';

/**
 * Response-time model (PLAN §8.5): per learner and engine, log RT ~ Normal(μ + β_fact, σ²).
 * Only correct answers feed it; a wrong answer's latency measures something else.
 */

export const RT_PRIOR: Record<EngineKind, RtBaseline> = {
  'web-speech': { mu: Math.log(1800), s2: 0.35 ** 2, n: 0 },
  whisper: { mu: Math.log(1800), s2: 0.35 ** 2, n: 0 },
  typed: { mu: Math.log(2400), s2: 0.35 ** 2, n: 0 },
};

/** β_fact: running mean at first, then exponentially weighted so 5 attempts back weighs half. */
const FACT_ALPHA_FLOOR = 1 - 0.5 ** (1 / 5);
/** μ and σ² track the learner slowly. */
const BASE_ALPHA_FLOOR = 0.02;

export function updateBaseline(b: RtBaseline, logRt: number): RtBaseline {
  const a = Math.max(1 / (b.n + 1), BASE_ALPHA_FLOOR);
  const mu = b.mu + a * (logRt - b.mu);
  const s2 = Math.max(0.01, (1 - a) * b.s2 + a * (logRt - mu) ** 2);
  return { mu, s2, n: b.n + 1 };
}

/** Sign of the display order: +1 when the larger factor is shown first. */
export function orientation(a: number, b: number): number {
  return a > b ? 1 : a < b ? -1 : 0;
}

/** Update a fact's offset from a residual (log RT − μ, before μ moves). */
export function updateFactLatency(
  state: Pick<FactState, 'rtLogMean' | 'rtLogVar' | 'rtN' | 'rtOrient'>,
  residual: number,
  sign: number,
) {
  const a = Math.max(1 / (state.rtN + 1), FACT_ALPHA_FLOOR);
  const rtLogMean = state.rtLogMean + a * (residual - state.rtLogMean);
  const rtLogVar = (1 - a) * state.rtLogVar + a * (residual - rtLogMean) ** 2;
  const rtOrient = sign
    ? state.rtOrient + a * (sign * (residual - rtLogMean) - state.rtOrient)
    : state.rtOrient;
  return { rtLogMean, rtLogVar, rtN: state.rtN + 1, rtOrient };
}

export function factOffset(fact: string, state: FactState | undefined): number {
  return state && state.rtN > 0 ? state.rtLogMean : priorRtOffset(fact);
}

/** Predicted (median) response time for a fact on an engine, in ms. */
export function predictRtMs(
  fact: string,
  engine: EngineKind,
  state: FactState | undefined,
  params: ModelParams,
  display?: { a: number; b: number },
): number {
  const b = params.rt[engine];
  const orient = display && state ? orientation(display.a, display.b) * state.rtOrient : 0;
  return Math.exp(b.mu + factOffset(fact, state) + orient);
}

/** How unusually slow this fact is for this learner, as a z-score clipped at 0. */
export function slowness(
  fact: string,
  engine: EngineKind,
  state: FactState | undefined,
  params: ModelParams,
) {
  return Math.max(0, factOffset(fact, state) / Math.sqrt(params.rt[engine].s2));
}
