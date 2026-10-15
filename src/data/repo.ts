import { openTTDB, type DB } from './db';
import type { Attempt, FactState, Learner, ModelParams, Session } from './schema';

/**
 * Storage API used by the UI. The IndexedDB implementation is the normal path; if
 * IndexedDB can't be opened, the app falls back to the in-memory one so a quiz still
 * works (and shows a "progress won't be saved" banner).
 */
export interface Repo {
  readonly persistent: boolean;
  listLearners(): Promise<Learner[]>;
  getLearner(id: string): Promise<Learner | undefined>;
  putLearner(learner: Learner): Promise<void>;
  /** Deletes the learner and everything recorded for them. */
  deleteLearner(id: string): Promise<void>;
  putSession(session: Session): Promise<void>;
  getSession(id: string): Promise<Session | undefined>;
  listSessions(learnerId: string): Promise<Session[]>;
  addAttempt(attempt: Attempt): Promise<void>;
  /** Log an attempt and the model state it produced, in one transaction. */
  recordAttempt(attempt: Attempt, state: FactState, params: ModelParams): Promise<void>;
  /** Bulk-add history (demo data, imports); ids that already exist are skipped. */
  addHistory(sessions: Session[], attempts: Attempt[]): Promise<void>;
  getModel(learnerId: string): Promise<{ states: FactState[]; params?: ModelParams }>;
  /** Replace a learner's cached model state (after a replay). */
  saveModel(learnerId: string, states: Iterable<FactState>, params: ModelParams): Promise<void>;
  /** Record a self-correction after a miss. Correctness never changes. */
  setAttemptRevision(id: string, revision: number): Promise<void>;
  listAttempts(learnerId: string): Promise<Attempt[]>;
  listSessionAttempts(sessionId: string): Promise<Attempt[]>;
  getMeta<T>(key: string): Promise<T | undefined>;
  setMeta(key: string, value: unknown): Promise<void>;
}

const bySeq = (x: Attempt, y: Attempt) => x.seq - y.seq;

export class IdbRepo implements Repo {
  readonly persistent = true;
  constructor(private db: DB) {}

  listLearners() {
    return this.db.getAll('learners').then((ls) => ls.sort((x, y) => x.createdAt - y.createdAt));
  }
  getLearner(id: string) {
    return this.db.get('learners', id);
  }
  async putLearner(learner: Learner) {
    await this.db.put('learners', learner);
  }
  async deleteLearner(id: string) {
    const tx = this.db.transaction(
      ['learners', 'sessions', 'attempts', 'factState', 'modelParams'],
      'readwrite',
    );
    const range = IDBKeyRange.bound([id, -Infinity], [id, Infinity]);
    let session = await tx.objectStore('sessions').index('byLearner').openCursor(range);
    while (session) {
      await session.delete();
      session = await session.continue();
    }
    let attempt = await tx.objectStore('attempts').index('byLearnerShownAt').openCursor(range);
    while (attempt) {
      await attempt.delete();
      attempt = await attempt.continue();
    }
    await tx.objectStore('learners').delete(id);
    await tx.objectStore('factState').delete(IDBKeyRange.bound([id, ''], [id, '\uffff']));
    await tx.objectStore('modelParams').delete(id);
    await tx.done;
  }
  async putSession(session: Session) {
    await this.db.put('sessions', session);
  }
  getSession(id: string) {
    return this.db.get('sessions', id);
  }
  listSessions(learnerId: string) {
    return this.db.getAllFromIndex(
      'sessions',
      'byLearner',
      IDBKeyRange.bound([learnerId, -Infinity], [learnerId, Infinity]),
    );
  }
  async addAttempt(attempt: Attempt) {
    await this.db.add('attempts', attempt);
  }
  async recordAttempt(attempt: Attempt, state: FactState, params: ModelParams) {
    const tx = this.db.transaction(['attempts', 'factState', 'modelParams'], 'readwrite');
    await Promise.all([
      tx.objectStore('attempts').add(attempt),
      tx.objectStore('factState').put(state),
      tx.objectStore('modelParams').put(params),
      tx.done,
    ]);
  }
  async addHistory(sessions: Session[], attempts: Attempt[]) {
    const tx = this.db.transaction(['sessions', 'attempts'], 'readwrite');
    const ss = tx.objectStore('sessions');
    const as = tx.objectStore('attempts');
    for (const x of sessions) if (!(await ss.getKey(x.id))) await ss.put(x);
    for (const x of attempts) if (!(await as.getKey(x.id))) await as.put(x);
    await tx.done;
  }
  async getModel(learnerId: string) {
    const [states, params] = await Promise.all([
      this.db.getAll('factState', IDBKeyRange.bound([learnerId, ''], [learnerId, '\uffff'])),
      this.db.get('modelParams', learnerId),
    ]);
    return { states, params };
  }
  async saveModel(learnerId: string, states: Iterable<FactState>, params: ModelParams) {
    const tx = this.db.transaction(['factState', 'modelParams'], 'readwrite');
    const fs = tx.objectStore('factState');
    await fs.delete(IDBKeyRange.bound([learnerId, ''], [learnerId, '\uffff']));
    for (const st of states) await fs.put(st);
    await tx.objectStore('modelParams').put(params);
    await tx.done;
  }
  async setAttemptRevision(id: string, revision: number) {
    const tx = this.db.transaction('attempts', 'readwrite');
    const attempt = await tx.store.get(id);
    if (attempt) await tx.store.put({ ...attempt, revision });
    await tx.done;
  }
  listAttempts(learnerId: string) {
    return this.db.getAllFromIndex(
      'attempts',
      'byLearnerShownAt',
      IDBKeyRange.bound([learnerId, -Infinity], [learnerId, Infinity]),
    );
  }
  async listSessionAttempts(sessionId: string) {
    return (await this.db.getAllFromIndex('attempts', 'bySession', sessionId)).sort(bySeq);
  }
  async getMeta<T>(key: string) {
    return (await this.db.get('meta', key)) as T | undefined;
  }
  async setMeta(key: string, value: unknown) {
    await this.db.put('meta', value, key);
  }
}

