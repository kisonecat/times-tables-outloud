import type { CSSProperties } from 'react';
import styles from './Odometer.module.css';

const STRIP = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

/**
 * A number whose digits roll into place: each digit is a strip of 0–9 twice over that
 * slides up to land on its value (so every digit travels at least a full turn).
 * `startIndex` offsets the stagger so several odometers can share one sequence.
 */
export function Odometer({ value, startIndex = 0 }: { value: number; startIndex?: number }) {
  return (
    <span className={styles.odometer} aria-hidden>
      {String(value)
        .split('')
        .map((d, i) => (
          <span
            key={i}
            className={styles.window}
            style={{ '--to': Number(d) + 10, '--i': startIndex + i } as CSSProperties}
          >
            <span className={styles.ghost}>{d}</span>
            <span className={styles.strip} data-odometer>
              {STRIP.map((n, j) => (
                <span key={j}>{n}</span>
              ))}
            </span>
          </span>
        ))}
    </span>
  );
}
