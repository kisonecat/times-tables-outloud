import { describe, expect, it } from 'vitest';
import { attempt, T0 } from '../test/fixtures';
import { ALL_TABLES, factsForTables } from './facts';
import { features, F, transferCount } from './features';
import { BASE_TARGET_MS, fluencyTarget, grade } from './grading';
import { halfLife, recall, ridge, sgdStep, THETA_PRIOR } from './hlr';
import { HLR_MODEL } from './model';
import { byPriorDifficulty, priorHalfLifeH } from './priors';
import { combineRecall, shortTermRecall } from './shortTerm';
import { FSRS_MODEL } from './fsrs';

const HOUR = 3_600_000;

describe('grading (PLAN §8.2)', () => {
  const t = 3000;
  it('grades by correctness and response time', () => {
    expect(grade(attempt({ a: 7, b: 8, onsetMs: 2000 }), t)).toBe('fast');
    expect(grade(attempt({ a: 7, b: 8, onsetMs: 3500 }), t)).toBe('ok');
    expect(grade(attempt({ a: 7, b: 8, onsetMs: 5000 }), t)).toBe('slow');
    expect(grade(attempt({ a: 7, b: 8, answer: 54, correct: false }), t)).toBe('fail');
    expect(grade(attempt({ a: 7, b: 8, answer: null, correct: false, onsetMs: null }), t)).toBe(
      'fail',
    );
    expect(grade(attempt({ a: 7, b: 8, onsetMs: 11_000 }), t)).toBe('fail');
  });
  it('uses commit time when there is no onset', () => {
    expect(grade(attempt({ a: 7, b: 8, onsetMs: null, commitMs: 2500 }), t)).toBe('fast');
  });
  it('adapts the target to the learner only after enough data, within 2–4 s', () => {
    const p = HLR_MODEL.init('L');
    expect(fluencyTarget('typed', p)).toBe(BASE_TARGET_MS.typed);
    const quick = { ...p, rt: { ...p.rt, typed: { mu: Math.log(900), s2: 0.04, n: 80 } } };
    expect(fluencyTarget('typed', quick)).toBe(2000);
    const slow = { ...p, rt: { ...p.rt, typed: { mu: Math.log(5000), s2: 0.04, n: 80 } } };
    expect(fluencyTarget('typed', slow)).toBe(4000);
  });
});

describe('priors (PLAN §8.3)', () => {
  it('start easy facts long and the 6–8 zone short', () => {
    for (const f of ['1x7', '2x9', '5x6', '7x10']) expect(priorHalfLifeH(f)).toBeGreaterThan(24);
    for (const f of ['6x7', '7x8', '6x8', '8x8', '7x7'])
      expect(priorHalfLifeH(f)).toBeCloseTo(2, 5);
  });
  it('introduce facts easiest first', () => {
    const order = byPriorDifficulty(factsForTables(ALL_TABLES));
    expect(order.slice(0, 12)).toEqual(expect.arrayContaining(['1x1', '1x12']));
    expect(order.slice(-5).sort()).toEqual(['6x7', '6x8', '7x7', '7x8', '8x8']);
  });
  it('fit θ so a new learner’s predicted half-lives track the priors', () => {
    const p = HLR_MODEL.init('L');
    const ratio = (f: string) =>
      HLR_MODEL.predict(f, T0, undefined, p).halfLifeH / priorHalfLifeH(f);
    // Close for the facts the plan names…
    for (const f of ['1x5', '2x7', '5x6', '7x10', '6x7', '7x8', '6x8', '7x7', '8x8']) {
      expect(ratio(f)).toBeGreaterThan(0.5);
      expect(ratio(f)).toBeLessThan(2);
    }
    // …and within a small factor everywhere (ten linear features can't match every fact).
    for (const f of factsForTables(ALL_TABLES)) {
      expect(ratio(f)).toBeGreaterThan(0.3);
      expect(ratio(f)).toBeLessThan(3.5);
    }
  });
});

