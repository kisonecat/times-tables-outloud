import { expect, test } from '@playwright/test';
import { currentProblem, say, startSpokenSession, useFakeSpeech } from './helpers';

test.describe('animation budget', () => {
  test('a right answer turns around in ≤ 750 ms, animation included', async ({ page }) => {
    await useFakeSpeech(page);
    await startSpokenSession(page);
    const turnarounds: number[] = [];

    for (let i = 0; i < 8; i++) {
      const [a, b] = await currentProblem(page);
      // Answer only once this card is legible (its think ring is running).
      await expect(page.locator('[data-running]')).toBeVisible();
      await page.evaluate(() => performance.clearMarks());
      await say(page, String(a * b));
      // Don't click Next: measure the automatic advance to the next legible card.
      const ms = await page.evaluate(
        () =>
          new Promise<number>((resolve) => {
            const check = () => {
              const commit = performance.getEntriesByName('tt:commit')[0];
              const legible = performance
                .getEntriesByName('tt:legible')
                .find((m) => commit && m.startTime > commit.startTime);
              if (commit && legible) resolve(legible.startTime - commit.startTime);
              else setTimeout(check, 10);
            };
            check();
          }),
      );
      turnarounds.push(Math.round(ms));
    }
    console.log('commit → next card legible (ms):', turnarounds);
    const sorted = [...turnarounds].sort((a, b) => a - b);
    expect(sorted[sorted.length >> 1]).toBeLessThanOrEqual(750);
    // Every sample within budget; shared CI runners get some slack for timer jitter.
    const ceiling = process.env.CI ? 850 : 750;
    for (const ms of turnarounds) expect(ms).toBeLessThanOrEqual(ceiling);
  });
});

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('nothing moves: only fades, and short ones', async ({ page }) => {
    await useFakeSpeech(page);
    await startSpokenSession(page, '2, 5, 10');

    const MOVEMENT = [
      'transform',
      'translate',
      'rotate',
      'scale',
      'top',
      'left',
      'right',
      'bottom',
      'backgroundPosition',
      'backgroundSize',
      'clipPath',
    ];
    const offenders = new Set<string>();
    const sample = async () => {
      const found = await page.evaluate((movement) => {
        const out: string[] = [];
        for (const anim of document.getAnimations()) {
          const effect = anim.effect as KeyframeEffect | null;
          if (!effect) continue;
          const target = effect.target as Element | null;
          const name =
            (anim as CSSAnimation).animationName ?? (anim as CSSTransition).transitionProperty;
          const props = new Set(effect.getKeyframes().flatMap((k) => Object.keys(k)));
          const moving = movement.filter((p) => props.has(p));
          const duration = Number(effect.getTiming().duration) || 0;
          const infinite = effect.getTiming().iterations === Infinity;
          // Custom properties (the think ring's fill, count-ups) aren't movement.
          if (
            moving.length ||
            (duration > 150 && !infinite && [...props].some((p) => p === 'opacity'))
          )
            out.push(
              `${target?.className || target?.tagName}: ${name} [${moving.join(',') || 'opacity'} ${duration}ms]`,
            );
          if (infinite && moving.length) out.push(`${target?.className}: infinite ${name}`);
        }
        return out;
      }, MOVEMENT);
      found.forEach((f) => offenders.add(f));
    };

    for (let i = 0; i < 6; i++) {
      const [a, b] = await currentProblem(page);
      await sample();
      await say(page, String(i % 3 === 2 ? a * b + 1 : a * b)); // include misses
      await page.waitForTimeout(30);
      await sample();
      await expect(page.getByRole('button', { name: 'Next →' })).toBeVisible();
      await page.getByRole('button', { name: 'Next →' }).click();
      await page.waitForTimeout(30);
      await sample();
    }
    expect([...offenders]).toEqual([]);
  });
});
