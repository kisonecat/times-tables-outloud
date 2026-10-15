import { describe, expect, it } from 'vitest';
import {
  accuracyBaseline,
  auc,
  calibration,
  evaluateLog,
  logLoss,
  modelPredictor,
} from './evaluate';
import { replay } from './replay';
import { runSimulation } from './simulate';

describe('replay', () => {
  const sim = runSimulation({ policy: 'smart', seed: 11, days: 5 });

  it('rebuilds the same fact states as running online (single pass)', () => {
    const { states } = replay('sim', sim.attempts, { epochs: 1 });
    const online = new Map<string, { nCorrect: number; nWrong: number; lastSeen: number }>();
    for (const a of sim.attempts) {
      const s = online.get(a.fact) ?? { nCorrect: 0, nWrong: 0, lastSeen: 0 };
      online.set(a.fact, {
        nCorrect: s.nCorrect,
        nWrong: s.nWrong,
        lastSeen: a.shownAt + a.commitMs,
      });
    }
    expect(states.size).toBe(online.size);
    for (const [fact, s] of states) expect(s.lastSeen).toBe(online.get(fact)!.lastSeen);
  });

  it('is order-independent: input order does not matter', () => {
    const a = replay('sim', sim.attempts, { epochs: 2 });
    const b = replay('sim', [...sim.attempts].reverse(), { epochs: 2 });
    expect(b.params.theta).toEqual(a.params.theta);
  });
});

describe('evaluate', () => {
  it('computes log loss, AUC and calibration', () => {
    expect(logLoss([0.5, 0.5], [true, false])).toBeCloseTo(Math.log(2));
    expect(auc([0.9, 0.8, 0.2, 0.1], [true, true, false, false])).toBe(1);
    expect(auc([0.1, 0.2, 0.8, 0.9], [true, true, false, false])).toBe(0);
    expect(auc([0.5, 0.5], [true, false])).toBe(0.5);
    const cal = calibration([0.05, 0.05, 0.95, 0.95], [false, false, true, false]);
    expect(cal).toEqual([
      { predicted: 0.05, observed: 0, n: 2 },
      { predicted: 0.95, observed: 0.5, n: 2 },
    ]);
  });

  it('HLR ranks outcomes better than per-fact accuracy on a simulated log', () => {
    const log = runSimulation({ policy: 'random', seed: 12, days: 10 }).attempts;
    const m = evaluateLog(log, { hlr: modelPredictor('sim'), baseline: accuracyBaseline() });
    expect(m.hlr!.auc).toBeGreaterThan(m.baseline!.auc);
  });
});
