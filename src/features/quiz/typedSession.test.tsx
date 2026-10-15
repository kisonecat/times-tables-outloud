import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from '../../App';
import { openTTDB } from '../../data/db';
import { IdbRepo } from '../../data/repo';
import { DEFAULT_SETTINGS, type Learner } from '../../data/schema';
import { factKey } from '../../learning/facts';

let dbCount = 0;

async function setup(lengthValue: 20 | 40 = 20) {
  const repo = new IdbRepo(await openTTDB(`test-${++dbCount}`));
  const learner: Learner = {
    id: 'learner-1',
    name: 'Sam',
    color: 'avatar-1',
    createdAt: 1,
    settings: {
      ...DEFAULT_SETTINGS,
      tables: [6, 7],
      length: { kind: 'problems', value: lengthValue },
    },
  };
  await repo.putLearner(learner);
  await repo.setMeta('lastLearnerId', learner.id);
  location.hash = '#/quiz';
  render(<App repo={repo} />);
  return { repo, learner };
}

/** Reads the problem off the card, once it's legible (the input is focused then). */
async function currentProblem(): Promise<[number, number]> {
  const el = await screen.findByLabelText(/^\d+ times \d+$/);
  const [, a, b] = /^(\d+) times (\d+)$/.exec(el.getAttribute('aria-label')!)!;
  // Give the FlashCard's rAF a chance to mark legibility.
  await act(() => new Promise((r) => requestAnimationFrame(() => r(null))));
  return [Number(a), Number(b)];
}

beforeEach(() => {
  location.hash = '';
});
afterEach(cleanup);

describe('typed quiz session', () => {
  it('logs one correct Attempt row per problem', async () => {
    const { repo, learner } = await setup(20);
    const expected: { a: number; b: number; answer: number | null; correct: boolean }[] = [];

    for (let i = 0; i < 20; i++) {
      const [a, b] = await currentProblem();
      const input = screen.getByLabelText('Your answer');
      if (i % 5 === 4) {
        // skip
        fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
        expected.push({ a, b, answer: null, correct: false });
      } else {
        const answer = i % 3 === 2 ? a * b + 1 : a * b;
        fireEvent.change(input, { target: { value: String(answer) } });
        fireEvent.keyDown(input, { key: 'Enter' });
        expected.push({ a, b, answer, correct: answer === a * b });
      }
      await screen.findByText(/Yes!|it’s \d+|It’s \d+/);
      fireEvent.click(screen.getByRole('button', { name: 'Next →' }));
    }

    await screen.findByRole('heading', { name: /Nice work|Perfect round/ });

    const attempts = await repo.listAttempts(learner.id);
    expect(attempts).toHaveLength(20);
    const sessions = await repo.listSessions(learner.id);
    expect(sessions).toHaveLength(1);
    const session = sessions[0]!;
    expect(session.endedAt).toBeGreaterThanOrEqual(session.startedAt);
    expect(session.engine).toBe('typed');
    expect(session.tables).toEqual([6, 7]);

    const bySeq = [...attempts].sort((x, y) => x.seq - y.seq);
    bySeq.forEach((at, i) => {
      const exp = expected[i]!;
      expect(at.seq).toBe(i);
      expect(at.sessionId).toBe(session.id);
      expect(at.learnerId).toBe(learner.id);
      expect([at.a, at.b]).toEqual([exp.a, exp.b]);
      expect(at.fact).toBe(factKey(exp.a, exp.b));
      expect(at.a === 6 || at.a === 7 || at.b === 6 || at.b === 7).toBe(true);
      expect(at.answer).toBe(exp.answer);
      expect(at.correct).toBe(exp.correct);
      expect(at.engine).toBe('typed');
      expect(at.ttsUsed).toBe(false);
      // Smart practice: every attempt carries the model's prediction and why it was picked.
      expect(['new', 'due', 'retry', 'speed', 'explore']).toContain(at.selectionReason);
      expect(at.pred.modelVersion).toBe('hlr-1');
      expect(at.pred.pRecall).toBeGreaterThan(0);
      expect(at.pred.rtMs).toBeGreaterThan(0);
      expect(at.shownAt).toBeGreaterThanOrEqual(session.startedAt - 1);
      expect(at.commitMs).toBeGreaterThanOrEqual(0);
      if (exp.answer === null) {
        expect(at.onsetMs).toBeNull();
        expect(at.transcript).toBe('');
      } else {
        expect(at.onsetMs).not.toBeNull();
        expect(at.onsetMs!).toBeLessThanOrEqual(at.commitMs);
        expect(at.transcript).toBe(String(exp.answer));
      }
    });

    // The model state was saved alongside, one fact state per fact practiced.
    const model = await repo.getModel(learner.id);
    expect(model.params?.version).toBe('hlr-1');
    expect(new Set(model.states.map((st) => st.fact))).toEqual(
      new Set(attempts.map((a) => a.fact)),
    );
    const s0 = model.states.find((st) => st.fact === bySeq[0]!.fact)!;
    expect(s0.nCorrect + s0.nWrong).toBe(attempts.filter((a) => a.fact === s0.fact).length);
    expect(session.newlyFluent).toEqual(expect.any(Array));

    // shownAt is monotonic across the session
    for (let i = 1; i < bySeq.length; i++) {
      expect(bySeq[i]!.shownAt).toBeGreaterThanOrEqual(bySeq[i - 1]!.shownAt);
    }

    // results screen reflects the log
    const right = expected.filter((e) => e.correct).length;
    expect(screen.getByText('Score').nextElementSibling!.textContent).toBe(`${right}/20`);
  });

  it('ignores Enter with nothing typed', async () => {
    const { repo, learner } = await setup(20);
    await currentProblem();
    fireEvent.keyDown(screen.getByLabelText('Your answer'), { key: 'Enter' });
    await waitFor(() => expect(screen.queryByText(/Yes!|it’s/i)).toBeNull());
    expect(await repo.listAttempts(learner.id)).toHaveLength(0);
  });
});
