import { createContext, useContext } from 'react';
import type { Repo } from './data/repo';
import type { Learner } from './data/schema';
import type { Route } from './routes';

export interface AppContextValue {
  repo: Repo;
  learner: Learner | null;
  setLearner(learner: Learner | null): void;
  navigate(to: Route, opts?: { replace?: boolean }): void;
  /** Set when a write fails mid-session so the banner can say progress isn't saved. */
  reportStorageFailure(err: unknown): void;
}

export const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp outside AppContext');
  return ctx;
}
