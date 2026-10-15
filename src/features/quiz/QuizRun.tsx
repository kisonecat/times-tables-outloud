import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useApp } from '../../AppContext';
import type { EngineKind, FactState, ModelParams, Session } from '../../data/schema';
import { newId } from '../../lib/ids';
import { prefersReducedMotion, tokenMs } from '../../lib/motion';
import { acquireWakeLock, deviceLabel } from '../../lib/platform';
import { blip, chime } from '../../lib/sounds';
import { fluentFacts } from '../../learning/fluency';
import { factsForTables } from '../../learning/facts';
import { ACTIVE_MODEL } from '../../learning/loadModel';
import { Tutor } from '../../learning/scheduler';
import type { Problem } from '../../learning/types';
import type { EngineEvent, EngineState, SpeechEngine } from '../../speech/engine';
import { judge } from '../../speech/judge';
import { ENGINE_ERROR_MESSAGES } from '../../speech/messages';
import { lastNumber } from '../../speech/parseNumbers';
import { canSpeak } from '../../speech/support';
import { speak, stopSpeaking } from '../../speech/tts';
import { AnswerSlot, AnswerSnapshot, type Feedback } from './AnswerSlot';
import { ArrayModel } from './ArrayModel';
import { Burst } from './Burst';
import { Confetti } from './Confetti';
import { Deck } from './Deck';
import { FlashCard, type CardExit } from './FlashCard';
import { MicLevel } from './MicLevel';
import { ProgressStrip } from './ProgressStrip';
import { buildAttempt, FEEDBACK_MS, isSessionOver, parseTyped } from './quizLogic';
import { isMilestone } from './streak';
import { StreakMeter } from './StreakMeter';
import styles from './Quiz.module.css';

/**
 * - reading:  the question is being read aloud; timing hasn't started
 * - asking:   waiting for an answer
 * - feedback: answer committed; showing right/miss before the next card
 */
type Phase = 'reading' | 'asking' | 'feedback';

/** A card on its way out: flicking onto the done pile, or tucking back into the deck. */
interface LeavingCard {
  key: number;
  a: number;
  b: number;
  exit: CardExit;
  feedback: Feedback;
}

interface Commit {
  answer: number | null;
  transcript: string;
  via: EngineKind;
  /** performance.now() when the answer was given; defaults to now. */
  at?: number;
}

