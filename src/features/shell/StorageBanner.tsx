import styles from './Shell.module.css';

export function StorageBanner() {
  return (
    <div className={styles.banner} role="status">
      This browser isn’t letting the app save. Practice still works, but progress won’t be kept
      after you close the page.
    </div>
  );
}
