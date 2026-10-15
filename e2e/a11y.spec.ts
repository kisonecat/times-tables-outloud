import { expect, test } from '@playwright/test';
import { currentProblem, startSpokenSession, useFakeSpeech } from './helpers';

test('the problem reads as "a times b", not as odometer digits', async ({ page }) => {
  await useFakeSpeech(page);
  await startSpokenSession(page);
  const [a, b] = await currentProblem(page);
  const heading = page.getByRole('heading', { name: `${a} times ${b}` });
  await expect(heading).toBeVisible();
  // Nothing inside the heading is exposed except its name.
  expect(await heading.ariaSnapshot()).toBe(`- heading "${a} times ${b}" [level=2]`);
});
