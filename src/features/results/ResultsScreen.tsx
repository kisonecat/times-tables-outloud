import { useEffect, useState, type CSSProperties } from 'react';
import { useApp } from '../../AppContext';
import type { Attempt, Session } from '../../data/schema';
import { MAX_FACTOR } from '../../learning/facts';
import { formatSeconds } from '../../lib/stats';
import { cellFor, summarizeRound } from './roundSummary';
import styles from './Results.module.css';

const prettyFact = (f: string) => f.replace('x', ' × ');
const GLYPH = { good: '✓', miss: '✗', mixed: '~' } as const;
const LABEL = { good: 'right', miss: 'missed', mixed: 'missed once' } as const;

export function ResultsScreen({ sessionId }: { sessionId: string }) {
  const { repo, navigate } = useApp();
  const [data, setData] = useState<{ session?: Session; attempts: Attempt[] } | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([repo.getSession(sessionId), repo.listSessionAttempts(sessionId)])
      .then(([session, attempts]) => !cancelled && setData({ session, attempts }))
      .catch(() => !cancelled && setData({ attempts: [] }));
    return () => {
      cancelled = true;
    };
  }, [repo, sessionId]);

  if (!data) return null;
  const s = summarizeRound(data.attempts);
  const newlyFluent = data.session?.newlyFluent ?? [];
  const factors = Array.from({ length: MAX_FACTOR }, (_, i) => i + 1);

  return (
    <section className={styles.screen} aria-labelledby="results-title">
      <h1 id="results-title" className={styles.title}>
        {s.total === 0
          ? 'No answers this time'
          : s.correct === s.total
            ? 'Perfect round!'
            : 'Nice work!'}
      </h1>

      <dl className={styles.stats}>
        <div>
          <dt>Score</dt>
          <dd>
            <CountUp value={s.correct} />
            <small>/{s.total}</small>
          </dd>
        </div>
        <div>
          <dt>Typical time</dt>
          <dd>{formatSeconds(s.medianRtMs)}</dd>
        </div>
        <div>
          <dt>Newly fluent</dt>
          <dd>
            <CountUp value={newlyFluent.length} />
          </dd>
        </div>
      </dl>

      {newlyFluent.length > 0 && (
        <div className={styles.panel}>
          <h2>Newly fluent</h2>
          <p className={styles.note}>Quick and solid now. These will come up less often.</p>
          <ul className={`${styles.factList} ${styles.good}`}>
            {newlyFluent.map((f) => (
              <li key={f}>{prettyFact(f)}</li>
            ))}
          </ul>
        </div>
      )}

      {s.revisit.length > 0 && (
        <div className={styles.panel}>
          <h2>Facts to revisit</h2>
          <ul className={styles.factList}>
            {s.revisit.map((f) => (
              <li key={f}>{prettyFact(f)}</li>
            ))}
          </ul>
        </div>
      )}

      {s.total > 0 && (
        <div className={styles.panel}>
          <h2>This round</h2>
          <div className={styles.gridWrap}>
            <table className={styles.grid}>
              <thead>
                <tr>
                  <th aria-label="times" className={styles.corner}>
                    ×
                  </th>
                  {factors.map((b) => (
                    <th key={b} scope="col">
                      {b}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {factors.map((a) => (
                  <tr key={a}>
                    <th scope="row">{a}</th>
                    {factors.map((b) => {
                      const c = cellFor(s.cells, a, b);
                      return (
                        <td
                          key={b}
                          style={{ '--d': a + b } as CSSProperties}
                          data-result={c}
                          aria-label={c ? `${a} × ${b}: ${LABEL[c]}` : undefined}
                        >
                          {c && <span aria-hidden>{GLYPH[c]}</span>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className={styles.actions}>
        <button className="btn" onClick={() => navigate({ name: 'setup' })}>
          Change setup
        </button>
        <button className="btn btn-primary" onClick={() => navigate({ name: 'quiz' })}>
          Play again
        </button>
      </div>
    </section>
  );
}

/** A number that counts up from 0 in CSS (registered --count + a counter). */
function CountUp({ value }: { value: number }) {
  return (
    <span className={styles.countUp} style={{ '--to': value } as CSSProperties}>
      <span className="visually-hidden">{value}</span>
    </span>
  );
}
