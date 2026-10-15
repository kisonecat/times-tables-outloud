import type { Attempt, EngineKind, FactState, ModelParams } from '../data/schema';
import { parseFactKey } from './facts';
import { features } from './features';
import { GRADE_RECALL, responseTimeMs } from './grading';
import {
  fitPrior,
  halfLife,
  HISTORY_PRIOR,
  HLR_DEFAULTS,
  recall,
  sgdStep,
  type HistoryPrior,
} from './hlr';
import { orientation, RT_PRIOR, updateBaseline, updateFactLatency } from './latency';
import { combineRecall, shortTermRecall } from './shortTerm';
import type { Grade, Recall } from './types';

/** Swappable memory model (PLAN §8.7). An FSRS model could implement the same shape. */
export interface MemoryModel {
  version: string;
  /** Parameters for a learner with no history. */
  init(learnerId: string): ModelParams;
  predict(fact: string, now: number, state: FactState | undefined, params: ModelParams): Recall;
  update(
    attempt: Attempt,
    grade: Grade,
    state: FactState | undefined,
    params: ModelParams,
  ): { state: FactState; params: ModelParams };
}

const HOUR = 3_600_000;

export function emptyFactState(learnerId: string, fact: string): FactState {
  return {
    learnerId,
    fact,
    nCorrect: 0,
    nWrong: 0,
    nFast: 0,
    lastSeen: 0,
    halfLifeH: 0,
    rtLogMean: 0,
    rtLogVar: 0,
    rtN: 0,
    rtOrient: 0,
    lastOutcome: 'fail',
  };
}

const seen = (s: FactState | undefined): s is FactState => !!s && s.nCorrect + s.nWrong > 0;

/** HLR + working memory + latency model. Options exist for evaluating alternatives. */
export function createHlrModel({
  version = 'hlr-1',
  historyPrior = HISTORY_PRIOR,
  hlr = HLR_DEFAULTS,
}: { version?: string; historyPrior?: HistoryPrior; hlr?: typeof HLR_DEFAULTS } = {}): MemoryModel {
  const thetaPrior = fitPrior(historyPrior);
  return {
    version,

    init(learnerId) {
      return {
        learnerId,
        theta: [...thetaPrior],
        version,
        updatedAt: 0,
        steps: 0,
        factorCorrect: new Array<number>(13).fill(0),
        rt: structuredClone(RT_PRIOR) as Record<EngineKind, ModelParams['rt'][EngineKind]>,
      };
    },

    predict(fact, now, state, params) {
      const h = halfLife(params.theta, features(fact, state, params));
      if (!seen(state)) return { pLong: 0.5, pNow: 0.5, pShort: 0, halfLifeH: h, unseen: true };
      const pLong = recall((now - state.lastSeen) / HOUR, h);
      const pShort = shortTermRecall((now - state.lastSeen) / 1000);
      return { pLong, pNow: combineRecall(pLong, pShort), pShort, halfLifeH: h, unseen: false };
    },

    update(attempt, grade, prev, params) {
      const reviewedAt = attempt.shownAt + attempt.commitMs;
      const x = features(attempt.fact, prev, params);
      let theta = params.theta;
      let steps = params.steps;
      // Online fit: one SGD step against the prediction made before this attempt. A first
      // exposure has no previous review to measure forgetting from, so it doesn't train θ.
      if (seen(prev)) {
        const deltaH = Math.max(0, attempt.shownAt - prev.lastSeen) / HOUR;
        theta = sgdStep(theta, thetaPrior, x, deltaH, GRADE_RECALL[grade], steps, hlr);
        steps += 1;
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

      const next: ModelParams = {
        ...params,
        theta,
        steps,
        factorCorrect,
        rt,
        updatedAt: reviewedAt,
      };
      state.halfLifeH = halfLife(theta, features(attempt.fact, state, next));
      return { state, params: next };
    },
  };
}

export const HLR_MODEL: MemoryModel = createHlrModel();

export function initialParams(learnerId: string, model: MemoryModel = HLR_MODEL): ModelParams {
  return model.init(learnerId);
}
