import type { EngineKind, FactState, ModelParams } from '../data/schema';
import { parseFactKey } from './facts';
import { responseTimeMs } from './grading';
import { orientation, RT_PRIOR, updateBaseline, updateFactLatency } from './latency';
import { emptyFactState, type MemoryModel } from './model';
import { priorDifficulty, priorHalfLifeH } from './priors';
import { combineRecall, shortTermRecall } from './shortTerm';
import type { Grade } from './types';

/**
 * An FSRS-based memory model (PLAN §8.7): power-law forgetting R = (1 + t/9S)^−1, with
 * stability S and difficulty D updated per review. Grades map to FSRS ratings as
 * fail → Again, slow → Hard, ok → Good, fast → Easy. Weights are the published FSRS-5
 * defaults, except where a fact starts: FSRS's first-review stabilities come from adult
 * flashcard data (one "Easy" sets S to ~16 days), so instead the starting stability is
 * this fact's prior half-life (PLAN §8.3) scaled by FSRS's ratios between ratings, and
 * the starting difficulty is nudged by the fact's prior difficulty.
 *
 * FactState reuses halfLifeH for the power-law half-life (9S, in hours) so analytics and
 * the scheduler can read either model the same way; S and D live in `fsrs`.
 */

const W = [
  0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575, 0.1192, 1.01925,
  1.9395, 0.11, 0.29605, 2.2698, 0.2315, 2.9898, 0.51655, 0.6621,
] as const;
const w = (i: number) => W[i]!;

const RATING: Record<Grade, 1 | 2 | 3 | 4> = { fail: 1, slow: 2, ok: 3, fast: 4 };
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const MIN_S = 0.01;
const SAME_DAY_H = 8;

const clampD = (d: number) => Math.min(10, Math.max(1, d));

export function fsrsRecall(days: number, s: number): number {
  return 1 / (1 + Math.max(0, days) / (9 * s));
}

/** A power-law curve's half-life is 9S, so the prior half-life h maps to S = h/9 at "Good". */
function initialS(fact: string, g: number): number {
  return Math.max(MIN_S, ((priorHalfLifeH(fact) / 24 / 9) * w(g - 1)) / w(2));
}

function initialD(fact: string, g: number): number {
  // FSRS's D0(G), nudged by how hard this fact usually is.
  const d0 = w(4) - Math.exp(w(5) * (g - 1)) + 1;
  return clampD(d0 + 3 * (priorDifficulty(fact) - 0.5));
}

function nextD(d: number, d0Good: number, g: number): number {
  const delta = -w(6) * (g - 3);
  const damped = d + (delta * (10 - d)) / 9;
  return clampD(w(7) * d0Good + (1 - w(7)) * damped);
}

function successS(d: number, s: number, r: number, g: number): number {
  const hard = g === 2 ? w(15) : 1;
  const easy = g === 4 ? w(16) : 1;
  return (
    s * (1 + Math.exp(w(8)) * (11 - d) * s ** -w(9) * (Math.exp(w(10) * (1 - r)) - 1) * hard * easy)
  );
}

function lapseS(d: number, s: number, r: number): number {
  const next = w(11) * d ** -w(12) * ((s + 1) ** w(13) - 1) * Math.exp(w(14) * (1 - r));
  return Math.min(s, next);
}

type Fsrs = NonNullable<FactState['fsrs']>;
const fsrsOf = (state: FactState | undefined): Fsrs | null => state?.fsrs ?? null;

export function createFsrsModel({ version = 'fsrs-1' } = {}): MemoryModel {
  return {
    version,

    init(learnerId): ModelParams {
      return {
        learnerId,
        theta: [],
        version,
        updatedAt: 0,
        steps: 0,
        factorCorrect: new Array<number>(13).fill(0),
        rt: structuredClone(RT_PRIOR) as Record<EngineKind, ModelParams['rt'][EngineKind]>,
      };
    },

    predict(_fact, now, state) {
      const f = fsrsOf(state);
      if (!state || !f) return { pLong: 0.5, pNow: 0.5, pShort: 0, halfLifeH: 0, unseen: true };
      const pLong = fsrsRecall((now - state.lastSeen) / DAY, f.s);
      const pShort = shortTermRecall((now - state.lastSeen) / 1000);
      return {
        pLong,
        pNow: combineRecall(pLong, pShort),
        pShort,
        halfLifeH: 9 * f.s * 24,
        unseen: false,
      };
    },

    update(attempt, grade, prev, params) {
      const g = RATING[grade];
      const reviewedAt = attempt.shownAt + attempt.commitMs;
      const f = fsrsOf(prev);
      let next: Fsrs;
      if (!prev || !f) {
        next = { s: initialS(attempt.fact, g), d: initialD(attempt.fact, g) };
      } else {
        const elapsedH = Math.max(0, attempt.shownAt - prev.lastSeen) / HOUR;
        const r = fsrsRecall(elapsedH / 24, f.s);
        const d = nextD(f.d, initialD(attempt.fact, 3), g);
        const s =
          elapsedH < SAME_DAY_H
            ? f.s * Math.exp(w(17) * (g - 3 + w(18)))
            : g === 1
              ? lapseS(f.d, f.s, r)
              : successS(f.d, f.s, r, g);
        next = { s: Math.max(MIN_S, s), d };
      }

      const base = prev ?? emptyFactState(attempt.learnerId, attempt.fact);
      const correct = grade !== 'fail';
      let state: FactState = {
        ...base,
        nCorrect: base.nCorrect + (correct ? 1 : 0),
        nWrong: base.nWrong + (correct ? 0 : 1),
        nFast: base.nFast + (grade === 'fast' ? 1 : 0),
        lastSeen: reviewedAt,
        lastOutcome: grade,
        halfLifeH: 9 * next.s * 24,
        fsrs: next,
      };

      const factorCorrect = [...params.factorCorrect];
      if (correct) {
        const [a, b] = parseFactKey(attempt.fact);
        factorCorrect[a]! += 1;
        if (a !== b) factorCorrect[b]! += 1;
      }
      let rt = params.rt;
      if (attempt.correct && attempt.answer !== null) {
        const logRt = Math.log(Math.max(200, responseTimeMs(attempt)));
        const b = rt[attempt.engine];
        state = {
          ...state,
          ...updateFactLatency(state, logRt - b.mu, orientation(attempt.a, attempt.b)),
        };
        rt = { ...rt, [attempt.engine]: updateBaseline(b, logRt) };
      }
      return {
        state,
        params: { ...params, factorCorrect, rt, steps: params.steps + 1, updatedAt: reviewedAt },
      };
    },
  };
}

export const FSRS_MODEL = createFsrsModel();
