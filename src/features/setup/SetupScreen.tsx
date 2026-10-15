import { useEffect, useState } from 'react';
import { useApp } from '../../AppContext';
import type { EngineKind, LearnerSettings, SessionLength } from '../../data/schema';
import { ALL_TABLES } from '../../learning/facts';
import { canUseWebSpeech, canUseWhisper } from '../../speech/support';
import { whisper } from '../../speech/whisperClient';
import styles from './Setup.module.css';

const PRESETS: { label: string; tables: number[] }[] = [
  { label: '2, 5, 10', tables: [2, 5, 10] },
  { label: '6–9', tables: [6, 7, 8, 9] },
  { label: 'All', tables: [...ALL_TABLES] },
];

const LENGTHS: { label: string; value: SessionLength }[] = [
  { label: '5 min', value: { kind: 'minutes', value: 5 } },
  { label: '10 min', value: { kind: 'minutes', value: 10 } },
  { label: '15 min', value: { kind: 'minutes', value: 15 } },
  { label: '20 problems', value: { kind: 'problems', value: 20 } },
  { label: '40 problems', value: { kind: 'problems', value: 40 } },
];

function engineOptions(): { kind: EngineKind; label: string; note: string; available: boolean }[] {
  return [
    {
      kind: 'web-speech',
      label: 'Browser speech',
      note: canUseWebSpeech()
        ? 'Quick to start. Your browser may send the audio to its maker’s servers to recognize it.'
        : 'Not available in this browser. Try Whisper instead.',
      available: canUseWebSpeech(),
    },
    {
      kind: 'whisper',
      label: 'Whisper on this device',
      note: canUseWhisper()
        ? 'Private: audio never leaves this device. One-time download of 80–210 MB, then it works offline.'
        : 'This browser can’t use the microphone here (it needs https).',
      available: canUseWhisper(),
    },
    { kind: 'typed', label: 'Typing', note: 'Type answers on the keyboard.', available: true },
  ];
}

const sameLength = (x: SessionLength, y: SessionLength) => x.kind === y.kind && x.value === y.value;
const sameTables = (x: number[], y: number[]) =>
  x.length === y.length && x.every((t) => y.includes(t));

