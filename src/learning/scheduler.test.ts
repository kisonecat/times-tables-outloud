import { describe, expect, it } from 'vitest';
import type { Attempt } from '../data/schema';
import { attempt, T0 } from '../test/fixtures';
import { Tutor } from './scheduler';
import { mulberry32 } from './simulate';

/** Run a tutor where the learner answers by `answer(fact, i)`; returns the attempts. */
function drive(tutor: Tutor, n: number, answer: (fact: string, i: number) => boolean, start = T0) {
  const out: Attempt[] = [];
  let now = start;
  for (let i = 0; i < n; i++) {
    const { problem, pred } = tutor.next(now);
    const right = answer(problem.fact, i);
    const a = attempt({
      a: problem.a,
      b: problem.b,
      seq: i,
      shownAt: now,
      onsetMs: 1500,
      commitMs: 2000,
      answer: right ? problem.a * problem.b : problem.a * problem.b + 1,
      correct: right,
      selectionReason: problem.reason,
      pred,
    });
    tutor.record(a);
    out.push(a);
    now += 5000;
  }
  return out;
}

describe('Tutor (PLAN §8.6)', () => {
  it('free mode is uniform over the chosen tables', () => {
    const tutor = new Tutor({
      learnerId: 'L',
      tables: [7],
      mode: 'free',
      engine: 'typed',
      rng: mulberry32(1),
    });
    const seen = drive(tutor, 400, () => true);
    expect(new Set(seen.map((a) => a.fact)).size).toBe(12);
    seen.forEach((a) => expect(a.selectionReason).toBe('random'));
  });

  it('brings a missed fact back after 2, then 5, then 10 intervening problems', () => {
    const tutor = new Tutor({
      learnerId: 'L',
      tables: [2, 3, 4, 5, 6, 7, 8, 9],
      mode: 'smart',
      engine: 'typed',
      rng: mulberry32(2),
      options: { exploreRate: 0 },
    });
    let missed: string | null = null;
    const seen = drive(tutor, 60, (fact, i) => {
      if (i === 20) missed = fact;
      return i !== 20;
    });
    const at = seen
      .map((a, i) => (a.fact === missed && a.selectionReason === 'retry' ? i : -1))
      .filter((i) => i >= 0);
    // Retries at 20+3, then +6, then +11 (it leaves after two good answers, so just two).
    expect(at.slice(0, 2)).toEqual([23, 29]);
  });

  it('introduces at most one new fact per 5 problems, easiest first', () => {
    const tutor = new Tutor({
      learnerId: 'L',
      tables: [6, 7, 8],
      mode: 'smart',
      engine: 'typed',
      rng: mulberry32(3),
      options: { exploreRate: 0 },
    });
    const seen = drive(tutor, 60, () => true);
    // At the very start a new learner has nothing else to ask (the last 3 are excluded),
    // so the first few are forced; after that, new facts are ≥ 5 problems apart.
    const newAt = seen.map((a, i) => (a.selectionReason === 'new' ? i : -1)).filter((i) => i >= 4);
    for (let k = 1; k < newAt.length; k++)
      expect(newAt[k]! - newAt[k - 1]!).toBeGreaterThanOrEqual(5);
    expect(newAt.length).toBeGreaterThan(3);
    expect(seen.find((a) => a.selectionReason === 'new')!.fact).toBe('1x6');
  });

  it('holds new facts back while the learner is struggling', () => {
    const tutor = new Tutor({
      learnerId: 'L',
      tables: [6, 7, 8],
      mode: 'smart',
      engine: 'typed',
      rng: mulberry32(4),
      options: { exploreRate: 0 },
    });
    const seen = drive(tutor, 40, (_f, i) => i < 3 || i % 2 === 0); // 50% accuracy after a start
    expect(seen.slice(10).filter((a) => a.selectionReason === 'new').length).toBe(0);
  });

  it('never repeats any of the last 3 problems except as a retry', () => {
    const tutor = new Tutor({
      learnerId: 'L',
      tables: [3, 4],
      mode: 'smart',
      engine: 'typed',
      rng: mulberry32(5),
    });
    const seen = drive(tutor, 200, (_f, i) => i % 7 !== 0);
    seen.forEach((a, i) => {
      if (i < 3 || a.selectionReason === 'retry') return;
      expect(seen.slice(i - 3, i).map((p) => p.fact)).not.toContain(a.fact);
    });
  });

  it('raises the target recall when struggling and lowers it when cruising', () => {
    const tutor = new Tutor({
      learnerId: 'L',
      tables: [3],
      mode: 'smart',
      engine: 'typed',
      rng: mulberry32(6),
    });
    drive(tutor, 10, () => false);
    expect(tutor.targetRecall()).toBe(0.92);
    drive(tutor, 10, () => true, T0 + 3_600_000);
    expect(tutor.targetRecall()).toBeCloseTo(0.725);
  });

  it('explores about 5% of the time', () => {
    const tutor = new Tutor({
      learnerId: 'L',
      tables: [2, 3, 4, 5, 6, 7, 8, 9],
      mode: 'smart',
      engine: 'typed',
      rng: mulberry32(7),
    });
    const seen = drive(tutor, 2000, (_f, i) => i % 9 !== 0);
    const rate = seen.filter((a) => a.selectionReason === 'explore').length / seen.length;
    expect(rate).toBeGreaterThan(0.03);
    expect(rate).toBeLessThan(0.07);
  });

  it('logs the prediction made before each attempt', () => {
    const tutor = new Tutor({
      learnerId: 'L',
      tables: [7],
      mode: 'smart',
      engine: 'typed',
      rng: mulberry32(8),
    });
    const seen = drive(tutor, 30, () => true);
    expect(seen[0]!.pred).toMatchObject({ pRecall: 0.5, modelVersion: 'hlr-1' });
    seen.forEach((a) => expect(a.pred.rtMs).toBeGreaterThan(0));
  });
});
