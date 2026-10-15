import type { CSSProperties, ReactNode } from 'react';
import styles from './ThinkRing.module.css';

/**
 * A quiet ring around the answer that fills over the fluency target, turning from pencil
 * blue to highlighter yellow when the target passes (and staying there). It's driven by
 * the registered --elapsed property, so it's pure CSS. Can be turned off in setup.
 */
export function ThinkRing({
  enabled,
  running,
  targetMs,
  children,
}: {
  enabled: boolean;
  /** Starts at legibility; stops (and fades) once an answer is in. */
  running: boolean;
  targetMs: number;
  children: ReactNode;
}) {
  return (
    <div
      className={styles.ring}
      data-enabled={enabled || undefined}
      data-running={running || undefined}
      style={{ '--target': `${targetMs}ms` } as CSSProperties}
    >
      {children}
    </div>
  );
}
