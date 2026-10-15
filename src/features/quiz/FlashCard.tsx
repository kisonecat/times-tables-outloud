import { useLayoutEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { prefersReducedMotion } from '../../lib/motion';
import { Odometer } from './Odometer';
import styles from './FlashCard.module.css';

/** Upper bound on the legibility mark, in case animations are throttled or never run. */
const LEGIBLE_FALLBACK_MS = 600;

export type CardExit = 'flick' | 'tuck';

interface Props {
  a: number;
  b: number;
  status: 'asking' | 'correct' | 'miss';
  /**
   * Fires once, with performance.now(), when the problem is readable: when the digits
   * finish rolling in (≈200 ms into the deal-in), or at first paint with reduced motion.
   * Response timing starts here. Omit for cards that are leaving.
   */
  onLegible?: (at: number) => void;
  /** A leaving card: flicks onto the done pile (right) or tucks back into the deck (miss). */
  exit?: CardExit;
  onExited?: () => void;
  onClick?: () => void;
  children?: ReactNode;
}

/** The index-card problem. Mount a fresh one per problem. */
export function FlashCard({ a, b, status, onLegible, exit, onExited, onClick, children }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!onLegible) return;
    let fired = false;
    const mark = () => {
      if (fired) return;
      fired = true;
      onLegible(performance.now());
    };
    const timer = setTimeout(mark, LEGIBLE_FALLBACK_MS);
    let raf = 0;

    // The digit rolls are CSS animations; wait for them to finish (getAnimations flushes
    // style, so they exist already). Without any (reduced motion, jsdom), mark at first paint.
    const rolls = (ref.current?.getAnimations?.({ subtree: true }) ?? []).filter((anim) => {
      const target = (anim.effect as KeyframeEffect | null)?.target;
      return target instanceof HTMLElement && target.dataset.odometer !== undefined;
    });
    if (rolls.length && !prefersReducedMotion()) {
      Promise.all(rolls.map((r) => r.finished)).then(mark, mark);
    } else {
      raf = requestAnimationFrame(mark);
    }
    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per mount
  }, []);

  // A leaving card is a picture of the old problem: nothing in it is focusable.
  // (React 18 doesn't know the `inert` prop, so set the attribute directly.)
  useLayoutEffect(() => {
    if (exit) ref.current?.setAttribute('inert', '');
  }, [exit]);

  const aDigits = String(a).length;
  return (
    <div
      ref={ref}
      className={styles.card}
      data-status={status}
      data-exit={exit}
      onClick={onClick}
      onAnimationEnd={(e) => {
        if (exit && e.target === e.currentTarget) onExited?.();
      }}
      aria-hidden={exit ? true : undefined}
    >
      <div className={styles.lift} aria-hidden />
      <div className={styles.header} aria-hidden />
      {/* A heading, so screen readers use its name ("7 times 8") rather than reading
          the odometer strips; it's also the card's landmark when tabbing by headings. */}
      <h2 className={styles.problem} aria-label={exit ? undefined : `${a} times ${b}`}>
        <Odometer value={a} />
        <span className={styles.times} style={{ '--i': aDigits } as CSSProperties} aria-hidden>
          ×
        </span>
        <Odometer value={b} startIndex={aDigits + 1} />
      </h2>
      {children}
    </div>
  );
}
