/**
 * Working memory (PLAN §8.4). HLR is coarse at minute scales: a fact asked 30 s ago is
 * remembered because it's still in mind, not because it's learned.
 */
export const SHORT_TERM_TAU_S = 90;

export function shortTermRecall(secondsSince: number, tau = SHORT_TERM_TAU_S): number {
  return Math.exp(-Math.max(0, secondsSince) / tau);
}

/** p_now = 1 − (1 − p_long)(1 − p_short): right if either memory delivers. */
export function combineRecall(pLong: number, pShort: number): number {
  return 1 - (1 - pLong) * (1 - pShort);
}
