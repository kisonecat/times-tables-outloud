import styles from './Deck.module.css';

/** The deck new cards deal from (lower right) and the pile right answers land on (upper left). */
export function Deck({ done }: { done: number }) {
  return (
    <>
      <div className={styles.deck} aria-hidden>
        <i />
        <i />
        <i />
      </div>
      <div className={styles.pile} aria-hidden data-count={Math.min(done, 3)}>
        {Array.from({ length: Math.min(done, 3) }, (_, i) => (
          <i key={i} />
        ))}
      </div>
    </>
  );
}
