import { expect, test } from '@playwright/test';
import { currentProblem, say, startSpokenSession, useFakeSpeech } from './helpers';

/** A right answer must turn around to a readable next card within this (PLAN §10, phase 3). */
const BUDGET_MS = 750;

test.describe('animation budget', () => {
  test('the choreography is designed to turn a right answer around in ≤ 750 ms', async ({
    page,
  }) => {
    await page.goto('/');
    // The real motion tokens, as the browser resolves them.
    const t = await page.evaluate(() => {
      const ms = (name: string) => {
        const probe = document.createElement('div');
        probe.style.transitionDuration = `var(${name})`;
        document.body.appendChild(probe);
        const v = getComputedStyle(probe).transitionDuration;
        probe.remove();
        return parseFloat(v) * (v.endsWith('ms') ? 1 : 1000);
      };
      return { hold: ms('--hold-correct'), roll: ms('--dur-roll'), stagger: ms('--stagger-digit') };
    });
    // Feedback hold, then the next card is legible once its last digit has rolled in. The
    // worst case is four digits plus the ×: the last digit starts 4 staggers in.
    const worstCase = t.hold + 4 * t.stagger + t.roll;
    console.log('designed turnaround (ms):', t, '→', worstCase);
    expect(worstCase).toBeLessThanOrEqual(BUDGET_MS - 50); // leave room for real frames
  });

  test('a right answer turns around in ≤ 750 ms, measured', async ({ page }) => {
    // Wall-clock timing on a shared 2-core CI runner measures the runner, not the app
    // (CI has shown 680–880 ms where a laptop shows 620–660). The design check above runs
    // everywhere; this measurement runs locally.
    test.skip(!!process.env.CI, 'wall-clock budget is checked locally');
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
    for (const ms of turnarounds) expect(ms).toBeLessThanOrEqual(BUDGET_MS);
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
