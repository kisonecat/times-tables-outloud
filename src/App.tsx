import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppContext, type AppContextValue } from './AppContext';
import type { Repo } from './data/repo';
import type { Learner } from './data/schema';
import { useHashRoute } from './routes';
import { AppBar } from './features/shell/AppBar';
import { StorageBanner } from './features/shell/StorageBanner';
import { LearnersScreen } from './features/learners/LearnersScreen';
import { SetupScreen } from './features/setup/SetupScreen';
import { QuizScreen } from './features/quiz/QuizScreen';
import { ResultsScreen } from './features/results/ResultsScreen';
import { AnalyticsScreen } from './features/analytics/AnalyticsScreen';
import { SettingsScreen } from './features/settings/SettingsScreen';

const LAST_LEARNER_KEY = 'lastLearnerId';

export function App({ repo }: { repo: Repo }) {
  const [route, navigate] = useHashRoute();
  const [learner, setLearnerState] = useState<Learner | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [storageFailed, setStorageFailed] = useState(!repo.persistent);

  useEffect(() => {
    let cancelled = false;
    repo
      .getMeta<string>(LAST_LEARNER_KEY)
      .then((id) => (id ? repo.getLearner(id) : undefined))
      .then((l) => !cancelled && l && setLearnerState(l))
      .catch(() => {})
      .finally(() => !cancelled && setLoaded(true));
    return () => {
      cancelled = true;
    };
  }, [repo]);

  const setLearner = useCallback(
    (l: Learner | null) => {
      setLearnerState(l);
      repo.setMeta(LAST_LEARNER_KEY, l?.id ?? null).catch(() => {});
    },
    [repo],
  );

  const reportStorageFailure = useCallback((err: unknown) => {
    console.error('Storage write failed', err);
    setStorageFailed(true);
  }, []);

  const ctx = useMemo<AppContextValue>(
    () => ({ repo, learner, setLearner, navigate, reportStorageFailure }),
    [repo, learner, setLearner, navigate, reportStorageFailure],
  );

  if (!loaded) return null;

  // Screens that need a learner bounce back to the picker without one.
  const needsLearner = route.name === 'setup' || route.name === 'quiz';
  const screen =
    needsLearner && !learner ? (
      <LearnersScreen />
    ) : route.name === 'setup' ? (
      <SetupScreen />
    ) : route.name === 'quiz' ? (
      <QuizScreen key={learner!.id} />
    ) : route.name === 'results' ? (
      <ResultsScreen sessionId={route.sessionId} />
    ) : route.name === 'analytics' ? (
      <AnalyticsScreen />
    ) : route.name === 'settings' ? (
      <SettingsScreen />
    ) : (
      <LearnersScreen />
    );

  return (
    <AppContext.Provider value={ctx}>
      {storageFailed && <StorageBanner />}
      {route.name !== 'quiz' && <AppBar route={route} />}
      <main>{screen}</main>
    </AppContext.Provider>
  );
}
