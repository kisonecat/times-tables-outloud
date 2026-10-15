import { useEffect, useState } from 'react';
import { ACTIVE_MODEL, loadModel } from '../../learning/loadModel';
import type { FactState, ModelParams } from '../../data/schema';
import { useApp } from '../../AppContext';
import type { EngineKind } from '../../data/schema';
import { createEngine } from '../../speech/createEngine';
import { failureReason, type EngineError, type SpeechEngine } from '../../speech/engine';
import { ENGINE_ERROR_MESSAGES } from '../../speech/messages';
import { canUseWebSpeech, canUseWhisper } from '../../speech/support';
import { QuizRun } from './QuizRun';
import styles from './Quiz.module.css';

type Prep =
  | { status: 'preparing'; kind: EngineKind; progress: number | null }
  | { status: 'failed'; kind: EngineKind; reason: EngineError }
  | { status: 'ready'; kind: EngineKind; engine: SpeechEngine | null };

const ENGINE_NAMES: Record<EngineKind, string> = {
  'web-speech': 'Browser speech',
  whisper: 'Whisper on this device',
  typed: 'Typing',
};

function available(kind: EngineKind): boolean {
  return kind === 'typed' || (kind === 'web-speech' ? canUseWebSpeech() : canUseWhisper());
}

/** Gets the chosen speech engine ready (permissions, model download), then runs the quiz. */
export function QuizScreen() {
  const { repo, learner, navigate } = useApp();
  const [model, setModel] = useState<{ states: FactState[]; params: ModelParams } | null>(null);

  // The learner's memory model loads (or rebuilds from the log) while the mic gets ready.
  useEffect(() => {
    let cancelled = false;
    const id = learner!.id;
    loadModel(repo, id)
      .catch(() => ({ states: [], params: ACTIVE_MODEL.init(id) }))
      .then((m) => !cancelled && setModel(m));
    return () => {
      cancelled = true;
    };
  }, [repo, learner]);
  const settings = learner!.settings;
  const initialKind = available(settings.engine) ? settings.engine : 'typed';
  const [kind, setKind] = useState<EngineKind>(initialKind);
  const [prep, setPrep] = useState<Prep>(() =>
    initialKind === 'typed'
      ? { status: 'ready', kind: 'typed', engine: null }
      : { status: 'preparing', kind: initialKind, progress: null },
  );

  useEffect(() => {
    if (kind === 'typed') return;
    let engine: SpeechEngine | null = null;
    let cancelled = false;
    void (async () => {
      try {
        engine = await createEngine(kind, settings.lang);
        if (cancelled) return engine?.dispose();
        await engine!.prepare((pct) => {
          if (!cancelled) setPrep({ status: 'preparing', kind, progress: pct });
        });
        if (!cancelled) setPrep({ status: 'ready', kind, engine });
      } catch (err) {
        engine?.dispose();
        engine = null;
        if (!cancelled) setPrep({ status: 'failed', kind, reason: failureReason(err) });
      }
    })();
    return () => {
      cancelled = true;
      engine?.dispose();
    };
  }, [kind, settings.lang]);

  const choose = (k: EngineKind) => {
    setKind(k);
    setPrep(
      k === 'typed'
        ? { status: 'ready', kind: k, engine: null }
        : { status: 'preparing', kind: k, progress: null },
    );
  };

  if (prep.status === 'ready') {
    // The model loads in a blink; this just keeps the screen steady if it hasn't yet.
    return model ? (
      <QuizRun engine={prep.engine} model={model} />
    ) : (
      <section className={styles.screen} aria-label="Getting ready" aria-busy />
    );
  }

  const alternatives = (['web-speech', 'whisper', 'typed'] as const).filter(
    (k) => k !== prep.kind && available(k),
  );

  return (
    <section className={styles.screen} aria-label="Getting ready">
      <div />
      <div className={styles.stage}>
        <div className={styles.prepCard} role="status">
          {prep.status === 'preparing' ? (
            <>
              <p className={styles.prepTitle}>
                {prep.kind === 'whisper'
                  ? prep.progress === null || prep.progress >= 100
                    ? 'Starting the microphone…'
                    : 'Downloading the speech model…'
                  : 'Starting the microphone…'}
              </p>
              {prep.kind === 'whisper' && prep.progress !== null && prep.progress < 100 && (
                <>
                  <progress className={styles.prepBar} max={100} value={prep.progress} />
                  <p className={styles.prepNote}>
                    {prep.progress}% · one time only, then it works offline
                  </p>
                </>
              )}
              <p className={styles.prepNote}>If your browser asks, allow the microphone.</p>
            </>
          ) : (
            <>
              <p className={styles.prepTitle}>{ENGINE_NAMES[prep.kind]} isn’t working</p>
              <p className={styles.prepNote}>{ENGINE_ERROR_MESSAGES[prep.reason]}</p>
            </>
          )}
        </div>
      </div>
      <div className={styles.actions}>
        {prep.status === 'failed' && (
          <button className="btn" onClick={() => choose(prep.kind)}>
            Try again
          </button>
        )}
        {alternatives.map((k) => (
          <button
            key={k}
            className={k === 'typed' ? 'btn btn-primary' : 'btn'}
            onClick={() => choose(k)}
          >
            {k === 'typed' ? 'Type answers instead' : `Use ${ENGINE_NAMES[k]}`}
          </button>
        ))}
        <button className="btn btn-ghost" onClick={() => navigate({ name: 'setup' })}>
          Back
        </button>
      </div>
    </section>
  );
}
