import { expect, test } from '@playwright/test';

import { CODE, HOME, PROFILE, REDEEMED, signInDealer, stubApi, VALID } from './support/api.ts';
import { type Profile, throttle } from './support/network.ts';

// §18.5 targets with a cached app shell: scan → result and confirm → receipt.
const TARGET_MS: Record<Profile, number> = { '4g': 1000, 'slow-4g': 1500, '3g': 3000, '2g': 6000 };
const nightlyOnly = new Set<Profile>(['2g']);

for (const profile of Object.keys(TARGET_MS) as Profile[]) {
  test(`§18.5 ${profile}: scan → result and confirm → receipt within ${TARGET_MS[profile]} ms`, async ({
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
        redeem: REDEEMED,
        dealer_home: HOME,
        batch_status: {
          batch_id: 42,
          status: 'PENDING',
          count: 1,
          value_paise: 10000,
          token: 'K7Q2M9',
        },
      },
      { app_user: PROFILE },
    );
    await page.goto('/'); // warm the app shell + service worker
    await expect(page.getByText('Scan coupon').first()).toBeVisible();
    await page.waitForTimeout(2500); // idle prefetch of receipt/scanner chunks
    await throttle(page, profile);

    const t0 = Date.now();
    await page.goto(`/c/${CODE}`);
    await expect(page.getByText('Valid coupon · ₹100')).toBeVisible();
    const scanToResult = Date.now() - t0;

    const t1 = Date.now();
    await page.getByRole('button', { name: '₹100 paid – Confirm' }).click();
    await expect(page.getByText('Redeemed ✓ ₹100')).toBeVisible();
    const confirmToReceipt = Date.now() - t1;

    test.info().annotations.push({
      type: 'timing',
      description: `${profile}: scan→result ${scanToResult} ms, confirm→receipt ${confirmToReceipt} ms`,
    });
    expect(scanToResult).toBeLessThanOrEqual(TARGET_MS[profile]);
    expect(confirmToReceipt).toBeLessThanOrEqual(TARGET_MS[profile]);
  });
}

test('§18.5 flaky (3G, 20% request failures): correct final result, never a duplicate', async ({
  page,
}) => {
  test.skip(process.env['E2E_NIGHTLY'] === undefined, 'nightly profile');
  await signInDealer(page);
  const keys = new Set<unknown>();
  let n = 0;
  await stubApi(
    page,
    {
      check_coupon: VALID,
      dealer_home: HOME,
      batch_status: {
        batch_id: 42,
        status: 'PENDING',
        count: 1,
        value_paise: 10000,
        token: 'K7Q2M9',
      },
      redeem: async (args, route) => {
        keys.add(args['p_idem']);
        if (++n % 5 === 1) {
          await route.abort('connectionreset');
          return 'handled';
        }
        return REDEEMED;
      },
      redemption_outcome: { found: true, response: REDEEMED },
    },
    { app_user: PROFILE },
  );
  await page.goto('/');
  await throttle(page, '3g');
  await page.goto(`/c/${CODE}`);
  await page.getByRole('button', { name: '₹100 paid – Confirm' }).click();
  await expect(page.getByText('Redeemed ✓ ₹100')).toBeVisible({ timeout: 30_000 });
  expect(keys.size).toBe(1);
});
