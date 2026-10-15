import type { CSSProperties } from 'react';
import styles from './ArrayModel.module.css';

/**
 * After a miss: an a × b grid of dots that appears row by row, with a label counting up
 * to the product ("7 rows of 8 = 56"). A teaching aid, not decoration.
 */
export function ArrayModel({ a, b, onClick }: { a: number; b: number; onClick?: () => void }) {
  const product = a * b;
  const label = `${a} ${a === 1 ? 'row' : 'rows'} of ${b} = ${product}`;
  return (
    <figure
      className={styles.model}
      style={{ '--cols': b, '--rows': a, '--to': product } as CSSProperties}
      onClick={onClick}
    >
      <div className={styles.grid} aria-hidden>
        {Array.from({ length: a }, (_, r) => (
          <div key={r} className={styles.row} style={{ '--r': r } as CSSProperties}>
            {Array.from({ length: b }, (_, c) => (
              <i key={c} />
            ))}
          </div>
        ))}
      </div>
      <figcaption className={styles.caption}>
        <span className="visually-hidden">{label}</span>
        <span aria-hidden>
          {a} {a === 1 ? 'row' : 'rows'} of {b} = <span className={styles.count} />
        </span>
      </figcaption>
    </figure>
  );
}
