import { mayContinue, parseNumbers } from './parseNumbers';

export interface Heard {
  text: string;
  alts: readonly string[];
  final: boolean;
  /** Interim only: the speaker had paused (see EngineEvent). Undefined if unknown. */
  settled?: boolean;
}

/** How long an interim match that may still be growing ("forty…") waits for more speech. */
export const CONTINUE_WAIT_MS = 600;

export type Verdict =
  /** Nothing usable yet; keep listening. */
  | { kind: 'listen' }
  /** Mid-utterance number to show in the slot while still listening. */
  | { kind: 'interim'; value: number }
  /** Correct, but the speaker may be mid-number: accept after `waitMs` unless more speech arrives. */
  | { kind: 'pending'; answer: number; waitMs: number }
  /** The learner's answer. */
  | { kind: 'commit'; answer: number; correct: boolean }
  /** They read the question back ("seven times eight"); keep listening. */
  | { kind: 'readback' }
  /** A final transcript with no number in it. */
  | { kind: 'say-number' };

/**
 * Judge one transcript event for the problem a × b (PLAN §5). Pure: the caller owns the
 * pending timer and decides what to do with each verdict.
 */
export function judge(heard: Heard, a: number, b: number, lang = 'en'): Verdict {
  const product = a * b;

  for (const t of [heard.text, ...heard.alts]) {
    if (parseNumbers(t, lang).at(-1) === product) {
      if (heard.final || heard.settled === true) {
        return { kind: 'commit', answer: product, correct: true };
      }
      // Still mid-utterance and the engine knows it: show it, but let them finish.
      // (Whisper writes digits, so "sixty" can't be told from the start of "sixty-four".)
      if (heard.settled === false) return { kind: 'interim', value: product };
      return mayContinue(t, lang)
        ? { kind: 'pending', answer: product, waitMs: CONTINUE_WAIT_MS }
        : { kind: 'commit', answer: product, correct: true };
    }
  }

  const nums = parseNumbers(heard.text, lang);
  const last = nums.at(-1);
  if (!heard.final)
    return last === undefined ? { kind: 'listen' } : { kind: 'interim', value: last };
  if (last === undefined) return heard.text.trim() ? { kind: 'say-number' } : { kind: 'listen' };

  if (nums.length >= 2) {
    const [x, y] = nums.slice(-2).sort((p, q) => p - q);
    if (x === Math.min(a, b) && y === Math.max(a, b)) return { kind: 'readback' };
  }
  return { kind: 'commit', answer: last, correct: false };
}
