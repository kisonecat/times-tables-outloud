import { describe, expect, it } from 'vitest';
import { runSimulation, type SimResult } from './simulate';

/**
 * PLAN §8.8 acceptance: over 30 simulated days at 10 min/day, the smart scheduler reaches
 * 90% fluent facts in fewer days than uniform random, and keeps the success rate between
 * 75% and 92% while there's still learning to do. (Once nearly every fact is mastered no
 * scheduler can find enough hard problems to stay under 92%, so the band is checked over
 * the learning phase: each day up to reaching 90% fluency.)
 */
const SEEDS = [1, 2, 3, 4];

const learningPhaseAccuracy = (r: SimResult) => {
  const days = r.days.slice(0, r.daysTo90 ?? r.days.length - 1);
  const right = days.reduce((s, d) => s + d.accuracy * d.problems, 0);
  return right / days.reduce((s, d) => s + d.problems, 0);
};

describe('scheduler simulation (PLAN §8.8)', () => {
  const runs = SEEDS.map((seed) => ({
    seed,
    smart: runSimulation({ policy: 'smart', seed }),
    random: runSimulation({ policy: 'random', seed }),
    roundRobin: runSimulation({ policy: 'round-robin', seed }),
  }));

  it.each(runs)('seed $seed: smart reaches 90% fluent sooner than random', ({ smart, random }) => {
    expect(smart.daysTo90).not.toBeNull();
    expect(smart.daysTo90!).toBeLessThan(random.daysTo90 ?? Infinity);
  });

  it.each(runs)('seed $seed: success rate stays in 75–92% while learning', ({ smart }) => {
    const acc = learningPhaseAccuracy(smart);
    expect(acc).toBeGreaterThanOrEqual(0.75);
    expect(acc).toBeLessThanOrEqual(0.92);
  });

  it('beats round-robin on average too', () => {
    const mean = (k: 'smart' | 'roundRobin') =>
      runs.reduce((s, r) => s + (r[k].daysTo90 ?? 31), 0) / runs.length;
    expect(mean('smart')).toBeLessThan(mean('roundRobin'));
  });

  it('logs a prediction and a reason with every attempt', () => {
    for (const a of runs[0]!.smart.attempts) {
      expect(a.pred.modelVersion).not.toBe('none');
      expect(a.pred.pRecall).toBeGreaterThanOrEqual(0);
      expect(a.pred.pRecall).toBeLessThanOrEqual(1);
      expect(a.pred.rtMs).toBeGreaterThan(0);
      expect(['due', 'new', 'retry', 'speed', 'explore']).toContain(a.selectionReason);
    }
  });
});
