import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Attempt, FactState, Learner, ModelParams, Session } from './schema';

export const DB_NAME = 'times-tables-out-loud';
export const DB_VERSION = 1;

export interface TTDB extends DBSchema {
  learners: { key: string; value: Learner };
  sessions: { key: string; value: Session; indexes: { byLearner: [string, number] } };
  attempts: {
    key: string;
    value: Attempt;
    indexes: {
      byLearnerShownAt: [string, number];
      byLearnerFact: [string, string];
      bySession: string;
    };
  };
  factState: { key: [string, string]; value: FactState };
  modelParams: { key: string; value: ModelParams };
  /** App-wide key/value settings (parent PIN, theme, first-run flags). */
  meta: { key: string; value: unknown };
}

export type DB = IDBPDatabase<TTDB>;

export function openTTDB(name = DB_NAME): Promise<DB> {
  return openDB<TTDB>(name, DB_VERSION, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        db.createObjectStore('learners', { keyPath: 'id' });
        const sessions = db.createObjectStore('sessions', { keyPath: 'id' });
        sessions.createIndex('byLearner', ['learnerId', 'startedAt']);
        const attempts = db.createObjectStore('attempts', { keyPath: 'id' });
        attempts.createIndex('byLearnerShownAt', ['learnerId', 'shownAt']);
        attempts.createIndex('byLearnerFact', ['learnerId', 'fact']);
        attempts.createIndex('bySession', 'sessionId');
        db.createObjectStore('factState', { keyPath: ['learnerId', 'fact'] });
        db.createObjectStore('modelParams', { keyPath: 'learnerId' });
        db.createObjectStore('meta');
      }
    },
  });
}
