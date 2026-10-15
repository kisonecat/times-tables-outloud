import {
  NO_PREDICTION,
  type Attempt,
  type EngineKind,
  type Prediction,
  type SessionLength,
} from '../../data/schema';
import type { Problem } from '../../learning/types';

export { responseTimeMs } from '../../learning/grading';

/**
 * How long feedback stays up before the next card deals in, unless the learner skips
 * ahead. The live values come from the --hold-* motion tokens; these are fallbacks.
 * With ≈200 ms of deal-in before the next card is legible, a right answer turns around
 * in about 600 ms (≤ 750 ms is the budget).
 */
export const FEEDBACK_MS = { correct: 350, miss: 2500 } as const;

/** A typed entry as a number, or null if it isn't one. */
export function parseTyped(text: string): number | null {
  const digits = text.trim();
  return /^\d{1,4}$/.test(digits) ? Number(digits) : null;
}

export function isSessionOver(length: SessionLength, answered: number, elapsedMs: number): boolean {
  return length.kind === 'problems' ? answered >= length.value : elapsedMs >= length.value * 60_000;
}

export interface AttemptTiming {
  /** performance.now() when the problem became legible. */
  legiblePerf: number;
  /** performance.now() of the first keystroke / speech onset, if any. */
  onsetPerf: number | null;
  /** performance.now() when the answer was committed. */
  commitPerf: number;
  /** performance.timeOrigin, injectable for tests. */
  timeOrigin: number;
}

export function buildAttempt(args: {
  id: string;
  learnerId: string;
  sessionId: string;
  seq: number;
  problem: Problem;
  timing: AttemptTiming;
  engine: EngineKind;
  transcript: string;
  answer: number | null;
  ttsUsed: boolean;
  /** The model's prediction, made before the attempt. */
  pred?: Prediction;
}): Attempt {
  const { problem, timing } = args;
  return {
    id: args.id,
    learnerId: args.learnerId,
    sessionId: args.sessionId,
    seq: args.seq,
    a: problem.a,
    b: problem.b,
    fact: problem.fact,
    shownAt: Math.round(timing.timeOrigin + timing.legiblePerf),
    // Typing ahead of the legibility mark counts as onset at legibility, never negative.
    onsetMs:
      timing.onsetPerf === null
        ? null
        : Math.max(0, Math.round(timing.onsetPerf - timing.legiblePerf)),
    commitMs: Math.round(timing.commitPerf - timing.legiblePerf),
    engine: args.engine,
    transcript: args.transcript,
    answer: args.answer,
    correct: args.answer === problem.a * problem.b,
    ttsUsed: args.ttsUsed,
    selectionReason: problem.reason,
    pred: args.pred ?? { ...NO_PREDICTION },
  };
}
