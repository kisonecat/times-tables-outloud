import styles from './Quiz.module.css';

interface Props {
  results: readonly boolean[];
  /** Fixed number of problems, or null for timed sessions (strip grows as you go). */
  total: number | null;
}

export function ProgressStrip({ results, total }: Props) {
  const count = total ?? results.length + 1;
  const correct = results.filter(Boolean).length;
  return (
    <ol
      className={styles.strip}
      aria-label={`${correct} right out of ${results.length} so far${total ? `, ${total} total` : ''}`}
    >
      {Array.from({ length: count }, (_, i) => {
        const r = results[i];
        const state =
          r === undefined ? (i === results.length ? 'current' : 'todo') : r ? 'good' : 'miss';
        return <li key={i} data-state={state} />;
      })}
    </ol>
  );
}
