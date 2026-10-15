export type Grade = 'fail' | 'slow' | 'ok' | 'fast';

export type SelectionReason = 'due' | 'new' | 'retry' | 'speed' | 'explore' | 'random';

/** A problem as displayed. `a` and `b` keep display order; `fact` is the unordered key. */
export interface Problem {
  a: number;
  b: number;
  fact: string;
  reason: SelectionReason;
}

/** The model's view of a fact right now (PLAN §8.3–8.4). */
export interface Recall {
  /** Long-term recall: "is it learned?" */
  pLong: number;
  /** Including working memory: "will they get it right now?" */
  pNow: number;
  /** Recall from working memory alone. */
  pShort: number;
  halfLifeH: number;
  /** No attempts yet: recall is unknown (p = 0.5). */
  unseen: boolean;
}
