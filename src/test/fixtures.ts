import { NO_PREDICTION, type Attempt } from '../data/schema';
import { factKey } from '../learning/facts';

export const T0 = Date.UTC(2026, 0, 5, 16);

/** A right answer to a × b, spoken 1.2 s after legibility; override anything. */
export function attempt(over: Partial<Attempt> & { a: number; b: number }): Attempt {
  const { a, b } = over;
  return {
    id: Math.random().toString(36).slice(2),
    learnerId: 'L',
    sessionId: 'S',
    seq: 0,
    fact: factKey(a, b),
    shownAt: T0,
    onsetMs: 1200,
    commitMs: 1800,
    engine: 'web-speech',
    transcript: String(a * b),
    answer: a * b,
    correct: true,
    ttsUsed: false,
    selectionReason: 'due',
    pred: NO_PREDICTION,
    ...over,
  };
}
