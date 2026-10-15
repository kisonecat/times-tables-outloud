import { chromium, expect, test } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Real on-device recognition, end to end, against the production build: the mic is
 * replaced with a stream the test controls, and for each problem the test "says" the
 * answer by playing a pre-recorded clip (see make-clips.sh). Everything after the mic —
 * worklet, VAD, resampling, worker, Whisper — is the real thing.
 *
 * Opt-in (downloads the model, ~77 MB, once into .cache/e2e-profile):
 *   ./e2e/make-clips.sh && E2E_WHISPER=1 npx playwright test whisper
 */
type PlayHook = { __playClip(b64: string): Promise<void> };
type StoredAttempt = {
  seq: number;
  a: number;
  b: number;
  engine: string;
  transcript: string;
  answer: number | null;
  correct: boolean;
  onsetMs: number;
  commitMs: number;
};

const CLIPS = resolve('.cache/clips');
const PROFILE = resolve('.cache/e2e-profile');

test.skip(!process.env.E2E_WHISPER, 'set E2E_WHISPER=1 to run');

test('a 20-problem session answered out loud through Whisper', async () => {
  test.setTimeout(15 * 60_000);
  expect(existsSync(CLIPS), 'run e2e/make-clips.sh first').toBe(true);
  const clip = (n: number) => readFileSync(resolve(CLIPS, `${n}.wav`)).toString('base64');
  /** Length of a 16-bit mono WAV clip, in ms. */
  const clipMs = (n: number) => {
    const wav = readFileSync(resolve(CLIPS, `${n}.wav`));
    return ((wav.length - 44) / 2 / wav.readUInt32LE(24)) * 1000;
  };

  const context = await chromium.launchPersistentContext(PROFILE, {
    executablePath: process.env.CHROMIUM_PATH || undefined,
    // E2E_GPU=1 runs headed with Vulkan so WebGPU can use the real GPU (headless has none).
    headless: !process.env.E2E_GPU,
    args: [
      '--autoplay-policy=no-user-gesture-required',
      ...(process.env.E2E_GPU ? ['--enable-features=Vulkan', '--ozone-platform=wayland'] : []),
    ],
    baseURL: 'http://localhost:4175',
  });
  const page = context.pages()[0] ?? (await context.newPage());
  page.on(
    'console',
    (m) => ['error', 'warning'].includes(m.type()) && console.log('[page]', m.text()),
  );
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));

  if (process.env.WHISPER_STREAMING) {
    await context.addInitScript((mode) => {
      (window as unknown as Record<string, unknown>).__ttWhisperStreaming = mode;
    }, process.env.WHISPER_STREAMING);
  }
  await context.addInitScript(() => {
    const ctx = new AudioContext();
    const dest = ctx.createMediaStreamDestination();
    navigator.mediaDevices.getUserMedia = async () => {
      await ctx.resume();
      return dest.stream;
    };
    (window as unknown as Record<string, unknown>).__playClip = async (b64: string) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const buf = await ctx.decodeAudioData(bytes.buffer);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(dest);
      await ctx.resume();
      src.start();
      await new Promise((r) => (src.onended = r));
    };
  });

  await page.goto('/');
  // Fresh learner each run (the profile persists for the model cache).
  await page.evaluate(() => indexedDB.deleteDatabase('times-tables-out-loud'));
  await page.reload();
  await page.getByRole('textbox', { name: 'Name' }).fill('Whisper Test');
  await page.getByRole('button', { name: 'Let’s go' }).click();
  await page.getByRole('radio', { name: /Whisper on this device/ }).check();
  await page.getByRole('button', { name: '6–9' }).click();
  await page.getByRole('button', { name: 'Start' }).click();

  await expect(page.getByText('Listening…')).toBeVisible({ timeout: 10 * 60_000 });

  const said: { a: number; b: number; answer: number }[] = [];
  const typed: string[] = [];
  for (let i = 0; i < 20; i++) {
    const problem = page.getByLabel(/^\d+ times \d+$/);
    await expect(problem).toBeVisible();
    await expect(page.getByText('Listening…')).toBeVisible({ timeout: 15_000 });
    const [a, b] = (await problem.getAttribute('aria-label'))!.split(' times ').map(Number) as [
      number,
      number,
    ];
    // Think for a moment, then answer (wrong on #6, to exercise a miss).
    await page.waitForTimeout(600);
    const answer = i === 6 ? (a === 1 ? 2 : a - 1) * b : a * b;
    said.push({ a, b, answer });
    // Feedback is on screen only briefly (≈400 ms for a right answer), so wait on what
    // lasts: the progress strip counting the answer, or the "didn't catch that" hint.
    const answered = page.getByRole('list', { name: new RegExp(` out of ${i + 1} so far`) });
    const unclear = page.getByText('Didn’t catch that. Say it again?');
    // After the last answer the quiz goes straight to results.
    const done = i === 19 ? page.getByRole('heading', { name: 'Nice work!' }) : answered;
    // Like a learner would: if it isn't caught, say it again, then give up and type it.
    for (let attempt = 0; ; attempt++) {
      if (attempt === 2) {
        typed.push(`${a}×${b} = ${answer}`);
        await page.getByLabel('Your answer').fill(String(answer));
        await page.getByLabel('Your answer').press('Enter');
        await done.waitFor();
        break;
      }
      await page.evaluate((b64) => (window as unknown as PlayHook).__playClip(b64), clip(answer));
      await done.or(unclear).first().waitFor({ timeout: 15_000 });
      if (await done.isVisible()) break;
      await expect(unclear)
        .toBeHidden({ timeout: 5_000 })
        .catch(() => {});
    }
  }

  await expect(page.getByRole('heading', { name: 'Nice work!' })).toBeVisible({ timeout: 10_000 });

  const attempts = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((r) => {
      const q = indexedDB.open('times-tables-out-loud');
      q.onsuccess = () => r(q.result);
    });
    return new Promise<StoredAttempt[]>((r) => {
      const q = db.transaction('attempts').objectStore('attempts').getAll();
      q.onsuccess = () => r(q.result);
    });
  });
  attempts.sort((x, y) => x.seq - y.seq);
  const after = attempts
    .filter((x) => x.engine === 'whisper')
    .map((x) => x.commitMs - x.onsetMs - clipMs(said[x.seq]!.answer))
    .sort((p, q) => p - q);
  console.log(
    `Answer accepted after the speaker finished: median ${Math.round(after[after.length >> 1]!)} ms, ` +
      `range ${Math.round(after[0]!)}–${Math.round(after.at(-1)!)} ms`,
  );
  console.table(
    attempts.map((x) => ({
      fact: `${x.a}×${x.b}`,
      heard: x.transcript,
      ok: x.correct,
      onsetMs: x.onsetMs,
      commitMs: x.commitMs,
    })),
  );
  expect(attempts).toHaveLength(20);
  const spoken = attempts.filter((x) => x.engine === 'whisper');
  const misheard = spoken.filter((x) => x.answer !== said[x.seq]!.answer);
  console.log(`Typed after two tries: ${typed.length}`, typed, `misheard: ${misheard.length}`);
  // Synthetic voices are harder than a person; still, most answers must land by voice.
  expect(spoken.length - misheard.length).toBeGreaterThanOrEqual(17);
  attempts.forEach((x, i) =>
    expect(x.answer).toBe(x.engine === 'typed' ? said[i]!.answer : x.answer),
  );
  spoken.forEach((x) => {
    // Onset ≈ the 600 ms pause plus the clip's lead-in, less however long after "Listening…"
    // the card became legible; commit adds Whisper's turnaround.
    expect(x.onsetMs).toBeGreaterThan(200);
    expect(x.onsetMs).toBeLessThan(2000);
    expect(x.commitMs).toBeGreaterThan(x.onsetMs);
  });
  await context.close();
});
