import { useState, type CSSProperties } from 'react';
import styles from './Confetti.module.css';

const COUNT = 48;

/** A full-width confetti sweep for streak milestones. Parent unmounts it when done. */
export function Confetti() {
  const [pieces] = useState(() =>
    Array.from({ length: COUNT }, (_, i) => ({
      x: (i / COUNT) * 100 + (Math.random() - 0.5) * 4,
      drift: (Math.random() - 0.5) * 30,
      delay: Math.random() * 250,
      spin: (Math.random() < 0.5 ? -1 : 1) * (360 + Math.random() * 540),
      fall: 80 + Math.random() * 30,
      hue: i % 4,
      wide: Math.random() < 0.5,
    })),
  );
  return (
    <div className={styles.confetti} aria-hidden>
      {pieces.map((p, i) => (
        <i
          key={i}
          data-hue={p.hue}
          data-wide={p.wide || undefined}
          style={
            {
              left: `${p.x}%`,
              '--drift': `${p.drift}vw`,
              '--spin': `${p.spin}deg`,
              '--fall': `${p.fall}vh`,
              animationDelay: `${p.delay}ms`,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}
