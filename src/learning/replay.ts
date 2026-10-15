import type { Attempt, FactState, ModelParams } from '../data/schema';
import { fluencyTarget, grade } from './grading';
import { HLR_MODEL, type MemoryModel } from './model';

export interface ModelSnapshot {
  states: Map<string, FactState>;
  params: ModelParams;
}

/**
 * Rebuild a learner's model state from the attempt log, which is the source of truth.
 * θ is refit over several passes (each pass replays the whole history in time order,
 * carrying θ forward); counts, latency and every other statistic come from the last pass.
 * Run after an import, or when the model version changes.
 */
export function replay(
  learnerId: string,
  attempts: readonly Attempt[],
  { model = HLR_MODEL, epochs = 3 }: { model?: MemoryModel; epochs?: number } = {},
): ModelSnapshot {
  const ordered = [...attempts].sort((x, y) => x.shownAt - y.shownAt || x.seq - y.seq);
  let theta = model.init(learnerId).theta;
  let snapshot: ModelSnapshot = { states: new Map(), params: model.init(learnerId) };
  for (let e = 0; e < Math.max(1, epochs); e++) {
    const states = new Map<string, FactState>();
    let params: ModelParams = { ...model.init(learnerId), theta };
    for (const a of ordered) {
      const g = grade(a, fluencyTarget(a.engine, params));
      const next = model.update(a, g, states.get(a.fact), params);
      states.set(a.fact, next.state);
      params = next.params;
    }
    theta = params.theta;
    snapshot = { states, params };
  }
  return snapshot;
}
