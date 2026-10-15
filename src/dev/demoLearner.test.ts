import { describe, expect, it } from 'vitest';
import { MemoryRepo } from '../data/repo';
import { loadDemoLearner } from './demoLearner';

describe('demo learner (dev only)', () => {
  it('creates 30 days of history with a rebuilt model', async () => {
    const repo = new MemoryRepo();
    const learner = await loadDemoLearner(repo);
    const sessions = await repo.listSessions(learner.id);
    const attempts = await repo.listAttempts(learner.id);
    expect(sessions).toHaveLength(30);
    expect(attempts.length).toBeGreaterThan(30 * 80);
    expect(new Set(attempts.map((a) => a.id)).size).toBe(attempts.length);
    const lastEnd = Math.max(...sessions.map((s) => s.endedAt!));
    expect(Date.now() - lastEnd).toBeLessThan(2 * 24 * 3_600_000);
    const model = await repo.getModel(learner.id);
    expect(model.params?.version).toBe('hlr-1');
    expect(model.states.length).toBe(78);
  });
});
