import { ALL_TABLES, factsForTables } from './facts';
import { F, N_FEATURES, staticFeatures } from './features';
import { priorHalfLifeH } from './priors';

/**
 * Half-life regression (Settles & Meeder 2016): recall after Δ hours is p = 2^(−Δ/h),
 * with half-life h = 2^(θ·x) hours.
 */

export const MIN_HALF_LIFE_H = 0.25;
export const MAX_HALF_LIFE_H = 180 * 24;

export const HLR_DEFAULTS = {
  /** Weight of the half-life term in the loss. */
  alpha: 0.01,
  /** Pull toward θ_prior (not toward zero), so little data still behaves sensibly. */
  lambda: 0.1,
  learningRate: 0.001,
  /** lr_t = lr / sqrt(1 + t / decaySteps). */
  decaySteps: 2000,
};

const LN2 = Math.LN2;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const dot = (a: readonly number[], b: readonly number[]) =>
  a.reduce((s, ai, i) => s + ai * b[i]!, 0);

export function halfLife(theta: readonly number[], x: readonly number[]): number {
  return clamp(2 ** dot(theta, x), MIN_HALF_LIFE_H, MAX_HALF_LIFE_H);
}

export function recall(deltaH: number, halfLifeH: number): number {
  return 2 ** (-Math.max(0, deltaH) / halfLifeH);
}

/**
 * One SGD step on L = (p_obs − p̂)² + α·(log₂h_obs − log₂ĥ)² + λ‖θ − θ_prior‖², using the
 * prediction made before the attempt. The half-life term is in log₂ space: in raw hours
 * (as in PLAN §8.3) a single fast answer after a long gap gives h_obs of thousands of
 * hours, and the step blows θ away. Same minimizer shape, sane gradients.
 */
export function sgdStep(
  theta: readonly number[],
  thetaPrior: readonly number[],
  x: readonly number[],
  deltaH: number,
  pObs: number,
  step: number,
  opts = HLR_DEFAULTS,
): number[] {
  const z = dot(theta, x);
  const h = clamp(2 ** z, MIN_HALF_LIFE_H, MAX_HALF_LIFE_H);
  const p = recall(deltaH, h);
  const hObs = clamp(
    -deltaH / Math.log2(clamp(pObs, 0.0001, 0.9999)),
    MIN_HALF_LIFE_H,
    MAX_HALF_LIFE_H,
  );
  // d/dz of each term (z = θ·x = log₂ ĥ, so dĥ/dz = ĥ·ln2 and dp̂/dz = p̂·ln²2·Δ/ĥ).
  const dP = 2 * (p - pObs) * p * LN2 * LN2 * (deltaH / h);
  const dH = 2 * opts.alpha * (Math.log2(h) - Math.log2(hObs));
  const g = Number.isFinite(dP + dH) ? clamp(dP + dH, -5, 5) : 0;
  const lr = opts.learningRate / Math.sqrt(1 + step / opts.decaySteps);
  return theta.map((t, i) => t - lr * (g * x[i]! + 2 * opts.lambda * (t - thetaPrior[i]!)));
}

/**
 * θ_prior: hand-set weights for the history features, and the fact-difficulty weights
 * fitted (ridge least squares) so a new learner's half-lives match the priors: ~2 days
 * for ×1/×2/×5/×10, ~2 hours for 6×7, 7×8 and friends.
 */
export const HISTORY_PRIOR: Partial<Record<keyof typeof F, number>> = {
  // Chosen by log loss on simulated learners (learning/simulate.ts): each answer counts
  // modestly (massed repeats inflate counts), and how the last answer went counts a lot.
  sqrtCorrect: 0.3,
  sqrtWrong: -0.3,
  sqrtFast: 0.3,
  sqrtTransfer: 0,
  lastFail: -1,
  lastSlow: -0.3,
  lastOk: 0,
  lastFast: 0.5,
};

export type HistoryPrior = Partial<Record<keyof typeof F, number>>;

export function fitPrior(history: HistoryPrior = HISTORY_PRIOR): number[] {
  const theta = new Array<number>(N_FEATURES).fill(0);
  for (const [k, v] of Object.entries(history)) theta[F[k as keyof typeof F]] = v;
  // With zero history every √(1+n) feature is 1, so they add a constant to log₂ h.
  const historyAtZero =
    theta[F.sqrtCorrect]! + theta[F.sqrtWrong]! + theta[F.sqrtFast]! + theta[F.sqrtTransfer]!;
  const cols = [
    'bias',
    'isSquare',
    'has1',
    'has2',
    'has5',
    'has10',
    'has11',
    'maxOver12',
    'logProduct',
    'hardZone',
  ] as const;
  const rows = factsForTables(ALL_TABLES).map((fact) => {
    const x = new Array<number>(N_FEATURES).fill(0);
    staticFeatures(fact, x);
    return { x: cols.map((c) => x[F[c]]!), y: Math.log2(priorHalfLifeH(fact)) - historyAtZero };
  });
  const w = ridge(
    rows.map((r) => r.x),
    rows.map((r) => r.y),
    0.01,
  );
  cols.forEach((c, i) => (theta[F[c]] = w[i]!));
  return theta;
}

/** Solve (XᵀX + εI)w = Xᵀy by Gaussian elimination. Tiny systems only. */
export function ridge(X: number[][], y: number[], eps: number): number[] {
  const n = X[0]!.length;
  const A = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) =>
      j < n
        ? X.reduce((s, r) => s + r[i]! * r[j]!, 0) + (i === j ? eps : 0)
        : X.reduce((s, r, k) => s + r[i]! * y[k]!, 0),
    ),
  );
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r]![c]!) > Math.abs(A[piv]![c]!)) piv = r;
    [A[c], A[piv]] = [A[piv]!, A[c]!];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = A[r]![c]! / A[c]![c]!;
      for (let k = c; k <= n; k++) A[r]![k]! -= f * A[c]![k]!;
    }
  }
  return A.map((row, i) => row[n]! / row[i]!);
}

export const THETA_PRIOR: readonly number[] = Object.freeze(fitPrior());
