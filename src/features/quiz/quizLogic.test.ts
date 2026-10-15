import { describe, expect, it } from 'vitest';
import { buildAttempt, isSessionOver, parseTyped, responseTimeMs } from './quizLogic';

describe('parseTyped', () => {
  it('accepts plain digits', () => {
    expect(parseTyped('56')).toBe(56);
    expect(parseTyped(' 144 ')).toBe(144);
  });
  it('rejects empty and non-numeric', () => {
    expect(parseTyped('')).toBeNull();
    expect(parseTyped('5a')).toBeNull();
    expect(parseTyped('-4')).toBeNull();
  });
});

describe('isSessionOver', () => {
  it('counts problems', () => {
    expect(isSessionOver({ kind: 'problems', value: 20 }, 19, 1e9)).toBe(false);
    expect(isSessionOver({ kind: 'problems', value: 20 }, 20, 0)).toBe(true);
  });
  it('counts minutes', () => {
    expect(isSessionOver({ kind: 'minutes', value: 5 }, 100, 299_999)).toBe(false);
    expect(isSessionOver({ kind: 'minutes', value: 5 }, 0, 300_000)).toBe(true);
  });
});

describe('buildAttempt', () => {
  const base = {
    id: 'a1',
    learnerId: 'L',
    sessionId: 'S',
    seq: 3,
    problem: { a: 8, b: 7, fact: '7x8', reason: 'random' as const },
    timing: {
      legiblePerf: 1000.4,
      onsetPerf: 2200.2,
      commitPerf: 2900.9,
      timeOrigin: 1_700_000_000_000,
    },
    engine: 'typed' as const,
    transcript: '56',
    answer: 56,
    ttsUsed: false,
  };

  it('times everything from legibility', () => {
    const a = buildAttempt(base);
    expect(a.shownAt).toBe(1_700_000_001_000);
    expect(a.onsetMs).toBe(1200);
    expect(a.commitMs).toBe(1901);
    expect(responseTimeMs(a)).toBe(1200);
  });

  it('keeps display order and the unordered key', () => {
    const a = buildAttempt(base);
    expect([a.a, a.b, a.fact]).toEqual([8, 7, '7x8']);
    expect(a.correct).toBe(true);
    expect(a.selectionReason).toBe('random');
  });

  it('clamps onset to legibility when typing started early', () => {
    const a = buildAttempt({ ...base, timing: { ...base.timing, onsetPerf: 900 } });
    expect(a.onsetMs).toBe(0);
  });

  it('marks wrong and skipped answers incorrect', () => {
    expect(buildAttempt({ ...base, answer: 54 }).correct).toBe(false);
    const skipped = buildAttempt({
      ...base,
      answer: null,
      transcript: '',
      timing: { ...base.timing, onsetPerf: null },
    });
    expect(skipped.correct).toBe(false);
    expect(skipped.onsetMs).toBeNull();
    expect(responseTimeMs(skipped)).toBe(1901);
  });
});
