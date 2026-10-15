import type { Attempt } from '../data/schema';
import { BASE_TARGET_MS, fluencyTarget, grade, GRADE_RECALL } from './grading';
import { HLR_MODEL, type MemoryModel } from './model';
import type { FactState, ModelParams } from '../data/schema';

/** Offline metrics for "is the model actually predictive?" (PLAN §8.8). */

const EPS = 1e-6;

/** Cross-entropy; labels may be soft (graded recall: slow = 0.6, ok = 0.85…). */
export function logLoss(ps: readonly number[], ys: readonly (boolean | number)[]): number {
  if (!ps.length) return NaN;
  let s = 0;
  ps.forEach((p, i) => {
    const q = Math.min(1 - EPS, Math.max(EPS, p));
    const y = Number(ys[i]);
    s += -(y * Math.log(q) + (1 - y) * Math.log(1 - q));
  });
  return s / ps.length;
}

/** Area under the ROC curve: the chance a random right answer was predicted higher than a random miss. */
export function auc(ps: readonly number[], ys: readonly (boolean | number)[]): number {
  // AUC needs binary labels: a soft label counts as positive at ≥ 0.5.
  ys = ys.map((y) => Number(y) >= 0.5);
  const pos = ps.filter((_, i) => ys[i]);
  const neg = ps.filter((_, i) => !ys[i]);
  if (!pos.length || !neg.length) return NaN;
  // Rank-based (Mann–Whitney U), with ties counted half.
  const all = ps.map((p, i) => ({ p, y: ys[i]! })).sort((x, y) => x.p - y.p);
  let rankSum = 0;
  for (let i = 0; i < all.length;) {
    let j = i;
    while (j < all.length && all[j]!.p === all[i]!.p) j++;
    const avgRank = (i + 1 + j) / 2;
    for (let k = i; k < j; k++) if (all[k]!.y) rankSum += avgRank;
    i = j;
  }
  return (rankSum - (pos.length * (pos.length + 1)) / 2) / (pos.length * neg.length);
}

export interface CalibrationBin {
  /** Mean predicted recall in the bin. */
  predicted: number;
  /** Fraction actually right. */
  observed: number;
  n: number;
}

/** Reliability diagram data: predictions bucketed into deciles of predicted recall. */
export function calibration(
  ps: readonly number[],
  ys: readonly (boolean | number)[],
  bins = 10,
): CalibrationBin[] {
  const out = Array.from({ length: bins }, () => ({ sp: 0, sy: 0, n: 0 }));
  ps.forEach((p, i) => {
    const b = out[Math.min(bins - 1, Math.floor(p * bins))]!;
    b.sp += p;
    b.sy += Number(ys[i]);
    b.n += 1;
  });
  return out
    .filter((b) => b.n > 0)
    .map((b) => ({ predicted: b.sp / b.n, observed: b.sy / b.n, n: b.n }));
}

export interface Metrics {
  n: number;
  logLoss: number;
  auc: number;
  calibration: CalibrationBin[];
}

export function metrics(ps: readonly number[], ys: readonly (boolean | number)[]): Metrics {
  return {
    n: ps.length,
    logLoss: logLoss(ps, ys),
    auc: auc(ps, ys),
    calibration: calibration(ps, ys),
  };
}

/** Anything that can predict an attempt from the past, then learn from it. */
export interface OnlinePredictor {
  predict(attempt: Attempt): number;
  learn(attempt: Attempt): void;
}

/** The memory model, replayed online: p_now for each attempt from what came before. */
export function modelPredictor(learnerId: string, model: MemoryModel = HLR_MODEL): OnlinePredictor {
  const states = new Map<string, FactState>();
  let params: ModelParams = model.init(learnerId);
  return {
    predict: (a) => model.predict(a.fact, a.shownAt, states.get(a.fact), params).pNow,
    learn: (a) => {
      const next = model.update(
        a,
        grade(a, fluencyTarget(a.engine, params)),
        states.get(a.fact),
        params,
      );
      states.set(a.fact, next.state);
      params = next.params;
    },
  };
}

/**
 * What "observed recall" means for an attempt: plain right/wrong, or graded recall
 * (fast 1, ok 0.85, slow 0.6, fail 0) — the quantity the memory model is trained on.
 */
export type Label = 'correct' | 'graded';

export function observed(a: Attempt, label: Label): number {
  return label === 'correct' ? Number(a.correct) : GRADE_RECALL[grade(a, BASE_TARGET_MS[a.engine])];
}

/** Baseline: each fact's running mean of the label so far, with a Laplace-style prior. */
export function accuracyBaseline(label: Label = 'correct'): OnlinePredictor {
  const seen = new Map<string, { sum: number; n: number }>();
  return {
    predict: (a) => {
      const s = seen.get(a.fact) ?? { sum: 0, n: 0 };
      return (s.sum + 1) / (s.n + 2);
    },
    learn: (a) => {
      const s = seen.get(a.fact) ?? { sum: 0, n: 0 };
      seen.set(a.fact, { sum: s.sum + observed(a, label), n: s.n + 1 });
    },
  };
}

/**
 * Time-ordered replay of a log through several predictors: each attempt is predicted
 * from everything before it, then learned. Optionally score only the last `lastN`.
 */
export function evaluateLog(
  attempts: readonly Attempt[],
  predictors: Record<string, OnlinePredictor>,
  { lastN, label = 'correct' }: { lastN?: number; label?: Label } = {},
): Record<string, Metrics> {
  const ordered = [...attempts].sort((x, y) => x.shownAt - y.shownAt);
  const from = lastN ? Math.max(0, ordered.length - lastN) : 0;
  const preds = Object.fromEntries(Object.keys(predictors).map((k) => [k, [] as number[]]));
  const ys: number[] = [];
  ordered.forEach((a, i) => {
    for (const [k, p] of Object.entries(predictors)) {
      if (i >= from) preds[k]!.push(p.predict(a));
      p.learn(a);
    }
    if (i >= from) ys.push(observed(a, label));
  });
  return Object.fromEntries(Object.entries(preds).map(([k, ps]) => [k, metrics(ps, ys)]));
}

/** Calibration of the predictions actually logged with each attempt (for Analytics). */
export function loggedPredictionMetrics(
  attempts: readonly Attempt[],
  { lastN = 500, label = 'graded' }: { lastN?: number; label?: Label } = {},
): Metrics {
  const recent = [...attempts]
    .filter((a) => a.pred.modelVersion !== 'none')
    .sort((x, y) => x.shownAt - y.shownAt)
    .slice(-lastN);
  return metrics(
    recent.map((a) => a.pred.pRecall),
    recent.map((a) => observed(a, label)),
  );
}
