import styles from './AnswerSlot.module.css';

/** The correct answer "writing itself" in: an outline drawn by stroke-dashoffset, then filled. */
export function WriteIn({ value }: { value: number }) {
  return (
    <svg className={styles.writeIn} aria-hidden>
      <text x="50%" y="54%" textAnchor="middle" dominantBaseline="middle">
        {value}
      </text>
    </svg>
  );
}
