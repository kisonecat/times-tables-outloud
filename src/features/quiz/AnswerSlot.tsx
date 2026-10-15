import { forwardRef, type KeyboardEvent } from 'react';
import { ThinkRing } from './ThinkRing';
import { WriteIn } from './WriteIn';
import styles from './AnswerSlot.module.css';

export interface Feedback {
  correct: boolean;
  answer: number | null;
  product: number;
  /** A self-correction heard after a miss. */
  revision?: number;
}

interface Props {
  value: string;
  /** A number heard mid-utterance, shown blurred-in while still listening. */
  interim: number | null;
  feedback: Feedback | null;
  ring: { enabled: boolean; running: boolean; targetMs: number };
  onChange(value: string): void;
  onCommit(): void;
  onSkipAhead(): void;
}

/** Answer entry (typing is always available), which doubles as the feedback display. */
export const AnswerSlot = forwardRef<HTMLInputElement, Props>(function AnswerSlot(
  { value, interim, feedback, ring, onChange, onCommit, onSkipAhead },
  ref,
) {
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (feedback) onSkipAhead();
    else onCommit();
  };

  const status = feedback ? (feedback.correct ? 'correct' : 'miss') : 'asking';
  // On a miss the input goes blank and the right answer writes itself in over it.
  const shown = feedback ? (feedback.correct ? String(feedback.answer) : '') : value;
  const showInterim = !feedback && !value && interim !== null;

  return (
    <div className={styles.wrap} data-status={status}>
      <ThinkRing {...ring}>
        <div className={styles.box}>
          <input
            ref={ref}
            className={styles.slot}
            value={shown}
            readOnly={!!feedback}
            onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 3))}
            onKeyDown={onKeyDown}
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="off"
            enterKeyHint="go"
            aria-label="Your answer"
            placeholder={showInterim || feedback ? '' : '?'}
          />
          {showInterim && (
            <span key={interim} className={styles.interim} aria-hidden>
              {interim}
            </span>
          )}
          {feedback && !feedback.correct && <WriteIn value={feedback.product} />}
        </div>
      </ThinkRing>
      {feedback && (
        <p className={styles.verdict}>
          {feedback.correct ? (
            <>
              <span aria-hidden>✓</span> Yes!
            </>
          ) : feedback.answer === null ? (
            <>
              <span aria-hidden>→</span> It’s {feedback.product}
            </>
          ) : (
            <>
              <span aria-hidden>✗</span> Not <s>{feedback.answer}</s>, it’s {feedback.product}
            </>
          )}
        </p>
      )}
      {feedback && !feedback.correct && feedback.revision === feedback.product && (
        <p className={styles.revision}>That’s it: {feedback.product}</p>
      )}
    </div>
  );
});

/** A still picture of the slot after an answer, for a card that's leaving. */
export function AnswerSnapshot({ feedback }: { feedback: Feedback }) {
  return (
    <div className={styles.wrap} data-status={feedback.correct ? 'correct' : 'miss'} data-snapshot>
      <div className={styles.ringSpacer}>
        <div className={styles.slot}>{feedback.correct ? feedback.answer : feedback.product}</div>
      </div>
    </div>
  );
}
