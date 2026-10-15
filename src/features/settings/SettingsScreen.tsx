import { useEffect, useState } from 'react';
import { useApp } from '../../AppContext';
import { applyTheme, currentTheme, type Theme } from '../../lib/theme';
import styles from './Settings.module.css';

export function SettingsScreen() {
  const { repo } = useApp();
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [theme, setTheme] = useState<Theme>(currentTheme);

  useEffect(() => {
    navigator.storage?.persisted?.().then(setPersisted, () => setPersisted(false));
  }, []);

  const chooseTheme = (t: Theme) => {
    setTheme(t);
    applyTheme(t);
    repo.setMeta('theme', t).catch(() => {});
  };

  return (
    <section className={styles.screen} aria-labelledby="settings-title">
      <h1 id="settings-title" className={styles.title}>
        Settings
      </h1>

      <fieldset className={styles.panel}>
        <legend>Theme</legend>
        <div className={styles.row}>
          {(['system', 'light', 'dark'] as const).map((t) => (
            <label key={t} className={styles.radio}>
              <input
                type="radio"
                name="theme"
                checked={theme === t}
                onChange={() => chooseTheme(t)}
              />
              {t[0]!.toUpperCase() + t.slice(1)}
            </label>
          ))}
        </div>
      </fieldset>

      <div className={styles.panel}>
        <h2>Storage</h2>
        <p>
          {!repo.persistent
            ? 'This browser isn’t letting the app save, so progress lasts only until the page closes.'
            : persisted === null
              ? '…'
              : persisted
                ? 'Progress is saved on this device and protected from automatic cleanup.'
                : 'Progress is saved on this device. The browser may clear it if space runs low.'}
        </p>
        <p className={styles.note}>Nothing you practice ever leaves this device.</p>
      </div>
    </section>
  );
}
