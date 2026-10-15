import type { EngineKind, FactState, ModelParams } from '../data/schema';
import { fluencyTarget } from './grading';
import { predictRtMs } from './latency';
import type { MemoryModel } from './model';

/** Predicted recall needed to call a fact fluent (PLAN §7.3). */
export const FLUENT_RECALL = 0.9;

/**
 * Fluent: predicted long-term recall ≥ 0.9 and recent response time within the fluency
 * target. "Recent" is the latency model's per-fact estimate, which weighs the last ~5
 * answers most.
 */
export function isFluent(
  model: MemoryModel,
  fact: string,
  now: number,
  state: FactState | undefined,
  params: ModelParams,
  engine: EngineKind,
): boolean {
  if (!state || state.rtN === 0) return false;
  const { pLong } = model.predict(fact, now, state, params);
  return (
    pLong >= FLUENT_RECALL &&
    predictRtMs(fact, engine, state, params) <= fluencyTarget(engine, params)
  );
}

export function fluentFacts(
  model: MemoryModel,
  facts: Iterable<string>,
  now: number,
  states: ReadonlyMap<string, FactState>,
  params: ModelParams,
  engine: EngineKind,
): Set<string> {
  const out = new Set<string>();
  for (const f of facts) if (isFluent(model, f, now, states.get(f), params, engine)) out.add(f);
  return out;
}
