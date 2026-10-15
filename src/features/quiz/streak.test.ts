import { describe, expect, it } from 'vitest';
import { isMilestone, streakTier } from './streak';

describe('streak', () => {
  it('celebrates 5, 10, 20, 30…', () => {
    const hits = Array.from({ length: 45 }, (_, i) => i + 1).filter(isMilestone);
    expect(hits).toEqual([5, 10, 20, 30, 40]);
  });

  it('fills the meter toward the next milestone', () => {
    expect(streakTier(0)).toEqual({ from: 0, to: 5 });
    expect(streakTier(4)).toEqual({ from: 0, to: 5 });
    expect(streakTier(5)).toEqual({ from: 0, to: 5 }); // full at the milestone
    expect(streakTier(6)).toEqual({ from: 5, to: 10 });
    expect(streakTier(12)).toEqual({ from: 10, to: 20 });
    expect(streakTier(20)).toEqual({ from: 10, to: 20 });
    expect(streakTier(21)).toEqual({ from: 20, to: 30 });
  });
});
