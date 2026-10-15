import { useEffect, useRef } from 'react';
import type { EngineState, SpeechEngine } from '../../speech/engine';
import styles from './Quiz.module.css';

const LABELS: Partial<Record<EngineState, string>> = {
  loading: 'Getting ready…',
  listening: 'Listening…',
  hearing: 'Hearing you…',
  thinking: 'Working it out…',
  paused: '',
};

/**
 * Mic status with five level bars. Levels arrive at ~60 Hz, so they're written straight
 * to a CSS custom property instead of going through React state.
 */
export function MicLevel({
  engine,
  state,
  hint,
}: {
  engine: SpeechEngine;
  state: EngineState;
  hint: string | null;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let raf = 0;
    let level = 0;
    const off = engine.on((e) => {
      if (e.type !== 'level') return;
      level = e.rms;
      raf ||= requestAnimationFrame(() => {
        raf = 0;
        ref.current?.style.setProperty('--level', level.toFixed(3));
      });
    });
    return () => {
      off();
      cancelAnimationFrame(raf);
    };
  }, [engine]);

  return (
    <div
      ref={ref}
      className={styles.mic}
      data-state={state}
      data-has-level={engine.kind === 'whisper' || undefined}
    >
      <span className={styles.bars} aria-hidden>
        {[0.6, 0.85, 1, 0.85, 0.6].map((w, i) => (
          <i key={i} style={{ '--w': w, '--i': i } as React.CSSProperties} />
        ))}
      </span>
      <span className={styles.micText}>{hint ?? LABELS[state] ?? ''}</span>
    </div>
  );
}
