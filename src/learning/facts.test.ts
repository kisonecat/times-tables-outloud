import { describe, expect, it } from 'vitest';
import { ALL_TABLES, factKey, factsForTables, parseFactKey } from './facts';
import { pickRandom } from './scheduler';

describe('facts', () => {
  it('keys are unordered, smaller first', () => {
    expect(factKey(8, 7)).toBe('7x8');
    expect(factKey(7, 8)).toBe('7x8');
    expect(parseFactKey('7x8')).toEqual([7, 8]);
  });

  it('has 78 unordered facts for 1–12', () => {
    expect(factsForTables(ALL_TABLES)).toHaveLength(78);
  });

  it('dedupes mirrored facts across chosen tables', () => {
    // ×2 and ×5 each have 12 facts and share 2x5.
    expect(factsForTables([2, 5])).toHaveLength(23);
  });
});

describe('pickRandom', () => {
  it('only picks facts from the chosen tables and never repeats immediately', () => {
    let last: string[] = [];
    for (let i = 0; i < 500; i++) {
      const p = pickRandom([7], last);
      expect(p.a === 7 || p.b === 7).toBe(true);
      expect(p.fact).toBe(factKey(p.a, p.b));
      expect(p.fact).not.toBe(last[0]);
      last = [p.fact];
    }
  });
});
