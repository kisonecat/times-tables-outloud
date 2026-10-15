import type { Attempt, EngineKind, FactState, ModelParams, Prediction } from '../data/schema';
import { factsForTables, parseFactKey } from './facts';
import { fluencyTarget, grade as gradeAttempt } from './grading';
import { predictRtMs, slowness } from './latency';
import { HLR_MODEL, type MemoryModel } from './model';
import { byPriorDifficulty, priorDifficulty } from './priors';
import type { Grade, Problem, SelectionReason } from './types';

export type Rng = () => number;

/**
 * Free-practice picker: uniform over the facts in the chosen tables, avoiding an
 * immediate repeat. Display order is random.
 */
export function pickRandom(
  tables: readonly number[],
  recentFacts: readonly string[],
  rng: Rng = Math.random,
): Problem {
  const facts = factsForTables(tables);
  if (facts.length === 0) throw new Error('No tables selected');
  const last = recentFacts[recentFacts.length - 1];
  const pool = facts.length > 1 ? facts.filter((f) => f !== last) : facts;
  return orient(pool[Math.floor(rng() * pool.length)]!, 'random', rng);
}

function orient(fact: string, reason: SelectionReason, rng: Rng): Problem {
  const [x, y] = parseFactKey(fact);
  const [a, b] = rng() < 0.5 ? [x, y] : [y, x];
  return { a, b, fact, reason };
}

export const SCHEDULER_DEFAULTS = {
  wGain: 0.6,
  wSpeed: 0.3,
  wRecent: 0.8,
  temperature: 0.15,
  exploreRate: 0.05,
  /** Don't re-ask any of the last few problems (retries excepted). */
  excludeRecent: 3,
  /** Introduce at most one new fact per this many problems… */
  newEvery: 5,
  /** …and only while rolling accuracy is at least this. */
  newMinAccuracy: 0.8,
  /**
   * Optional warm-up: facts easier than this prior difficulty (×1, ×2, ×10…) skip the
   * pacing, since they aren't new learning. 0 = pace every fact, as PLAN §8.6 says.
   * (In simulation 0.3 reached 90% fluency about half a day sooner.)
   */
  freeNewBelow: 0,
  /** Keep rolling accuracy over the last 10 problems near 85%. */
  targetAccuracy: 0.85,
  rollingWindow: 10,
  /** A missed fact returns after this many intervening problems, expanding. */
  retryGaps: [2, 5, 10],
  /** It leaves the retry queue after this many ok-or-fast answers. */
  retryExitGood: 2,
};

export type SchedulerOptions = typeof SCHEDULER_DEFAULTS;

interface RetryEntry {
  stage: number;
  dueAt: number;
  good: number;
}

export interface Choice {
  problem: Problem;
  pred: Prediction;
}

/**
 * Picks problems for one practice session and keeps the learner's model up to date as
 * answers come in. Smart mode follows PLAN §8.6; free mode is uniform random. Either
 * way every problem carries the model's prediction, made before the attempt.
 */
export class Tutor {
  readonly states: Map<string, FactState>;
  params: ModelParams;
  private readonly facts: string[];
  private readonly opts: SchedulerOptions;
  private history: { fact: string; correct: boolean }[] = [];
  private retry = new Map<string, RetryEntry>();
  private lastNewAt = -Infinity;
  private roundRobin = 0;

  constructor(
    private readonly config: {
      learnerId: string;
      tables: readonly number[];
      mode: 'smart' | 'free' | 'round-robin';
      engine: EngineKind;
      states?: Iterable<FactState>;
      params?: ModelParams;
      model?: MemoryModel;
      rng?: Rng;
      options?: Partial<SchedulerOptions>;
    },
  ) {
    this.facts = factsForTables(config.tables);
    if (this.facts.length === 0) throw new Error('No tables selected');
    this.states = new Map([...(config.states ?? [])].map((s) => [s.fact, s]));
    this.params = config.params ?? this.model.init(config.learnerId);
    this.opts = { ...SCHEDULER_DEFAULTS, ...config.options };
  }

  get model(): MemoryModel {
    return this.config.model ?? HLR_MODEL;
  }

  private get rng(): Rng {
    return this.config.rng ?? Math.random;
  }

  fluencyTarget(engine = this.config.engine): number {
    return fluencyTarget(engine, this.params);
  }

  /** Rolling accuracy over the last few problems (the target, before there are any). */
  rollingAccuracy(): number {
    const recent = this.history.slice(-this.opts.rollingWindow);
    if (!recent.length) return this.opts.targetAccuracy;
    return recent.filter((h) => h.correct).length / recent.length;
  }

  /** The recall level to aim for: easier when struggling, harder when cruising. */
  targetRecall(): number {
    const p = 0.8 + 0.5 * (this.opts.targetAccuracy - this.rollingAccuracy());
    return Math.min(0.92, Math.max(0.65, p));
  }

  next(now: number): Choice {
    const problem =
      this.config.mode === 'smart'
        ? this.pickSmart(now)
        : this.config.mode === 'round-robin'
          ? orient(this.facts[this.roundRobin++ % this.facts.length]!, 'random', this.rng)
          : pickRandom(
              this.config.tables,
              this.history.map((h) => h.fact),
              this.rng,
            );
    return { problem, pred: this.predict(problem, now) };
  }

