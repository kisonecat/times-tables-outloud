import { useState, type CSSProperties } from 'react';
import styles from './Burst.module.css';

const COUNT = 12;

/**
 * A CSS particle burst: twelve small numerals and dots flying out from (x, y) and
 * fading. Each particle gets its own --angle/--dist; the glyph is drawn by ::before.
 * Not rendered at all with reduced motion (the parent checks).
 */
export function Burst({ x, y, digits }: { x: number; y: number; digits: string }) {
  const [particles] = useState(() =>
    Array.from({ length: COUNT }, (_, i) => ({
      angle: (360 / COUNT) * i + (Math.random() - 0.5) * 20,
      dist: 70 + Math.random() * 50,
      glyph: i % 2 ? '•' : digits[Math.floor(Math.random() * digits.length)]!,
      hue: i % 3,
    })),
  );
  return (
    <div className={styles.burst} style={{ left: x, top: y }} aria-hidden>
      {particles.map((p, i) => (
        <span
          key={i}
          data-g={p.glyph}
          data-hue={p.hue}
          style={{ '--angle': `${p.angle}deg`, '--dist': `${p.dist}px` } as CSSProperties}
        />
      ))}
    </div>
  );
}
