import type { Grade, SelectionReason } from '../learning/types';

export type EngineKind = 'web-speech' | 'whisper' | 'typed';
export type SessionMode = 'smart' | 'free' | 'retry';

export type SessionLength =
  { kind: 'minutes'; value: 5 | 10 | 15 } | { kind: 'problems'; value: 20 | 40 };

export interface LearnerSettings {
  tables: number[];
  length: SessionLength;
  mode: Exclude<SessionMode, 'retry'>;
  engine: EngineKind;
  readAloud: boolean;
  sounds: boolean;
  thinkRing: boolean;
  lang: string;
}

export interface Learner {
  id: string;
  name: string;
  color: string;
  createdAt: number;
  settings: LearnerSettings;
}

export interface Session {
  id: string;
  learnerId: string;
  startedAt: number;
  endedAt?: number;
  mode: SessionMode;
  tables: number[];
  engine: EngineKind;
  device: string;
  /** Facts that became fluent during this session (set when it ends). */
  newlyFluent?: string[];
}

export interface Prediction {
  pRecall: number;
  halfLifeH: number;
  rtMs: number;
  modelVersion: string;
}

export interface Attempt {
  id: string;
  learnerId: string;
  sessionId: string;
  seq: number;
  /** As displayed; order matters for display. */
  a: number;
  b: number;
  /** Unordered key, smaller factor first: "7x8". */
  fact: string;
  /** Epoch ms at legibility (or TTS end). */
  shownAt: number;
  /** Speech/keystroke onset minus shownAt. */
  onsetMs: number | null;
  /** Answer committed minus shownAt. */
  commitMs: number;
  engine: EngineKind;
  transcript: string;
  /** null = skipped / timed out. */
  answer: number | null;
  correct: boolean;
  revision?: number;
  ttsUsed: boolean;
  selectionReason: SelectionReason;
  /** Model predictions made BEFORE the attempt. */
  pred: Prediction;
}

/** Cached per-fact model state; rebuildable from the attempt log (learning/replay.ts). */
export interface FactState {
  learnerId: string;
  fact: string;
  nCorrect: number;
  nWrong: number;
  nFast: number;
  /** Epoch ms of the last review (when the last answer was given). */
  lastSeen: number;
  halfLifeH: number;
  /** Latency model: this fact's offset from the learner's log-RT baseline (β_fact). */
  rtLogMean: number;
  /** Variance of the residuals behind rtLogMean. */
  rtLogVar: number;
  /** Correct answers that fed the latency model. */
  rtN: number;
  /** Extra log-RT when shown larger factor first (half the gap between orders). */
  rtOrient: number;
  lastOutcome: Grade;
  /** FSRS model only: stability (days) and difficulty (1–10). */
  fsrs?: { s: number; d: number };
}

/** A learner's log-RT baseline for one engine: log RT ~ Normal(mu + β_fact, s2). */
export interface RtBaseline {
  mu: number;
  s2: number;
  n: number;
}

/** Per-learner model parameters; rebuildable from the attempt log. */
export interface ModelParams {
  learnerId: string;
  /** HLR weights (see learning/features.ts for the feature order). */
  theta: number[];
  version: string;
  updatedAt: number;
  /** SGD steps taken, for learning-rate decay. */
  steps: number;
  /** Correct answers on facts containing each factor 0–12 (for the transfer feature). */
  factorCorrect: number[];
  /** Latency baselines, kept per engine (typing and speaking differ by over a second). */
  rt: Record<EngineKind, RtBaseline>;
}

export const DEFAULT_SETTINGS: LearnerSettings = {
  tables: [2, 5, 10],
  length: { kind: 'problems', value: 20 },
  mode: 'smart',
  engine: 'typed',
  readAloud: false,
  sounds: true,
  thinkRing: true,
  lang: 'en-US',
};

/** Placeholder until the learning model (phase 4) produces real predictions. */
export const NO_PREDICTION: Prediction = {
  pRecall: 0.5,
  halfLifeH: 0,
  rtMs: 0,
  modelVersion: 'none',
};