export function QuizRun({
  engine: initialEngine,
  model,
}: {
  engine: SpeechEngine | null;
  /** The learner's memory model, as loaded before the session. */
  model: { states: FactState[]; params: ModelParams };
}) {
  const { repo, learner, navigate, reportStorageFailure } = useApp();
  const settings = learner!.settings;
  const ttsUsed = settings.readAloud && canSpeak();
  const firstPhase: Phase = ttsUsed ? 'reading' : 'asking';

  const [engine, setEngine] = useState(initialEngine);
  const [engineMessage, setEngineMessage] = useState<string | null>(null);
  const [micState, setMicState] = useState<EngineState>('idle');

  const [session] = useState<Session>(() => ({
    id: newId(),
    learnerId: learner!.id,
    startedAt: Date.now(),
    // Smart practice arrives with the learning model in phase 4.
    mode: settings.mode,
    tables: [...settings.tables],
    engine: initialEngine?.kind ?? 'typed',
    device: deviceLabel(),
  }));
  const [startPerf] = useState(() => performance.now());

  // Picks every problem (smart or free) and keeps the memory model current as answers land.
  const [tutor] = useState(
    () =>
      new Tutor({
        learnerId: learner!.id,
        tables: settings.tables,
        mode: settings.mode === 'smart' ? 'smart' : 'free',
        engine: initialEngine?.kind ?? 'typed',
        states: model.states,
        params: model.params,
        model: ACTIVE_MODEL,
      }),
  );
  const fluencyEngine = initialEngine?.kind ?? 'typed';
  const [fluentAtStart] = useState(() =>
    fluentFacts(
      ACTIVE_MODEL,
      factsForTables(settings.tables),
      Date.now(),
      tutor.states,
      tutor.params,
      fluencyEngine,
    ),
  );
  const [choice, setChoice] = useState(() => tutor.next(Date.now()));
  const problem: Problem = choice.problem;
  const [seq, setSeq] = useState(0);
  const [phase, setPhase] = useState<Phase>(firstPhase);
  const [typed, setTyped] = useState('');
  const [interim, setInterim] = useState<number | null>(null);
  const [heard, setHeard] = useState('');
  const [hint, setHint] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [results, setResults] = useState<boolean[]>([]);
  const [streak, setStreak] = useState(0);
  /** The seq whose card is legible; the think ring runs from then until an answer. */
  const [legibleSeq, setLegibleSeq] = useState(-1);
  const [leaving, setLeaving] = useState<LeavingCard[]>([]);
  const [burst, setBurst] = useState<{ key: number; x: number; y: number; digits: string } | null>(
    null,
  );
  const [celebration, setCelebration] = useState<number | null>(null);
  const [holds] = useState(() => ({
    correct: tokenMs('--hold-correct', FEEDBACK_MS.correct),
    miss: tokenMs('--hold-miss', FEEDBACK_MS.miss),
  }));
  const stageRef = useRef<HTMLDivElement>(null);

  const legiblePerf = useRef<number | null>(null);
  const onsetPerf = useRef<number | null>(null);
  const pendingTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  /** Set synchronously on commit, so two events in one tick can't both commit. */
  const committedSeq = useRef(-1);
  const lastAttemptId = useRef<string | null>(null);
  /** Serializes writes so results never read a half-written session. */
  const writes = useRef<Promise<unknown>>(Promise.resolve());
  const inputRef = useRef<HTMLInputElement>(null);
  const finished = useRef(false);
  const streakRef = useRef(0);
  const engineRef = useRef(engine);

  // Engine events and timers fire between renders; they read the latest values from here.
  const live = useRef({ seq, problem, phase, feedback, pred: choice.pred });
  useLayoutEffect(() => {
    live.current = { seq, problem, phase, feedback, pred: choice.pred };
    engineRef.current = engine;
  });

  const write = useCallback(
    (op: () => Promise<unknown>) => {
      writes.current = writes.current.then(op).catch(reportStorageFailure);
    },
    [reportStorageFailure],
  );

  useEffect(() => {
    write(() => repo.putSession(session));
  }, [repo, session, write]);

  useEffect(() => {
    let release = () => {};
    let cancelled = false;
    void acquireWakeLock().then((r) => (cancelled ? r() : (release = r)));
    return () => {
      cancelled = true;
      release();
    };
  }, []);

  // Ambient parallax: the graph paper drifts a few pixels as the session progresses.
  useEffect(() => {
    if (prefersReducedMotion()) return;
    const total = settings.length.kind === 'problems' ? settings.length.value : 30;
    const shift = Math.min(1, results.length / total) * 12;
    document.documentElement.style.setProperty('--paper-shift', `${-shift}px`);
  }, [results.length, settings.length]);
  useEffect(
    () => () => {
      document.documentElement.style.removeProperty('--paper-shift');
      clearTimeout(pendingTimer.current);
      stopSpeaking();
    },
    [],
  );

  // Subscribe before the effect below calls listenFresh(), so its first state event lands.
  const engineHandler = useRef<(e: EngineEvent) => void>(() => {});
  useEffect(() => engine?.on((e) => engineHandler.current(e)), [engine]);

  /** Response timing starts here (performance marks let tests measure the turnaround). */
  const markLegible = (at: number) => {
    legiblePerf.current = at;
    performance.mark?.('tt:legible');
    setLegibleSeq(live.current.seq);
  };

  // Each new problem: read it aloud (timing starts when the voice stops), or just listen.
  useEffect(() => {
    let cancelled = false;
    if (ttsUsed) {
      engineRef.current?.pause();
      const { a, b } = live.current.problem;
      void speak(`${a} times ${b}`, settings.lang).then(() => {
        if (cancelled) return;
        markLegible(performance.now());
        setPhase((p) => (p === 'reading' ? 'asking' : p));
        engineRef.current?.listenFresh();
      });
    } else {
      engineRef.current?.listenFresh();
    }
    return () => {
      cancelled = true;
    };
  }, [seq, ttsUsed, settings.lang]);

  const finish = useCallback(async () => {
    if (finished.current) return;
    finished.current = true;
    engineRef.current?.pause();
    stopSpeaking();
    const now = Date.now();
    const fluentNow = fluentFacts(
      ACTIVE_MODEL,
      factsForTables(settings.tables),
      now,
      tutor.states,
      tutor.params,
      fluencyEngine,
    );
    const newlyFluent = [...fluentNow].filter((f) => !fluentAtStart.has(f));
    write(() => repo.putSession({ ...session, endedAt: now, newlyFluent }));
    await writes.current;
    navigate({ name: 'results', sessionId: session.id }, { replace: true });
  }, [navigate, repo, session, write, settings.tables, tutor, fluencyEngine, fluentAtStart]);

  const commit = useCallback(
    ({ answer, transcript, via, at }: Commit) => {
      const { seq, problem, phase, pred } = live.current;
      if (phase === 'feedback' || committedSeq.current === seq) return;
      committedSeq.current = seq;
      clearTimeout(pendingTimer.current);
      const now = at ?? performance.now();
      // Never drop an answer: if the legibility mark somehow hasn't landed, it's now.
      legiblePerf.current ??= now;
      const attempt = buildAttempt({
        id: newId(),
        learnerId: session.learnerId,
        sessionId: session.id,
        seq,
        problem,
        timing: {
          legiblePerf: legiblePerf.current,
          onsetPerf: onsetPerf.current,
          commitPerf: Math.max(now, legiblePerf.current),
          timeOrigin: performance.timeOrigin,
        },
        engine: via,
        transcript,
        answer,
        ttsUsed,
        pred,
      });
      performance.mark?.('tt:commit');
      lastAttemptId.current = attempt.id;
      const { state, params } = tutor.record(attempt);
      write(() => repo.recordAttempt(attempt, state, params));
      const nextStreak = attempt.correct ? streakRef.current + 1 : 0;
      streakRef.current = nextStreak;
      setStreak(nextStreak);
      const big = isMilestone(nextStreak);
      if (settings.sounds) {
        if (big) chime();
        else blip(attempt.correct);
      }
      if (attempt.correct && !prefersReducedMotion()) {
        if (big) setCelebration(seq);
        const slot = inputRef.current?.getBoundingClientRect();
        const stage = stageRef.current?.getBoundingClientRect();
        if (slot && stage) {
          setBurst({
            key: seq,
            x: slot.left + slot.width / 2 - stage.left,
            y: slot.top + slot.height / 2 - stage.top,
            digits: String(problem.a * problem.b),
          });
        }
      }

      // After a miss, keep listening: a self-correction is logged as a revision.
      if (attempt.correct) engineRef.current?.pause();
      else engineRef.current?.listenFresh();

      setResults((r) => [...r, attempt.correct]);
      setInterim(null);
      setHint(null);
      setPhase('feedback');
      setFeedback({ correct: attempt.correct, answer, product: problem.a * problem.b });
    },
    [repo, session, settings.sounds, ttsUsed, write, tutor],
  );

  const advance = useCallback(() => {
    const { phase, seq, problem, feedback } = live.current;
    if (phase !== 'feedback' || !feedback) return;
    if (isSessionOver(settings.length, results.length, performance.now() - startPerf)) {
      void finish();
      return;
    }
    // The old card leaves while the next one deals in.
    setLeaving((cards) => [
      ...cards,
      { key: seq, a: problem.a, b: problem.b, exit: feedback.correct ? 'flick' : 'tuck', feedback },
    ]);
    legiblePerf.current = null;
    onsetPerf.current = null;
    lastAttemptId.current = null;
    setFeedback(null);
    setTyped('');
    setHeard('');
    setPhase(firstPhase);
    setSeq((s) => s + 1);
    setChoice(tutor.next(Date.now()));
  }, [finish, firstPhase, results.length, settings.length, startPerf, tutor]);

  useEffect(() => {
    if (!feedback) return;
    const t = setTimeout(advance, feedback.correct ? holds.correct : holds.miss);
    return () => clearTimeout(t);
  }, [feedback, advance, holds]);

  // Burst particles and confetti clean themselves up.
  useEffect(() => {
    if (!burst) return;
    const t = setTimeout(() => setBurst(null), tokenMs('--dur-slow', 520) + 100);
    return () => clearTimeout(t);
  }, [burst]);
  useEffect(() => {
    if (celebration === null) return;
    const t = setTimeout(() => setCelebration(null), 2000);
    return () => clearTimeout(t);
  }, [celebration]);

  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
  }, [seq]);

  const onTranscript = useCallback(
    (e: Extract<EngineEvent, { type: 'transcript' }>) => {
      const { phase, problem, feedback } = live.current;
      clearTimeout(pendingTimer.current);

      if (phase === 'feedback') {
        if (!feedback || feedback.correct || !e.final || !lastAttemptId.current) return;
        const n = lastNumber(e.text, settings.lang);
        if (n === null || n === feedback.answer) return;
        const id = lastAttemptId.current;
        write(() => repo.setAttemptRevision(id, n));
        setFeedback({ ...feedback, revision: n });
        return;
      }
      if (phase !== 'asking') return;

      setHeard(e.text);
      const v = judge(e, problem.a, problem.b, settings.lang);
      const via = engineRef.current?.kind ?? 'typed';
      switch (v.kind) {
        case 'interim':
          setInterim(v.value);
          break;
        case 'pending':
          setInterim(v.answer);
          pendingTimer.current = setTimeout(
            () => commit({ answer: v.answer, transcript: e.text, via, at: e.at }),
            v.waitMs,
          );
          break;
        case 'commit':
          commit({ answer: v.answer, transcript: e.text, via, at: e.at });
          break;
        case 'readback':
          setHint('Just the answer is fine');
          break;
        case 'say-number':
          setHint('Say just the number');
          break;
        case 'listen':
          break;
      }
    },
    [commit, repo, settings.lang, write],
  );

  const onEngineEvent = (e: EngineEvent) => {
    switch (e.type) {
      case 'state':
        if (e.state === 'error') {
          // Fall back to typing for the rest of the session.
          engineRef.current?.dispose();
          setEngine(null);
          setEngineMessage(
            ENGINE_ERROR_MESSAGES[e.detail as keyof typeof ENGINE_ERROR_MESSAGES] ??
              ENGINE_ERROR_MESSAGES.unknown,
          );
          inputRef.current?.focus();
        } else {
          setMicState(e.state);
          if (e.state === 'hearing') setHint(null);
          if (e.detail === 'unclear') setHint('Didn’t catch that. Say it again?');
        }
        break;
      case 'onset':
        if (live.current.phase === 'asking' && onsetPerf.current === null) {
          onsetPerf.current = e.at;
        }
        break;
      case 'transcript':
        onTranscript(e);
        break;
    }
  };
  useLayoutEffect(() => {
    engineHandler.current = onEngineEvent;
  });

  const onTypedChange = (value: string) => {
    if (onsetPerf.current === null && value.length > 0) onsetPerf.current = performance.now();
    setTyped(value);
  };

  const commitTyped = (text: string | null) => {
    const answer = text === null ? null : parseTyped(text);
    if (text !== null && answer === null) return; // nothing typed yet
    commit({ answer, transcript: text ?? '', via: 'typed' });
  };

  const status = feedback ? (feedback.correct ? 'correct' : 'miss') : 'asking';
  const announcement =
    phase === 'reading'
      ? ''
      : !feedback
        ? `${problem.a} times ${problem.b}`
        : feedback.correct
          ? isMilestone(streak)
            ? `Correct! ${streak} in a row!`
            : 'Correct!'
          : `${problem.a} times ${problem.b} is ${feedback.product}.`;

  return (
    <section className={styles.screen} aria-label="Quiz">
      <div className={styles.top}>
        <ProgressStrip
          results={results}
          total={settings.length.kind === 'problems' ? settings.length.value : null}
        />
        <button className="btn btn-ghost" onClick={() => void finish()}>
          Finish
        </button>
        <StreakMeter streak={streak} />
        {engineMessage && (
          <p className={styles.engineMessage} role="alert">
            {engineMessage}
          </p>
        )}
      </div>

      <div className={styles.stage} ref={stageRef}>
        <div className={styles.cards}>
          <Deck done={results.filter(Boolean).length} />
          {leaving.map((card) => (
            <LeavingFlashCard
              key={card.key}
              card={card}
              onDone={() => setLeaving((cs) => cs.filter((c) => c.key !== card.key))}
            />
          ))}
          <FlashCard
            key={seq}
            a={problem.a}
            b={problem.b}
            status={status}
            onLegible={(at) => {
              if (!ttsUsed) markLegible(at);
            }}
            onClick={feedback ? advance : undefined}
          >
            <AnswerSlot
              ref={inputRef}
              value={typed}
              interim={interim}
              feedback={feedback}
              ring={{
                enabled: settings.thinkRing,
                running: legibleSeq === seq && phase === 'asking',
                targetMs: tutor.fluencyTarget(engine?.kind ?? 'typed'),
              }}
              onChange={onTypedChange}
              onCommit={() => commitTyped(typed)}
              onSkipAhead={advance}
            />
          </FlashCard>
        </div>
        {feedback && !feedback.correct && (
          <ArrayModel key={seq} a={problem.a} b={problem.b} onClick={advance} />
        )}
        {heard && !feedback && (
          <p className={styles.heard} aria-hidden>
            “{heard}”
          </p>
        )}
        {burst && <Burst key={burst.key} x={burst.x} y={burst.y} digits={burst.digits} />}
      </div>

      <div className={styles.bottom}>
        {engine && phase !== 'feedback' && (
          <MicLevel
            engine={engine}
            state={phase === 'reading' ? 'paused' : micState}
            hint={phase === 'reading' ? 'Listen…' : hint}
          />
        )}
        <div className={styles.actions}>
          {feedback ? (
            <button className="btn" onClick={advance}>
              Next →
            </button>
          ) : (
            <>
              <button className="btn btn-ghost" onClick={() => commitTyped(null)}>
                Skip
              </button>
              <button
                className="btn btn-primary"
                onClick={() => commitTyped(typed)}
                disabled={parseTyped(typed) === null}
              >
                Check
              </button>
            </>
          )}
        </div>
      </div>

      {celebration !== null && <Confetti key={celebration} />}

      <p className="visually-hidden" aria-live="polite">
        {announcement}
      </p>
    </section>
  );
}

/** A finished card animating away; removed on animationend, or after a safety timeout. */
function LeavingFlashCard({ card, onDone }: { card: LeavingCard; onDone(): void }) {
  const done = useRef(onDone);
  useLayoutEffect(() => {
    done.current = onDone;
  });
  useEffect(() => {
    const t = setTimeout(() => done.current(), tokenMs('--dur-base', 280) + 300);
    return () => clearTimeout(t);
  }, []);
  return (
    <FlashCard
      a={card.a}
      b={card.b}
      status={card.feedback.correct ? 'correct' : 'miss'}
      exit={card.exit}
      onExited={() => done.current()}
    >
      <AnswerSnapshot feedback={card.feedback} />
    </FlashCard>
  );
}
