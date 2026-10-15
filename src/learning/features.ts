import type { FactState, ModelParams } from '../data/schema';
import { parseFactKey } from './facts';
import { HARD_ZONE } from './priors';
import type { Grade } from './types';

/** Feature order for HLR's θ. Changing it means bumping the model version. */
export const FEATURES = [
  'bias',
  'sqrtCorrect',
  'sqrtWrong',
  'sqrtFast',
  'sqrtTransfer',
  'isSquare',
  'has1',
  'has2',
  'has5',
  'has10',
  'has11',
  'maxOver12',
  'logProduct',
  'hardZone',
  'lastFail',
  'lastSlow',
  'lastOk',
  'lastFast',
] as const;

export type FeatureName = (typeof FEATURES)[number];
export const N_FEATURES = FEATURES.length;
export const F = Object.fromEntries(FEATURES.map((f, i) => [f, i])) as Record<FeatureName, number>;

const LAST: Record<Grade, FeatureName> = {
  fail: 'lastFail',
  slow: 'lastSlow',
  ok: 'lastOk',
  fast: 'lastFast',
};

/** Correct answers on other facts that share a factor with this one (transfer within a table). */
export function transferCount(fact: string, nCorrect: number, factorCorrect: readonly number[]) {
  const [a, b] = parseFactKey(fact);
  const shared =
    a === b ? factorCorrect[a]! - nCorrect : factorCorrect[a]! + factorCorrect[b]! - 2 * nCorrect;
  return Math.max(0, shared);
}

/** Facts' own (count-free) features: the prior-difficulty part of x. */
export function staticFeatures(fact: string, x: number[]) {
  const [a, b] = parseFactKey(fact);
  const has = (k: number) => (a === k || b === k ? 1 : 0);
  x[F.bias] = 1;
  x[F.isSquare] = a === b ? 1 : 0;
  x[F.has1] = has(1);
  x[F.has2] = has(2);
  x[F.has5] = has(5);
  x[F.has10] = has(10);
  x[F.has11] = has(11);
  x[F.maxOver12] = Math.max(a, b) / 12;
  x[F.logProduct] = Math.log(a * b) / Math.log(144);
  // The classic hard zone (PLAN §8.3): 6×7, 7×8, 6×8, 7×7, 8×8.
  x[F.hardZone] = HARD_ZONE.has(fact) ? 1 : 0;
}

/** The feature vector x for a fact at the moment of prediction (PLAN §8.3). */
export function features(
  fact: string,
  state: FactState | undefined,
  params: Pick<ModelParams, 'factorCorrect'>,
): number[] {
  const x = new Array<number>(N_FEATURES).fill(0);
  staticFeatures(fact, x);
  const nC = state?.nCorrect ?? 0;
  x[F.sqrtCorrect] = Math.sqrt(1 + nC);
  x[F.sqrtWrong] = Math.sqrt(1 + (state?.nWrong ?? 0));
  x[F.sqrtFast] = Math.sqrt(1 + (state?.nFast ?? 0));
  x[F.sqrtTransfer] = Math.sqrt(1 + transferCount(fact, nC, params.factorCorrect));
  if (state && state.nCorrect + state.nWrong > 0) x[F[LAST[state.lastOutcome]]] = 1;
  return x;
}
