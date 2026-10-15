import { useApp } from '../../AppContext';
import type { Route } from '../../routes';
import { Avatar } from '../learners/Avatar';
import styles from './Shell.module.css';

export function AppBar({ route }: { route: Route }) {
  const { learner, navigate } = useApp();
  return (
    <header className={styles.bar}>
      <button
        className={styles.brand}
        onClick={() => navigate(learner ? { name: 'setup' } : { name: 'learners' })}
        aria-label="Times Tables Out Loud: home"
      >
        <span aria-hidden className={styles.brandMark}>
          ×
        </span>
        <span className={styles.brandName} aria-hidden>
          Times Tables <em>Out Loud</em>
        </span>
      </button>
      <nav className={styles.nav} aria-label="Main">
        <button
          className={styles.navLink}
          aria-current={route.name === 'analytics' ? 'page' : undefined}
          onClick={() => navigate({ name: 'analytics' })}
        >
          Progress
        </button>
        <button
          className={styles.navLink}
          aria-current={route.name === 'settings' ? 'page' : undefined}
          onClick={() => navigate({ name: 'settings' })}
        >
          Settings
        </button>
        {learner && (
          <button
            className={styles.who}
            onClick={() => navigate({ name: 'learners' })}
            aria-label={`Playing as ${learner.name}. Switch learner`}
          >
            <Avatar learner={learner} size={32} />
          </button>
        )}
      </nav>
    </header>
  );
}
