import { parseFactKey } from './facts';

/** The classic hard zone (PLAN §8.3): these start with short half-lives. */
export const HARD_ZONE: ReadonlySet<string> = new Set(['6x7', '7x8', '6x8', '8x8', '7x7']);

/**
 * Prior difficulty of a fact, 0 (easiest) to 1 (hardest), before any data: ×1, ×10, ×2
 * and ×5 are easy; the 6–8 zone is hardest; otherwise difficulty grows with the factors.
 */
export function priorDifficulty(fact: string): number {
  if (HARD_ZONE.has(fact)) return 1;
  const [x, y] = parseFactKey(fact);
  if (x === 1) return 0;
  if (y === 10 || x === 10) return 0.05;
  if (x === 2) return 0.12;
  if (x === 5 || y === 5) return 0.2;
  if (y === 11 && x <= 9) return 0.25;
  let d = 0.25 + (0.6 * (x - 3 + (y - 3))) / 18;
  if (x === y) d -= 0.1;
  return Math.min(0.95, Math.max(0, d));
}

const EASY_H = 48;
const HARD_H = 2;

/** Prior half-life in hours: ~2 days for the easiest facts, ~2 hours for the hardest. */
export function priorHalfLifeH(fact: string): number {
  const d = priorDifficulty(fact);
  return 2 ** (Math.log2(EASY_H) + d * (Math.log2(HARD_H) - Math.log2(EASY_H)));
}

/** Prior log-RT offset from the learner's baseline: hard facts are slower to recall. */
export function priorRtOffset(fact: string): number {
  return (priorDifficulty(fact) - 0.4) * 0.6;
}

/** Facts in the order to introduce them: easiest first. */
export function byPriorDifficulty(facts: readonly string[]): string[] {
  return [...facts].sort((p, q) => priorDifficulty(p) - priorDifficulty(q) || (p < q ? -1 : 1));
}
