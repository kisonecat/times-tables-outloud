import { useEffect, useState, type FormEvent } from 'react';
import { useApp } from '../../AppContext';
import { DEFAULT_SETTINGS, type Learner } from '../../data/schema';
import { newId } from '../../lib/ids';
import { Avatar, AVATAR_COLORS, avatarColor } from './Avatar';
import styles from './Learners.module.css';

export function LearnersScreen() {
  const { repo, setLearner, navigate, reportStorageFailure } = useApp();
  const [learners, setLearners] = useState<Learner[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  useEffect(() => {
    repo.listLearners().then(setLearners, reportStorageFailure);
  }, [repo, reportStorageFailure]);

  const choose = (l: Learner) => {
    setLearner(l);
    navigate({ name: 'setup' });
  };

  const create = async (name: string, color: string) => {
    const learner: Learner = {
      id: newId(),
      name,
      color,
      createdAt: Date.now(),
      settings: structuredClone(DEFAULT_SETTINGS),
    };
    await repo.putLearner(learner).catch(reportStorageFailure);
    choose(learner);
  };

  const remove = async (id: string) => {
    await repo.deleteLearner(id).catch(reportStorageFailure);
    setLearners((ls) => ls?.filter((l) => l.id !== id) ?? null);
    setConfirmDelete(null);
  };

  if (!learners) return null;
  const showForm = adding || learners.length === 0;

  return (
    <section className={styles.screen} aria-labelledby="learners-title">
      <h1 id="learners-title" className={styles.title}>
        {learners.length ? 'Who’s practicing?' : 'Welcome! What’s your name?'}
      </h1>

      {learners.length > 0 && (
        <ul className={styles.grid}>
          {learners.map((l) => (
            <li key={l.id} className={styles.cell}>
              {confirmDelete === l.id ? (
                <div className={styles.confirm} role="group" aria-label={`Delete ${l.name}?`}>
                  <p>
                    Delete <strong>{l.name}</strong> and all their practice history?
                  </p>
                  <div className={styles.row}>
                    <button className="btn" onClick={() => setConfirmDelete(null)}>
                      Keep
                    </button>
                    <button className={`btn ${styles.danger}`} onClick={() => void remove(l.id)}>
                      Delete
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <button className={styles.card} onClick={() => choose(l)}>
                    <Avatar learner={l} size={64} />
                    <span className={styles.name}>{l.name}</span>
                  </button>
                  {editing && (
                    <button
                      className={styles.remove}
                      onClick={() => setConfirmDelete(l.id)}
                      aria-label={`Delete ${l.name}`}
                    >
                      ✕
                    </button>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {showForm ? (
        <NewLearnerForm
          onCreate={create}
          onCancel={learners.length ? () => setAdding(false) : undefined}
          usedColors={learners.map((l) => l.color)}
        />
      ) : (
        <div className={styles.row}>
          <button className="btn" onClick={() => setAdding(true)}>
            + Add learner
          </button>
          <button className="btn btn-ghost" onClick={() => setEditing((e) => !e)}>
            {editing ? 'Done' : 'Edit'}
          </button>
        </div>
      )}

      {import.meta.env.DEV && (
        <button
          className="btn btn-ghost"
          onClick={() =>
            void import('../../dev/demoLearner').then(async ({ loadDemoLearner }) => {
              const l = await loadDemoLearner(repo);
              setLearners((ls) => [...(ls ?? []), l]);
            }, reportStorageFailure)
          }
        >
          Load demo learner (dev)
        </button>
      )}
    </section>
  );
}

function NewLearnerForm({
  onCreate,
  onCancel,
  usedColors,
}: {
  onCreate(name: string, color: string): void;
  onCancel?: () => void;
  usedColors: string[];
}) {
  const [name, setName] = useState('');
  const [color, setColor] = useState(
    () => AVATAR_COLORS.find((c) => !usedColors.includes(c)) ?? AVATAR_COLORS[0]!,
  );

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed) onCreate(trimmed.slice(0, 24), color);
  };

  return (
    <form className={styles.form} onSubmit={submit}>
      <Avatar learner={{ name: name || '?', color }} size={72} />
      <label className={styles.field}>
        <span>Name</span>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={24}
          autoComplete="off"
          placeholder="e.g. Sam"
        />
      </label>
      <fieldset className={styles.swatches}>
        <legend>Color</legend>
        {AVATAR_COLORS.map((c) => (
          <label key={c} className={styles.swatch} style={{ background: avatarColor(c) }}>
            <input
              type="radio"
              name="color"
              value={c}
              checked={color === c}
              onChange={() => setColor(c)}
              className="visually-hidden"
            />
            <span className="visually-hidden">Color {c.slice(-1)}</span>
          </label>
        ))}
      </fieldset>
      <div className={styles.row}>
        {onCancel && (
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button type="submit" className="btn btn-primary" disabled={!name.trim()}>
          Let’s go
        </button>
      </div>
    </form>
  );
}