export function SetupScreen() {
  const { repo, learner, setLearner, navigate, reportStorageFailure } = useApp();
  const [engines] = useState(engineOptions);
  const [settings, setSettings] = useState<LearnerSettings>(() => {
    const s = learner!.settings;
    const ok = engines.find((e) => e.kind === s.engine)?.available;
    return ok ? s : { ...s, engine: 'typed' };
  });
  const [whisperProgress, setWhisperProgress] = useState<number | null>(null);
  const [whisperFailed, setWhisperFailed] = useState(false);

  // Start the model download as soon as Whisper is picked, so it's ready by Start.
  useEffect(() => {
    if (settings.engine !== 'whisper') return;
    const onProgress = (pct: number) => setWhisperProgress(pct);
    whisper.load(onProgress).then(
      () => setWhisperFailed(false),
      () => setWhisperFailed(true),
    );
    return () => whisper.offProgress(onProgress);
  }, [settings.engine]);

  const update = (patch: Partial<LearnerSettings>) => setSettings((s) => ({ ...s, ...patch }));
  const toggleTable = (t: number) =>
    update({
      tables: settings.tables.includes(t)
        ? settings.tables.filter((x) => x !== t)
        : [...settings.tables, t].sort((a, b) => a - b),
    });

  const start = async () => {
    const updated = { ...learner!, settings };
    setLearner(updated);
    await repo.putLearner(updated).catch(reportStorageFailure);
    navigate({ name: 'quiz' });
  };

  return (
    <section className={styles.screen} aria-labelledby="setup-title">
      <h1 id="setup-title" className={styles.title}>
        Ready, {learner!.name}?
      </h1>

      <fieldset className={styles.group}>
        <legend>Tables</legend>
        <div className={styles.chips}>
          {ALL_TABLES.map((t) => (
            <label key={t} className={styles.chip}>
              <input
                type="checkbox"
                checked={settings.tables.includes(t)}
                onChange={() => toggleTable(t)}
                className="visually-hidden"
              />
              <span aria-hidden>×</span>
              {t}
            </label>
          ))}
        </div>
        <div className={styles.presets}>
          {PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              className={styles.preset}
              aria-pressed={sameTables(settings.tables, p.tables)}
              onClick={() => update({ tables: p.tables })}
            >
              {p.label}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className={styles.group}>
        <legend>Practice</legend>
        <div className={styles.segmented}>
          <Radio
            name="mode"
            checked={settings.mode === 'smart'}
            onChange={() => update({ mode: 'smart' })}
            label="Smart practice"
            note="Picks the problem that helps most right now."
          />
          <Radio
            name="mode"
            checked={settings.mode === 'free'}
            onChange={() => update({ mode: 'free' })}
            label="Free practice"
            note="Random problems from your tables."
          />
        </div>
      </fieldset>

      <fieldset className={styles.group}>
        <legend>How long</legend>
        <div className={styles.pills}>
          {LENGTHS.map((l) => (
            <label key={l.label} className={styles.pill}>
              <input
                type="radio"
                name="length"
                checked={sameLength(settings.length, l.value)}
                onChange={() => update({ length: l.value })}
                className="visually-hidden"
              />
              {l.label}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className={styles.group}>
        <legend>Answer by</legend>
        <div className={styles.segmented}>
          {engines.map((e) => (
            <Radio
              key={e.kind}
              name="engine"
              checked={settings.engine === e.kind}
              disabled={!e.available}
              onChange={() => update({ engine: e.kind })}
              label={e.label}
              note={
                e.kind === 'whisper' && settings.engine === 'whisper'
                  ? whisperFailed
                    ? 'The speech model couldn’t download. Check your connection; Start will try again.'
                    : whisperProgress === null
                      ? e.note
                      : whisperProgress < 100
                        ? `Downloading the speech model… ${whisperProgress}%`
                        : `Ready (${whisper.device === 'webgpu' ? 'using the GPU' : 'using the CPU'}). Audio never leaves this device.`
                  : e.note
              }
            />
          ))}
        </div>
      </fieldset>

      <fieldset className={styles.group}>
        <legend>Options</legend>
        <Toggle
          label="Read questions aloud"
          checked={settings.readAloud}
          onChange={(v) => update({ readAloud: v })}
        />
        <Toggle label="Sounds" checked={settings.sounds} onChange={(v) => update({ sounds: v })} />
        <Toggle
          label="Show the thinking timer"
          checked={settings.thinkRing}
          onChange={(v) => update({ thinkRing: v })}
        />
      </fieldset>

      <button
        className={`btn btn-primary ${styles.start}`}
        onClick={() => void start()}
        disabled={settings.tables.length === 0}
      >
        Start
      </button>
      {settings.tables.length === 0 && (
        <p className={styles.hint} role="status">
          Pick at least one table.
        </p>
      )}
    </section>
  );
}

function Radio(props: {
  name: string;
  checked: boolean;
  disabled?: boolean;
  onChange(): void;
  label: string;
  note: string;
}) {
  return (
    <label className={styles.option} data-disabled={props.disabled || undefined}>
      <input
        type="radio"
        name={props.name}
        checked={props.checked}
        disabled={props.disabled}
        onChange={props.onChange}
      />
      <span>
        <strong>{props.label}</strong>
        <small>{props.note}</small>
      </span>
    </label>
  );
}

function Toggle(props: { label: string; checked: boolean; onChange(v: boolean): void }) {
  return (
    <label className={styles.toggle}>
      <span>{props.label}</span>
      <input
        type="checkbox"
        role="switch"
        checked={props.checked}
        onChange={(e) => props.onChange(e.target.checked)}
      />
    </label>
  );
}
