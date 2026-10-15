import { expect, test } from '@playwright/test';
import { nextCard, say, startSpokenSession, useFakeSpeech, waitForAnswered } from './helpers';

/**
 * Smoke test of the whole quiz loop: create a learner, pick browser speech, answer 20
 * problems out loud (through the fake engine), and land on results.
 */
test('a spoken 20-problem session reaches results', async ({ page }) => {
  await useFakeSpeech(page);
  await startSpokenSession(page);

  for (let i = 0; i < 20; i++) {
    const [a, b] = await nextCard(page);
    const answer = i === 7 ? a * b + 1 : a * b;
    await say(page, String(answer));
    if (i === 7) await expect(page.getByText(/it’s \d+/)).toBeVisible(); // a miss stays up 2.5 s
    await waitForAnswered(page, i + 1);
  }

  await expect(page.getByRole('heading', { name: 'Nice work!' })).toBeVisible();
  await expect(page.getByText('Score').locator('xpath=following-sibling::dd')).toHaveText('19/20');
});
