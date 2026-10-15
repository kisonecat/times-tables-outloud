/** Streak milestones that get a bigger celebration: 5, 10, 20, then every 10. */
export function isMilestone(streak: number): boolean {
  return streak === 5 || streak === 10 || (streak >= 20 && streak % 10 === 0);
}

/**
 * The stretch of the meter the streak is in: from the last milestone to the next. On a
 * milestone it's the stretch just completed, so the meter shows full at the celebration.
 */
export function streakTier(streak: number): { from: number; to: number } {
  const s = Math.max(0, streak - 1);
  if (s < 5) return { from: 0, to: 5 };
  if (s < 10) return { from: 5, to: 10 };
  const from = Math.floor(s / 10) * 10;
  return { from, to: from + 10 };
}
