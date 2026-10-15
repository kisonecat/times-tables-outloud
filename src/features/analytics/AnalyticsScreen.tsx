import { useEffect, useState } from 'react';
import { useApp } from '../../AppContext';
import type { Attempt, Session } from '../../data/schema';
import { median, formatSeconds } from '../../lib/stats';
import { responseTimeMs } from '../quiz/quizLogic';
import styles from '../settings/Settings.module.css';

/** Placeholder until phase 5 builds the full dashboard: a plain sessions list. */
export function AnalyticsScreen() {
  const { repo, learner, navigate } = useApp();
  const [rows, setRows] = useState<{ session: Session; attempts: Attempt[] }[] | null>(null);

  useEffect(() => {
    if (!learner) return;
    let cancelled = false;
    Promise.all([repo.listSessions(learner.id), repo.listAttempts(learner.id)]).then(
      ([sessions, attempts]) => {
        if (cancelled) return;
        setRows(
          sessions
            .map((session) => ({
              session,
              attempts: attempts.filter((a) => a.sessionId === session.id),
            }))
            .filter((r) => r.attempts.length > 0)
            .reverse(),
        );
      },
    );
    return () => {
      cancelled = true;
    };
  }, [repo, learner]);

  if (!learner) {
    return (
      <section className={styles.screen}>
        <h1 className={styles.title}>Progress</h1>
        <p>Pick a learner first.</p>
        <button className="btn" onClick={() => navigate({ name: 'learners' })}>
          Choose learner
        </button>
      </section>
    );
  }

  return (
    <section className={styles.screen} aria-labelledby="progress-title">
      <h1 id="progress-title" className={styles.title}>
        {learner.name}’s progress
      </h1>
      <div className={styles.panel}>
        <h2>Sessions</h2>
        {rows === null ? null : rows.length === 0 ? (
          <p>No sessions yet.</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Problems</th>
                <th scope="col">Right</th>
                <th scope="col">Typical time</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ session, attempts }) => (
                <tr key={session.id}>
                  <td>
                    <button
                      className={styles.link}
                      onClick={() => navigate({ name: 'results', sessionId: session.id })}
                    >
                      {new Date(session.startedAt).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </button>
                  </td>
                  <td>{attempts.length}</td>
                  <td>
                    {Math.round((100 * attempts.filter((a) => a.correct).length) / attempts.length)}
                    %
                  </td>
                  <td>
                    {formatSeconds(median(attempts.filter((a) => a.correct).map(responseTimeMs)))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <p className={styles.note}>
        The full dashboard (fact heatmap, speed trends, forecasts) is on the way.
      </p>
    </section>
  );
}
