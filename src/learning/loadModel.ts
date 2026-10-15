import type { Repo } from '../data/repo';
import type { FactState, ModelParams } from '../data/schema';
import { HLR_MODEL, type MemoryModel } from './model';
import { replay } from './replay';

/** The memory model the app uses. FSRS (./fsrs) implements the same interface. */
export const ACTIVE_MODEL: MemoryModel = HLR_MODEL;

/**
 * A learner's model state, from the cache when it's current, otherwise rebuilt from the
 * attempt log (the source of truth) and re-cached: first use, after an import, or when
 * the model version changes.
 */
export async function loadModel(
  repo: Repo,
  learnerId: string,
  model: MemoryModel = ACTIVE_MODEL,
): Promise<{ states: FactState[]; params: ModelParams; rebuilt: boolean }> {
  const cached = await repo.getModel(learnerId);
  if (cached.params?.version === model.version) {
    return { states: cached.states, params: cached.params, rebuilt: false };
  }
  const attempts = await repo.listAttempts(learnerId);
  const { states, params } = replay(learnerId, attempts, { model });
  await repo.saveModel(learnerId, states.values(), params).catch(() => {});
  return { states: [...states.values()], params, rebuilt: true };
}
