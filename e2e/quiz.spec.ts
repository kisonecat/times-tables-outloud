import { expect, test } from '@playwright/test';
import { currentProblem, say, startSpokenSession, useFakeSpeech } from './helpers';

/**
 * Smoke test of the whole quiz loop: create a learner, pick browser speech, answer 20
 * problems out loud (through the fake engine), and land on results.
 */
test('a spoken 20-problem session reaches results', async ({ page }) => {
  await useFakeSpeech(page);
  await startSpokenSession(page);

  for (let i = 0; i < 20; i++) {
    const [a, b] = await currentProblem(page);
    await expect(page.getByText('Listening…')).toBeVisible();
    const answer = i === 7 ? a * b + 1 : a * b;
    await say(page, String(answer));
    await expect(page.getByText(i === 7 ? /it’s \d+/ : 'Yes!')).toBeVisible();
    await page.getByRole('button', { name: 'Next →' }).click();
  }

  await expect(page.getByRole('heading', { name: 'Nice work!' })).toBeVisible();
  await expect(page.getByText('Score').locator('xpath=following-sibling::dd')).toHaveText('19/20');
});