export class MemoryRepo implements Repo {
  readonly persistent = false;
  private learners = new Map<string, Learner>();
  private sessions = new Map<string, Session>();
  private attempts = new Map<string, Attempt>();
  private meta = new Map<string, unknown>();
  private factStates = new Map<string, FactState>();
  private params = new Map<string, ModelParams>();

  async listLearners() {
    return [...this.learners.values()].sort((x, y) => x.createdAt - y.createdAt);
  }
  async getLearner(id: string) {
    return this.learners.get(id);
  }
  async putLearner(learner: Learner) {
    this.learners.set(learner.id, structuredClone(learner));
  }
  async deleteLearner(id: string) {
    this.learners.delete(id);
    for (const [k, s] of this.sessions) if (s.learnerId === id) this.sessions.delete(k);
    for (const [k, a] of this.attempts) if (a.learnerId === id) this.attempts.delete(k);
    for (const k of [...this.factStates.keys()])
      if (k.startsWith(`${id}/`)) this.factStates.delete(k);
    this.params.delete(id);
  }
  async putSession(session: Session) {
    this.sessions.set(session.id, structuredClone(session));
  }
  async getSession(id: string) {
    return this.sessions.get(id);
  }
  async listSessions(learnerId: string) {
    return [...this.sessions.values()]
      .filter((s) => s.learnerId === learnerId)
      .sort((x, y) => x.startedAt - y.startedAt);
  }
  async addAttempt(attempt: Attempt) {
    if (this.attempts.has(attempt.id)) throw new Error(`Duplicate attempt ${attempt.id}`);
    this.attempts.set(attempt.id, structuredClone(attempt));
  }
  async recordAttempt(attempt: Attempt, state: FactState, params: ModelParams) {
    await this.addAttempt(attempt);
    this.factStates.set(`${state.learnerId}/${state.fact}`, structuredClone(state));
    this.params.set(params.learnerId, structuredClone(params));
  }
  async addHistory(sessions: Session[], attempts: Attempt[]) {
    for (const x of sessions)
      if (!this.sessions.has(x.id)) this.sessions.set(x.id, structuredClone(x));
    for (const x of attempts)
      if (!this.attempts.has(x.id)) this.attempts.set(x.id, structuredClone(x));
  }
  async getModel(learnerId: string) {
    return {
      states: [...this.factStates.values()].filter((s) => s.learnerId === learnerId),
      params: this.params.get(learnerId),
    };
  }
  async saveModel(learnerId: string, states: Iterable<FactState>, params: ModelParams) {
    for (const k of [...this.factStates.keys()])
      if (k.startsWith(`${learnerId}/`)) this.factStates.delete(k);
    for (const st of states) this.factStates.set(`${learnerId}/${st.fact}`, structuredClone(st));
    this.params.set(learnerId, structuredClone(params));
  }
  async setAttemptRevision(id: string, revision: number) {
    const attempt = this.attempts.get(id);
    if (attempt) attempt.revision = revision;
  }
  async listAttempts(learnerId: string) {
    return [...this.attempts.values()]
      .filter((a) => a.learnerId === learnerId)
      .sort((x, y) => x.shownAt - y.shownAt);
  }
  async listSessionAttempts(sessionId: string) {
    return [...this.attempts.values()].filter((a) => a.sessionId === sessionId).sort(bySeq);
  }
  async getMeta<T>(key: string) {
    return this.meta.get(key) as T | undefined;
  }
  async setMeta(key: string, value: unknown) {
    this.meta.set(key, value);
  }
}

/** Opens IndexedDB, falling back to memory if it's unavailable (e.g. some private modes). */
export async function openRepo(): Promise<Repo> {
  try {
    return new IdbRepo(await openTTDB());
  } catch (err) {
    console.warn('IndexedDB unavailable; progress will not be saved.', err);
    return new MemoryRepo();
  }
}
