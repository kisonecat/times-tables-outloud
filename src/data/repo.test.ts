import { describe, expect, it } from 'vitest';
import { openTTDB } from './db';
import { IdbRepo, MemoryRepo, type Repo } from './repo';
import { DEFAULT_SETTINGS, NO_PREDICTION, type Attempt } from './schema';

const attempt = (id: string, learnerId: string, sessionId: string, seq: number): Attempt => ({
  id,
  learnerId,
  sessionId,
  seq,
  a: 7,
  b: 8,
  fact: '7x8',
  shownAt: 1000 + seq,
  onsetMs: 900,
  commitMs: 1200,
  engine: 'typed',
  transcript: '56',
  answer: 56,
  correct: true,
  ttsUsed: false,
  selectionReason: 'random',
  pred: NO_PREDICTION,
});

let n = 0;
const impls: [string, () => Promise<Repo>][] = [
  ['IdbRepo', async () => new IdbRepo(await openTTDB(`repo-test-${++n}`))],
  ['MemoryRepo', async () => new MemoryRepo()],
];

describe.each(impls)('%s', (_name, make) => {
  it('round-trips learners, sessions and attempts, and cascades deletes', async () => {
    const repo = await make();
    for (const id of ['L1', 'L2']) {
      await repo.putLearner({
        id,
        name: id,
        color: 'avatar-1',
        createdAt: id === 'L1' ? 1 : 2,
        settings: DEFAULT_SETTINGS,
      });
      await repo.putSession({
        id: `S-${id}`,
        learnerId: id,
        startedAt: 5,
        mode: 'free',
        tables: [7],
        engine: 'typed',
        device: 'x',
      });
      await repo.addAttempt(attempt(`A1-${id}`, id, `S-${id}`, 1));
      await repo.addAttempt(attempt(`A0-${id}`, id, `S-${id}`, 0));
    }
    expect((await repo.listLearners()).map((l) => l.id)).toEqual(['L1', 'L2']);
    expect((await repo.listSessionAttempts('S-L1')).map((a) => a.seq)).toEqual([0, 1]);
    expect((await repo.listAttempts('L1')).map((a) => a.id)).toEqual(['A0-L1', 'A1-L1']);
    await expect(repo.addAttempt(attempt('A0-L1', 'L1', 'S-L1', 0))).rejects.toThrow();

    await repo.deleteLearner('L1');
    expect((await repo.listLearners()).map((l) => l.id)).toEqual(['L2']);
    expect(await repo.listAttempts('L1')).toEqual([]);
    expect(await repo.listSessions('L1')).toEqual([]);
    expect(await repo.listAttempts('L2')).toHaveLength(2);
    expect(await repo.listSessions('L2')).toHaveLength(1);
  });

  it('records a revision without touching correctness', async () => {
    const repo = await make();
    await repo.addAttempt({ ...attempt('A', 'L', 'S', 0), answer: 54, correct: false });
    await repo.setAttemptRevision('A', 56);
    const [a] = await repo.listAttempts('L');
    expect(a).toMatchObject({ answer: 54, correct: false, revision: 56 });
  });

  it('stores meta values', async () => {
    const repo = await make();
    expect(await repo.getMeta('x')).toBeUndefined();
    await repo.setMeta('x', { y: 1 });
    expect(await repo.getMeta('x')).toEqual({ y: 1 });
  });
});
