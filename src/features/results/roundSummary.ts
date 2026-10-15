import type { Attempt } from '../../data/schema';
import { factKey } from '../../learning/facts';
import { median } from '../../lib/stats';
import { responseTimeMs } from '../../learning/grading';

export type CellResult = 'good' | 'miss' | 'mixed';

export interface RoundSummary {
  total: number;
  correct: number;
  medianRtMs: number | null;
  /** Facts missed at least once, most-missed first. */
  revisit: string[];
  /** Outcome per unordered fact; mirrored grid cells share it. */
  cells: Map<string, CellResult>;
}

export function summarizeRound(attempts: readonly Attempt[]): RoundSummary {
  const byFact = new Map<string, Attempt[]>();
  for (const a of attempts) byFact.set(a.fact, [...(byFact.get(a.fact) ?? []), a]);

  const cells = new Map<string, CellResult>();
  const misses: [string, number][] = [];
  for (const [fact, list] of byFact) {
    const nMiss = list.filter((a) => !a.correct).length;
    cells.set(fact, nMiss === 0 ? 'good' : nMiss === list.length ? 'miss' : 'mixed');
    if (nMiss) misses.push([fact, nMiss]);
  }

  return {
    total: attempts.length,
    correct: attempts.filter((a) => a.correct).length,
    medianRtMs: median(attempts.filter((a) => a.correct).map(responseTimeMs)),
    revisit: misses.sort((x, y) => y[1] - x[1]).map(([f]) => f),
    cells,
  };
}

export function cellFor(cells: Map<string, CellResult>, a: number, b: number) {
  return cells.get(factKey(a, b));
}