  predict(problem: Pick<Problem, 'a' | 'b' | 'fact'>, now: number): Prediction {
    const state = this.states.get(problem.fact);
    const r = this.model.predict(problem.fact, now, state, this.params);
    return {
      pRecall: r.pNow,
      halfLifeH: r.halfLifeH,
      rtMs: Math.round(predictRtMs(problem.fact, this.config.engine, state, this.params, problem)),
      modelVersion: this.model.version,
    };
  }

  /** Feed an answered attempt back in. Returns its grade and the updated fact state. */
  record(attempt: Attempt): { grade: Grade; state: FactState; params: ModelParams } {
    const g = gradeAttempt(attempt, fluencyTarget(attempt.engine, this.params));
    const { state, params } = this.model.update(
      attempt,
      g,
      this.states.get(attempt.fact),
      this.params,
    );
    this.states.set(attempt.fact, state);
    this.params = params;

    const idx = this.history.length;
    this.history.push({ fact: attempt.fact, correct: g !== 'fail' });
    this.updateRetry(attempt.fact, g, idx);
    return { grade: g, state, params };
  }

  private updateRetry(fact: string, g: Grade, idx: number) {
    const { retryGaps, retryExitGood } = this.opts;
    const entry = this.retry.get(fact);
    if (g === 'fail') {
      this.retry.set(fact, { stage: 0, dueAt: idx + retryGaps[0]! + 1, good: 0 });
      return;
    }
    if (!entry) return;
    // Two ok-or-fast answers and it's out. A slow (counting) answer still moves it along
    // the expanding gaps, and getting through the last gap without a miss ends it too,
    // so one miss costs at most a few retries rather than one every ten problems.
    const good = entry.good + (g === 'ok' || g === 'fast' ? 1 : 0);
    const stage = entry.stage + 1;
    if (good >= retryExitGood || stage >= retryGaps.length) {
      this.retry.delete(fact);
      return;
    }
    this.retry.set(fact, { stage, dueAt: idx + retryGaps[stage]! + 1, good });
  }

  private pickSmart(now: number): Problem {
    const idx = this.history.length;
    const rng = this.rng;

    // 1. A missed fact whose turn has come.
    const due = [...this.retry.entries()]
      .filter(([, e]) => e.dueAt <= idx)
      .sort((x, y) => x[1].dueAt - y[1].dueAt)[0];
    if (due && this.facts.includes(due[0])) return orient(due[0], 'retry', rng);

    const recent = new Set(this.history.slice(-this.opts.excludeRecent).map((h) => h.fact));
    const isSeen = (f: string) => {
      const s = this.states.get(f);
      return !!s && s.nCorrect + s.nWrong > 0;
    };
    const unseen = byPriorDifficulty(this.facts.filter((f) => !isSeen(f)));
    let seen = this.facts.filter((f) => isSeen(f) && !recent.has(f));
    if (!seen.length && !unseen.length)
      seen = this.facts.filter((f) => f !== this.history.at(-1)?.fact);

    // 2. Now and then, anything at all, to keep the model honest.
    if (rng() < this.opts.exploreRate) {
      const pool = [...seen, ...unseen.slice(0, 1)];
      if (pool.length) return orient(pool[Math.floor(rng() * pool.length)]!, 'explore', rng);
    }

    // 3. A new fact, easiest first: easy ones freely, the rest at most one per few
    //    problems and only while it's going well.
    const next = unseen[0];
    if (next !== undefined) {
      const free = priorDifficulty(next) < this.opts.freeNewBelow;
      const paced =
        idx - this.lastNewAt >= this.opts.newEvery &&
        this.rollingAccuracy() >= this.opts.newMinAccuracy;
      if (free || paced || seen.length === 0) {
        if (!free) this.lastNewAt = idx;
        return orient(next, 'new', rng);
      }
    }

    // 4. The most useful seen fact, softly: a softmax over utilities.
    const pStar = this.targetRecall();
    const { wGain, wSpeed, wRecent, temperature } = this.opts;
    const scored = seen.map((fact) => {
      const r = this.model.predict(fact, now, this.states.get(fact), this.params);
      const speed = wSpeed * slowness(fact, this.config.engine, this.states.get(fact), this.params);
      const gain = wGain * (1 - r.pLong) * r.pNow;
      const u = -Math.abs(r.pNow - pStar) + gain + speed - wRecent * r.pShort;
      return { fact, u, speed, gain };
    });
    const max = Math.max(...scored.map((s) => s.u));
    const weights = scored.map((s) => Math.exp((s.u - max) / temperature));
    let pick = rng() * weights.reduce((a, b) => a + b, 0);
    let chosen = scored[scored.length - 1]!;
    for (let i = 0; i < scored.length; i++) {
      pick -= weights[i]!;
      if (pick <= 0) {
        chosen = scored[i]!;
        break;
      }
    }
    // "speed" when it's here for a speed rep (known but slow) more than for memory.
    const reason: SelectionReason = chosen.speed > Math.max(0.05, chosen.gain) ? 'speed' : 'due';
    return orient(chosen.fact, reason, rng);
  }
}
