import { describe, expect, it } from 'vitest';
import { judge, type Heard } from './judge';

const h = (text: string, final = true, alts: string[] = []): Heard => ({ text, alts, final });

describe('judge (7 × 8)', () => {
  it('commits a correct final answer', () => {
    expect(judge(h('fifty six'), 7, 8)).toEqual({ kind: 'commit', answer: 56, correct: true });
    expect(judge(h('seven times eight is fifty six'), 7, 8)).toMatchObject({ correct: true });
  });

  it('accepts a correct interim answer immediately when it cannot grow', () => {
    expect(judge(h('fifty six', false), 7, 8)).toEqual({
      kind: 'commit',
      answer: 56,
      correct: true,
    });
  });

  it('waits on an interim match that may still be growing', () => {
    // 6 × 10 = 60, and "sixty" might become "sixty four"
    expect(judge(h('sixty', false), 6, 10)).toEqual({ kind: 'pending', answer: 60, waitMs: 600 });
    // 1 × 1 = 1, and "one" might become "one hundred…"
    expect(judge(h('one', false), 1, 1)).toMatchObject({ kind: 'pending' });
  });

  it('does not wait on a final transcript even if it could grow', () => {
    expect(judge(h('sixty'), 6, 10)).toMatchObject({ kind: 'commit', correct: true });
  });

  it('with a "settled" flag, commits a right interim answer only once the speaker pauses', () => {
    const interim = (text: string, settled: boolean) => ({ ...h(text, false), settled });
    expect(judge(interim('60', false), 6, 10)).toEqual({ kind: 'interim', value: 60 });
    expect(judge(interim('60', true), 6, 10)).toEqual({
      kind: 'commit',
      answer: 60,
      correct: true,
    });
    // A wrong interim never commits, settled or not: the final transcript decides.
    expect(judge(interim('54', true), 7, 8)).toEqual({ kind: 'interim', value: 54 });
  });

  it('accepts a match from an alternative', () => {
    expect(judge(h('fifty sticks', true, ['fifty six']), 7, 8)).toMatchObject({ correct: true });
  });

  it('shows interim numbers without committing', () => {
    expect(judge(h('forty', false), 7, 8)).toEqual({ kind: 'interim', value: 40 });
    expect(judge(h('um', false), 7, 8)).toEqual({ kind: 'listen' });
  });

  it('commits the last number of a wrong final answer as a miss', () => {
    expect(judge(h('fifty four'), 7, 8)).toEqual({ kind: 'commit', answer: 54, correct: false });
    expect(judge(h('seven times eight is forty eight'), 7, 8)).toEqual({
      kind: 'commit',
      answer: 48,
      correct: false,
    });
  });

  it('ignores the learner reading the question back, in either order', () => {
    expect(judge(h('seven times eight'), 7, 8)).toEqual({ kind: 'readback' });
    expect(judge(h('eight times seven'), 7, 8)).toEqual({ kind: 'readback' });
  });

  it('asks for just the number when a final transcript has none', () => {
    expect(judge(h('Thank you.'), 7, 8)).toEqual({ kind: 'say-number' });
    expect(judge(h(''), 7, 8)).toEqual({ kind: 'listen' });
  });
});
