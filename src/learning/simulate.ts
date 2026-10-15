import type { Attempt, EngineKind } from '../data/schema';
import { ALL_TABLES, factKey, factsForTables } from './facts';
import { priorDifficulty, priorHalfLifeH } from './priors';
import type { MemoryModel } from './model';
import { Tutor, type Rng, type SchedulerOptions } from './scheduler';
import { combineRecall } from './shortTerm';

/**
 * A synthetic learner for testing the scheduler (PLAN §8.8), and for seeding a demo
 * learner in development. Its true memory is hidden from the app's model, and is
 * deliberately a different model: FSRS-style (power-law forgetting, stability that grows
 * most from successful spaced recall, little from same-day repeats, and "savings" after
 * a lapse), plus a working memory with its own decay. Latency shrinks as memory
 * stabilizes (counting → recall).
 */

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rng: Rng): number {
  const u = Math.max(1e-12, rng());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Published FSRS-5 default weights (the ones the update rules below use). */
const W = {
  w6: 1.4604,
  w7: 0.0046,
  w8: 1.54575,
  w9: 0.1192,
  w10: 1.01925,
  w11: 1.9395,
  w12: 0.11,
  w13: 0.29605,
  w14: 2.2698,
  w17: 0.51655,
  w18: 0.6621,
};

export const SIM_DEFAULTS = {
  /** Spread of true stability around the priors (log-normal σ). */
  priorSpread: 0.6,
  /** True working-memory time constant (deliberately not the model's 90 s). */
  shortTermTauS: 45,
  slip: 0.03,
  /** Reviews closer together than this count as same-day. */
  sameDayH: 8,
  /** Median RT: fastMs + countingMs·exp(−stability / rtScaleDays). */
  fastMs: 800,
  countingMs: 5200,
  rtScaleDays: 1.5,
  rtSigma: 0.3,
  /** Speech recognition lag between onset and commit. */
  recognitionMs: 600,
};

interface TrueMemory {
  /** Stability S, in days: recall is 90% after S days. */
  s: number;
  /** Difficulty D, 1–10. */
  d: number;
  d0: number;
  last: number;
}

export class SimLearner {
  private mem = new Map<string, TrueMemory>();

  constructor(
    private rng: Rng,
    start: number,
    private o = SIM_DEFAULTS,
  ) {
    for (const f of factsForTables(ALL_TABLES)) {
      // A power-law curve's half-life is 9S, so the prior half-life maps to S = h/9.
      const s = (priorHalfLifeH(f) / 24 / 9) * Math.exp(o.priorSpread * gaussian(rng));
      const d = Math.min(10, Math.max(1, 3 + 6 * priorDifficulty(f) + gaussian(rng)));
      // Learned at some point in the last few days, before the app.
      this.mem.set(f, { s, d, d0: d, last: start - (12 + rng() * 60) * HOUR });
    }
  }

  stability(fact: string) {
    return this.mem.get(fact)!.s;
  }

  /** Long-term recall now: R = (1 + t / 9S)^−1. */
  pLong(fact: string, now: number) {
    const m = this.mem.get(fact)!;
    return 1 / (1 + Math.max(0, now - m.last) / DAY / (9 * m.s));
  }

  medianRtMs(fact: string) {
    const o = this.o;
    return o.fastMs + o.countingMs * Math.exp(-this.stability(fact) / o.rtScaleDays);
  }

  /** Fluent: would recall it now (≥ 90%) and quickly enough (median RT within target). */
  isFluent(fact: string, now: number, targetMs = 3000) {
    return this.pLong(fact, now) >= 0.9 && this.medianRtMs(fact) <= targetMs;
  }

  answer(a: number, b: number, now: number): { answer: number; rtMs: number } {
    const o = this.o;
    const fact = factKey(a, b);
    const m = this.mem.get(fact)!;
    const r = this.pLong(fact, now);
    const pShort = Math.exp(-(now - m.last) / 1000 / o.shortTermTauS);
    const correct = this.rng() < (1 - o.slip) * combineRecall(r, pShort);
    // Something just seen comes back fast even if it isn't learned yet.
    const median = correct ? Math.min(this.medianRtMs(fact), pShort > 0.5 ? 1500 : Infinity) : 4500;
    const rtMs = Math.max(400, median * Math.exp(o.rtSigma * gaussian(this.rng)));

    if (now - m.last < o.sameDayH * HOUR) {
      // Same-day review (FSRS-5's short-term rule): a success builds on it, a miss knocks it back.
      m.s = Math.max(0.005, m.s * Math.exp(W.w17 * ((correct ? 0 : -2) + W.w18)));
    } else if (correct) {
      m.s *= 1 + Math.exp(W.w8) * (11 - m.d) * m.s ** -W.w9 * (Math.exp(W.w10 * (1 - r)) - 1);
    } else {
      // A lapse: new stability depends on the old one (savings), never more than it.
      const relearned =
        W.w11 * m.d ** -W.w12 * ((m.s + 1) ** W.w13 - 1) * Math.exp(W.w14 * (1 - r));
      m.s = Math.max(0.005, Math.min(m.s, relearned));
      m.d = Math.min(10, m.d + 2 * W.w6);
      m.d = W.w7 * m.d0 + (1 - W.w7) * m.d;
    }
    m.last = now + rtMs;
    return { answer: correct ? a * b : this.wrongAnswer(a, b), rtMs };
  }

  /** Plausible errors: a neighbor fact, addition, a digit swap, or a near miss. */
  private wrongAnswer(a: number, b: number): number {
    const p = a * b;
    const r = this.rng();
    let w: number;
    if (r < 0.45) w = (a + (this.rng() < 0.5 ? -1 : 1)) * b;
    else if (r < 0.55) w = a + b;
    else if (r < 0.65 && p >= 10) w = Number(String(p).split('').reverse().join(''));
    else w = p + (this.rng() < 0.5 ? -1 : 1) * (1 + Math.floor(this.rng() * 3));
    return w === p || w < 0 ? p + 1 : w;
  }
}

export type SimPolicy = 'smart' | 'random' | 'round-robin';

export interface SimDay {
  day: number;
  /** Fraction of facts fluent at the start of the day, before practice. */
  fluentAtStart: number;
  problems: number;
  accuracy: number;
}

export interface SimResult {
  policy: SimPolicy;
  days: SimDay[];
  /** First day that started with ≥ 90% of facts fluent, or null. */
  daysTo90: number | null;
  accuracy: number;
  attempts: Attempt[];
  /** The simulated learner, for inspecting its true state afterwards. */
  learner: SimLearner;
  /** When the run ended (the start of the day after the last session). */
  end: number;
}

export function runSimulation({
  policy,
  days = 30,
  minutesPerDay = 10,
  seed = 1,
  tables = ALL_TABLES,
  learnerId = 'sim',
  engine = 'web-speech',
  start = Date.UTC(2026, 0, 5, 16),
  options,
  model,
}: {
  policy: SimPolicy;
  days?: number;
  minutesPerDay?: number;
  seed?: number;
  tables?: readonly number[];
  learnerId?: string;
  engine?: EngineKind;
  start?: number;
  options?: Partial<SchedulerOptions>;
  model?: MemoryModel;
}): SimResult {
  const rng = mulberry32(seed);
  const learner = new SimLearner(mulberry32(seed * 7919 + 1), start);
  const facts = factsForTables(tables);
  const tutor = new Tutor({
    learnerId,
    tables,
    engine,
    rng,
    mode: policy === 'smart' ? 'smart' : policy === 'random' ? 'free' : 'round-robin',
    options,
    model,
  });
  const attempts: Attempt[] = [];
  const out: SimDay[] = [];
  let daysTo90: number | null = null;
  let now = start;

  for (let day = 0; day <= days; day++) {
    // Practice around the same time each day, give or take an hour.
    now = start + day * 24 * HOUR + (rng() - 0.5) * 2 * HOUR;
    const fluentAtStart = facts.filter((f) => learner.isFluent(f, now)).length / facts.length;
    if (daysTo90 === null && fluentAtStart >= 0.9) daysTo90 = day;
    if (day === days) {
      out.push({ day, fluentAtStart, problems: 0, accuracy: NaN });
      break;
    }

    const sessionId = `${learnerId}-s${day}`;
    const end = now + minutesPerDay * 60_000;
    let seq = 0;
    let right = 0;
    while (now < end) {
      const { problem, pred } = tutor.next(now);
      const { answer, rtMs } = learner.answer(problem.a, problem.b, now);
      const attempt: Attempt = {
        id: `${sessionId}-${seq}`,
        learnerId,
        sessionId,
        seq,
        a: problem.a,
        b: problem.b,
        fact: problem.fact,
        shownAt: Math.round(now),
        onsetMs: Math.round(rtMs),
        commitMs: Math.round(rtMs + SIM_DEFAULTS.recognitionMs),
        engine,
        transcript: String(answer),
        answer,
        correct: answer === problem.a * problem.b,
        ttsUsed: false,
        selectionReason: problem.reason,
        pred,
      };
      tutor.record(attempt);
      attempts.push(attempt);
      if (attempt.correct) right++;
      seq++;
      // Answer, feedback hold (≈0.4 s right, 2.5 s miss), next card deals in.
      now += attempt.commitMs + (attempt.correct ? 650 : 2750) + 300;
    }
    out.push({ day, fluentAtStart, problems: seq, accuracy: right / seq });
  }

  const total = attempts.length;
  return {
    policy,
    days: out,
    daysTo90,
    accuracy: attempts.filter((a) => a.correct).length / total,
    attempts,
    learner,
    end: now,
  };
}
