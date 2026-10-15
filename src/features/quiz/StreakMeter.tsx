import { streakTier } from './streak';
import styles from './StreakMeter.module.css';

/** Notches toward the next streak milestone; one fills per right answer in a row. */
export function StreakMeter({ streak }: { streak: number }) {
  const { from, to } = streakTier(streak);
  return (
    <div
      className={styles.meter}
      role="img"
      aria-label={streak ? `${streak} in a row` : 'No streak yet'}
    >
      <ol className={styles.notches} aria-hidden>
        {Array.from({ length: to - from }, (_, i) => (
          <li key={`${from}-${i}`} data-on={from + i < streak || undefined} />
        ))}
      </ol>
      <span className={styles.count} aria-hidden>
        {streak > 0 ? `${streak} in a row` : ' '}
      </span>
    </div>
  );
}
