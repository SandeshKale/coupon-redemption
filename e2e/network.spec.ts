import { expect, test } from '@playwright/test';

import { CODE, HOME, PROFILE, signInDealer, stubApi, VALID, VALIDATED } from './support/api.ts';
import { type Profile, throttle } from './support/network.ts';

// §18.5 targets with a cached app shell: scan → result and validate → done.
const TARGET_MS: Record<Profile, number> = { '4g': 1000, 'slow-4g': 1500, '3g': 3000, '2g': 6000 };
const nightlyOnly = new Set<Profile>(['2g']);

test.beforeEach(({ browserName }) => {
  test.skip(browserName !== 'chromium', 'CDP network throttling is Chromium-only');
});

for (const profile of Object.keys(TARGET_MS) as Profile[]) {
  test(`§18.5 ${profile}: scan → result and validate → done within ${TARGET_MS[profile]} ms`, async ({
    page,
  }) => {
    test.skip(
      nightlyOnly.has(profile) && process.env['E2E_NIGHTLY'] === undefined,
      'nightly profile',
    );
    await signInDealer(page);
    await stubApi(
      page,
      {
        check_coupon: VALID,
        validate_coupon: VALIDATED,
        dealer_home: HOME,
      },
      { app_user: PROFILE },
    );
    await page.goto('/'); // warm the app shell + service worker
    await expect(page.getByText('Scan coupon').first()).toBeVisible();
    await page.waitForTimeout(2500); // idle prefetch of the scanner chunk
    await throttle(page, profile);

    const t0 = Date.now();
    await page.goto(`/c/${CODE}`);
    await expect(page.getByText('Valid coupon · ₹100')).toBeVisible();
    const scanToResult = Date.now() - t0;

    const t1 = Date.now();
    await page.getByRole('button', { name: 'Validate coupon' }).click();
    await expect(page.getByText('Validated ✓')).toBeVisible();
    const confirmToReceipt = Date.now() - t1;

    test.info().annotations.push({
      type: 'timing',
      description: `${profile}: scan→result ${scanToResult} ms, validate→done ${confirmToReceipt} ms`,
    });
    expect(scanToResult).toBeLessThanOrEqual(TARGET_MS[profile]);
    expect(confirmToReceipt).toBeLessThanOrEqual(TARGET_MS[profile]);
  });
}

test('§18.5 flaky (3G, 20% request failures): the dealer can always retry to a correct final result', async ({
  page,
}) => {
  test.skip(process.env['E2E_NIGHTLY'] === undefined, 'nightly profile');
  await signInDealer(page);
  let n = 0;
  await stubApi(
    page,
    {
      check_coupon: VALID,
      dealer_home: HOME,
      validate_coupon: async (_args, route) => {
        if (++n % 5 === 1) {
          await route.abort('connectionreset');
          return 'handled';
        }
        return VALIDATED;
      },
    },
    { app_user: PROFILE },
  );
  await page.goto('/');
  await throttle(page, '3g');
  await page.goto(`/c/${CODE}`);
  await page.getByRole('button', { name: 'Validate coupon' }).click();
  await page.getByRole('button', { name: 'Try again' }).click();
  await page.getByRole('button', { name: 'Validate coupon' }).click();
  await expect(page.getByText('Validated ✓')).toBeVisible({ timeout: 30_000 });
});
