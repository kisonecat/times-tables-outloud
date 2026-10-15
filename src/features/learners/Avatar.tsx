import type { Learner } from '../../data/schema';

export const AVATAR_COLORS = [
  'avatar-1',
  'avatar-2',
  'avatar-3',
  'avatar-4',
  'avatar-5',
  'avatar-6',
];

export function avatarColor(color: string): string {
  return AVATAR_COLORS.includes(color) ? `var(--${color})` : color;
}

export function Avatar({
  learner,
  size = 48,
}: {
  learner: Pick<Learner, 'name' | 'color'>;
  size?: number;
}) {
  const initial = learner.name.trim().charAt(0).toUpperCase() || '?';
  return (
    <span
      aria-hidden
      style={{
        display: 'inline-grid',
        placeItems: 'center',
        width: size,
        height: size,
        borderRadius: '50%',
        background: avatarColor(learner.color),
        color: '#fff',
        fontFamily: 'var(--font-display)',
        fontWeight: 800,
        fontSize: size * 0.48,
        lineHeight: 1,
        flex: 'none',
      }}
    >
      {initial}
    </span>
  );
}