describe('HLR', () => {
  it('p = 2^(−Δ/h), h = 2^(θ·x) clipped to [0.25 h, 180 days]', () => {
    expect(recall(10, 10)).toBeCloseTo(0.5);
    expect(recall(0, 10)).toBe(1);
    expect(halfLife([100], [1])).toBe(180 * 24);
    expect(halfLife([-100], [1])).toBe(0.25);
  });

  it('an SGD step lengthens h after a surprise success and shortens it after a failure', () => {
    const x = features('7x8', undefined, { factorCorrect: new Array(13).fill(0) });
    const h0 = halfLife(THETA_PRIOR, x);
    const up = sgdStep(THETA_PRIOR, THETA_PRIOR, x, h0 * 3, 1, 0, {
      alpha: 0.01,
      lambda: 0.1,
      learningRate: 0.05,
      decaySteps: 2000,
    });
    const down = sgdStep(THETA_PRIOR, THETA_PRIOR, x, h0 * 0.2, 0, 0, {
      alpha: 0.01,
      lambda: 0.1,
      learningRate: 0.05,
      decaySteps: 2000,
    });
    expect(halfLife(up, x)).toBeGreaterThan(h0);
    expect(halfLife(down, x)).toBeLessThan(h0);
  });

  it('regularizes toward the prior, not toward zero', () => {
    const x = new Array(THETA_PRIOR.length).fill(0);
    const moved = THETA_PRIOR.map((t) => t + 1);
    const next = sgdStep(moved, THETA_PRIOR, x, 1, 1, 0, {
      alpha: 0,
      lambda: 0.1,
      learningRate: 0.5,
      decaySteps: 1e9,
    });
    next.forEach((t, i) => expect(Math.abs(t - THETA_PRIOR[i]!)).toBeLessThan(1));
  });

  it('ridge solves a small least-squares problem', () => {
    const w = ridge(
      [
        [1, 0],
        [0, 1],
        [1, 1],
      ],
      [1, 2, 3],
      1e-9,
    );
    expect(w[0]).toBeCloseTo(1, 4);
    expect(w[1]).toBeCloseTo(2, 4);
  });
});

describe('features', () => {
  it('counts transfer from facts sharing a factor, not the fact itself', () => {
    const fc = new Array(13).fill(0);
    fc[7] = 10; // 10 right answers on ×7 facts…
    fc[8] = 4; // …4 on ×8, 3 of each being 7×8 itself
    expect(transferCount('7x8', 3, fc)).toBe(10 + 4 - 6);
    expect(transferCount('7x7', 3, fc)).toBe(7);
  });
  it('one-hot encodes the last grade', () => {
    const state = {
      ...HLR_MODEL.update(attempt({ a: 7, b: 8 }), 'slow', undefined, HLR_MODEL.init('L')).state,
    };
    const x = features('7x8', state, { factorCorrect: new Array(13).fill(0) });
    expect([x[F.lastFail], x[F.lastSlow], x[F.lastOk], x[F.lastFast]]).toEqual([0, 1, 0, 0]);
  });
});

describe('short-term memory (PLAN §8.4)', () => {
  it('combines long- and short-term recall', () => {
    expect(shortTermRecall(0)).toBe(1);
    expect(shortTermRecall(90)).toBeCloseTo(Math.exp(-1));
    expect(combineRecall(0.5, 0.5)).toBe(0.75);
  });
});

describe.each([
  ['HLR', HLR_MODEL],
  ['FSRS', FSRS_MODEL],
])('%s memory model', (_name, model) => {
  it('is unknown (0.5) before the first attempt', () => {
    expect(model.predict('7x8', T0, undefined, model.init('L'))).toMatchObject({
      pNow: 0.5,
      unseen: true,
    });
  });

  it('remembers just after an answer, then forgets', () => {
    const { state, params } = model.update(
      attempt({ a: 7, b: 8 }),
      'ok',
      undefined,
      model.init('L'),
    );
    const soon = model.predict('7x8', state.lastSeen + 10_000, state, params);
    const later = model.predict('7x8', state.lastSeen + 72 * HOUR, state, params);
    expect(soon.pNow).toBeGreaterThan(0.9);
    expect(later.pNow).toBeLessThan(soon.pNow);
    expect(later.pShort).toBeLessThan(0.01);
  });

  it('a failure lowers recall relative to a fast answer', () => {
    const p = model.init('L');
    const fast = model.update(attempt({ a: 7, b: 8 }), 'fast', undefined, p);
    const fail = model.update(
      attempt({ a: 7, b: 8, answer: 54, correct: false }),
      'fail',
      undefined,
      p,
    );
    const t = T0 + 24 * HOUR;
    expect(model.predict('7x8', t, fail.state, fail.params).pLong).toBeLessThan(
      model.predict('7x8', t, fast.state, fast.params).pLong,
    );
  });

  it('keeps per-engine latency baselines and a per-fact offset', () => {
    let p = model.init('L');
    let s;
    for (let i = 0; i < 5; i++) {
      ({ state: s, params: p } = model.update(
        attempt({ a: 7, b: 8, engine: 'typed', onsetMs: 4000, shownAt: T0 + i * HOUR }),
        'ok',
        s,
        p,
      ));
    }
    expect(Math.exp(p.rt.typed.mu)).toBeGreaterThan(3000);
    expect(p.rt['web-speech'].n).toBe(0);
    expect(s!.rtN).toBe(5);
  });
});
