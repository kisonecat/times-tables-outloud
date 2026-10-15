import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from '../../App';
import { openTTDB } from '../../data/db';
import { IdbRepo } from '../../data/repo';
import { DEFAULT_SETTINGS, type Learner } from '../../data/schema';
import type { FakeEngine } from '../../speech/fakeEngine';
import { toWords } from '../../test/numberWords';

let dbCount = 0;

async function setup() {
  const repo = new IdbRepo(await openTTDB(`speech-test-${++dbCount}`));
  const learner: Learner = {
    id: 'learner-1',
    name: 'Sam',
    color: 'avatar-1',
    createdAt: 1,
    settings: {
      ...DEFAULT_SETTINGS,
      tables: [6, 7, 8],
      length: { kind: 'problems', value: 20 },
      engine: 'web-speech',
      sounds: false,
    },
  };
  await repo.putLearner(learner);
  await repo.setMeta('lastLearnerId', learner.id);
  location.hash = '#/quiz';
  render(<App repo={repo} />);
  return { repo, learner };
}

const fake = () => window.__ttFakeSpeech as FakeEngine;
const sleep = (ms: number) => act(() => new Promise((r) => setTimeout(r, ms)));

async function currentProblem(): Promise<[number, number]> {
  const el = await screen.findByLabelText(/^\d+ times \d+$/);
  const [, a, b] = /^(\d+) times (\d+)$/.exec(el.getAttribute('aria-label')!)!;
  await sleep(20); // legibility mark
  return [Number(a), Number(b)];
}

async function waitForFeedback() {
  return screen.findByText(/Yes!|it’s \d+/);
}

beforeEach(() => {
  location.hash = '';
  // jsdom has no speech recognition; the fake engine stands in for it.
  (window as unknown as Record<string, unknown>).webkitSpeechRecognition = class {};
  window.__ttFakeSpeech = true;
});
afterEach(() => {
  cleanup();
  delete window.__ttFakeSpeech;
});

describe('spoken quiz session (fake engine)', () => {
  it('logs spoken answers with onset timing, through readbacks, waits and revisions', async () => {
    const { repo, learner } = await setup();
    const expected: {
      answer: number | null;
      correct: boolean;
      engine: string;
      revision?: number;
    }[] = [];

    for (let i = 0; i < 20; i++) {
      const [a, b] = await currentProblem();
      const p = a * b;
      expect(fake().listening).toBe(true);

      switch (i % 5) {
        case 0: // plain correct answer
          await act(() => fake().say(toWords(p), { delayMs: 30 }));
          expected.push({ answer: p, correct: true, engine: 'web-speech' });
          break;
        case 1: // reads the question back first, then answers
          // (For ×1 facts, "one times six" ends in the product and counts; that's fine.)
          if (a !== 1 && b !== 1) {
            await act(() => fake().say(`${toWords(a)} times ${toWords(b)}`));
            expect(screen.queryByText(/Yes!|it’s \d+/)).toBeNull();
            expect(screen.getByText('Just the answer is fine')).toBeTruthy();
          }
          await act(() => fake().say(`${toWords(a)} times ${toWords(b)} is ${toWords(p)}`));
          expected.push({ answer: p, correct: true, engine: 'web-speech' });
          break;
        case 2: // wrong, then self-corrects during feedback
          await act(() => fake().say(toWords(p + 2)));
          await waitForFeedback();
          await act(() => fake().say(toWords(p)));
          await screen.findByText(`That’s it: ${p}`);
          expected.push({ answer: p + 2, correct: false, engine: 'web-speech', revision: p });
          break;
        case 3: // types instead, mid speech session
          {
            const input = screen.getByLabelText('Your answer');
            fireEvent.change(input, { target: { value: String(p) } });
            fireEvent.keyDown(input, { key: 'Enter' });
          }
          expected.push({ answer: p, correct: true, engine: 'typed' });
          break;
        case 4: // a non-answer, then the answer
          await act(() => fake().say('um'));
          expect(screen.getByText('Say just the number')).toBeTruthy();
          await act(() => fake().say(toWords(p)));
          expected.push({ answer: p, correct: true, engine: 'web-speech' });
          break;
      }
      const fb = await waitForFeedback();
      expect(fb.textContent).toMatch(expected.at(-1)!.correct ? /Yes!/ : /it’s/);
      expect(fake().log.at(-1)).toBe(expected.at(-1)!.correct ? 'pause' : 'listenFresh');
      fireEvent.click(screen.getByRole('button', { name: 'Next →' }));
    }

    await screen.findByRole('heading', { name: /Nice work|Perfect round/ });
    const attempts = (await repo.listAttempts(learner.id)).sort((x, y) => x.seq - y.seq);
    expect(attempts).toHaveLength(20);
    const [session] = await repo.listSessions(learner.id);
    expect(session!.engine).toBe('web-speech');

    attempts.forEach((at, i) => {
      const exp = expected[i]!;
      expect(at.answer).toBe(exp.answer);
      expect(at.correct).toBe(exp.correct);
      expect(at.engine).toBe(exp.engine);
      expect(at.revision).toBe(exp.revision);
      expect(at.onsetMs).not.toBeNull();
      expect(at.onsetMs!).toBeGreaterThanOrEqual(0);
      expect(at.onsetMs!).toBeLessThanOrEqual(at.commitMs);
      if (exp.engine === 'web-speech') {
        // Onset is speech start, which comes before the transcript that committed.
        expect(at.commitMs - at.onsetMs!).toBeGreaterThanOrEqual(25);
        expect(at.transcript).toMatch(/[a-z]/);
      }
    });
  });

  it('waits before accepting an interim answer that could still grow', async () => {
    await setup();
    // 6×10 / 7×10 / 8×10 end in a tens word; use whatever comes up until we get one.
    for (let i = 0; i < 60; i++) {
      const [a, b] = await currentProblem();
      const p = a * b;
      if (p % 10 === 0 && p >= 20 && p < 100) {
        act(() =>
          fake().fire({
            type: 'transcript',
            text: toWords(p),
            alts: [],
            final: false,
            at: performance.now(),
          }),
        );
        await sleep(300);
        expect(screen.queryByText(/Yes!/)).toBeNull(); // still waiting: might be "sixty four"
        await sleep(400);
        expect(screen.getByText(/Yes!/)).toBeTruthy();
        return;
      }
      const input = screen.getByLabelText('Your answer');
      fireEvent.change(input, { target: { value: String(p) } });
      fireEvent.keyDown(input, { key: 'Enter' });
      await waitForFeedback();
      fireEvent.click(screen.getByRole('button', { name: 'Next →' }));
    }
    throw new Error('never got a round-tens product');
  });

  it('falls back to typing when the engine reports the mic is blocked', async () => {
    const { repo, learner } = await setup();
    const [a, b] = await currentProblem();
    act(() => fake().fire({ type: 'state', state: 'error', detail: 'mic-blocked' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/Microphone access is blocked/);
    expect(screen.queryByText('Listening…')).toBeNull();
    const input = screen.getByLabelText('Your answer');
    fireEvent.change(input, { target: { value: String(a * b) } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitForFeedback();
    await sleep(50);
    const [attempt] = await repo.listAttempts(learner.id);
    expect(attempt).toMatchObject({ engine: 'typed', correct: true });
  });
});
