import type { Repo } from '../data/repo';
import { DEFAULT_SETTINGS, type Learner, type Session } from '../data/schema';
import { ALL_TABLES } from '../learning/facts';
import { loadModel } from '../learning/loadModel';
import { runSimulation } from '../learning/simulate';
import { newId } from '../lib/ids';

/**
 * Development only: a learner with 30 days of simulated history (smart practice, all
 * tables, about 10 minutes a day, last session yesterday afternoon). Imported
 * dynamically behind import.meta.env.DEV, so neither this nor the simulator ships.
 */
export async function loadDemoLearner(repo: Repo): Promise<Learner> {
  const learnerId = newId();
  const today = new Date();
  today.setHours(16, 0, 0, 0);
  const days = 30;
  const sim = runSimulation({
    policy: 'smart',
    days,
    learnerId,
    seed: Math.floor(Math.random() * 1e6),
    start: today.getTime() - days * 24 * 3_600_000,
  });

  // Fresh ids so a second demo learner doesn't collide with the first.
  const sessionIds = new Map<string, string>();
  const attempts = sim.attempts.map((a) => {
    if (!sessionIds.has(a.sessionId)) sessionIds.set(a.sessionId, newId());
    return { ...a, id: newId(), sessionId: sessionIds.get(a.sessionId)! };
  });
  const sessions: Session[] = [...sessionIds.values()].map((id) => {
    const list = attempts.filter((a) => a.sessionId === id);
    const last = list[list.length - 1]!;
    return {
      id,
      learnerId,
      startedAt: list[0]!.shownAt,
      endedAt: last.shownAt + last.commitMs,
      mode: 'smart',
      tables: [...ALL_TABLES],
      engine: 'web-speech',
      device: 'Simulated',
    };
  });

  const learner: Learner = {
    id: learnerId,
    name: 'Demo',
    color: 'avatar-4',
    createdAt: sessions[0]!.startedAt,
    settings: { ...DEFAULT_SETTINGS, tables: [...ALL_TABLES], engine: 'typed' },
  };
  await repo.putLearner(learner);
  await repo.addHistory(sessions, attempts);
  await loadModel(repo, learnerId); // rebuild the model cache from the log
  return learner;
}
