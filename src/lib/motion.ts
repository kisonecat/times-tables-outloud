import { prefersReducedMotion } from './platform';

export { prefersReducedMotion };

/**
 * A duration token from motion.css, in ms. Tokens are calc() expressions, so they're
 * resolved by setting them on a probe element's transition-duration.
 */
export function tokenMs(name: string, fallback: number): number {
  if (typeof document === 'undefined' || !document.body) return fallback;
  const probe = document.createElement('div');
  probe.style.transitionDuration = `var(${name})`;
  probe.style.position = 'absolute';
  document.body.appendChild(probe);
  const value = getComputedStyle(probe).transitionDuration;
  probe.remove();
  const m = /^([\d.]+)(ms|s)$/.exec(value.split(',')[0]!.trim());
  if (!m) return fallback;
  return Number(m[1]) * (m[2] === 's' ? 1000 : 1);
}
