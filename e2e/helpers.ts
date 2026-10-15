import { expect, type Page } from '@playwright/test';

/** The dev-only hook from src/speech/fakeEngine.ts, as seen from the page. */
export type FakeHook = {
  __ttFakeSpeech?: boolean | { say(text: string, opts?: { delayMs?: number }): Promise<void> };
};

/** Enable the fake speech engine (headless Chromium has no recognizer of its own). */
export async function useFakeSpeech(page: Page) {
  await page.addInitScript(() => {
    (window as FakeHook).__ttFakeSpeech = true;
    const w = window as unknown as Record<string, unknown>;
    w.webkitSpeechRecognition ??= class {};
  });
}

/** Create a learner and start a spoken session. */
export async function startSpokenSession(page: Page, tables = '6–9') {
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Name' }).fill('Robin');
  await page.getByRole('button', { name: 'Let’s go' }).click();
  await page.getByRole('radio', { name: /Browser speech/ }).check();
  await page.getByRole('button', { name: tables }).click();
  await page.getByRole('button', { name: 'Start' }).click();
}

export async function currentProblem(page: Page): Promise<[number, number]> {
  const problem = page.getByLabel(/^\d+ times \d+$/);
  await expect(problem).toBeVisible();
  const [a, b] = (await problem.getAttribute('aria-label'))!.split(' times ').map(Number);
  return [a!, b!];
}

export async function say(page: Page, text: string) {
  await page.evaluate(async (t) => {
    const fake = (window as FakeHook).__ttFakeSpeech;
    if (typeof fake !== 'object') throw new Error('fake engine not active');
    await fake.say(t, { delayMs: 10 });
  }, text);
}
