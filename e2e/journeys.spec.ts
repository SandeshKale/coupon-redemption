import { expect, test } from '@playwright/test';

import { CODE, HOME, PROFILE, REDEEMED, signInDealer, stubApi, VALID } from './support/api.ts';

test.describe('§20.6 journeys (stubbed API)', () => {
  test('J2 redeem one → receipt → painter confirms on WhatsApp → live update', async ({ page }) => {
    await signInDealer(page);
    let polls = 0;
    let redeems = 0;
    await stubApi(
      page,
      {
        check_coupon: VALID,
        redeem: () => ((redeems += 1), REDEEMED),
        dealer_home: HOME,
        batch_status: () => ({
          batch_id: 42,
          status: ++polls > 2 ? 'CONFIRMED' : 'PENDING',
          count: 1,
          value_paise: 10000,
          token: 'K7Q2M9',
        }),
      },
      { app_user: PROFILE },
    );
    await page.goto(`/c/${CODE.toLowerCase()}`);
    await expect(page.getByRole('status').getByText('Valid coupon · ₹100')).toBeVisible();
    await page.getByRole('button', { name: '₹100 paid – Confirm' }).dblclick();
    await expect(page.getByText('Redeemed ✓ ₹100')).toBeVisible();
    await expect(page.getByText('24M PAID K7Q2M9')).toBeVisible();
    await expect(page.getByText('Painter confirmed ✓')).toBeVisible({ timeout: 15_000 });
    expect(redeems).toBe(1);
  });

  test('EC-021 used elsewhere: Do NOT pay and no confirm button', async ({ page }) => {
    await signInDealer(page);
    await stubApi(
      page,
      { check_coupon: { result: 'ALREADY_REDEEMED_OTHER' } },
      { app_user: PROFILE },
    );
    await page.goto(`/c/${CODE}`);
    await expect(page.getByRole('alert')).toContainText('Do NOT pay');
    await expect(page.getByRole('button', { name: /Confirm/ })).toHaveCount(0);
  });

  test('EC-041/042 connection drops after Confirm → "Checking result…" → resolved, never twice', async ({
    page,
  }) => {
    await signInDealer(page);
    const keys = new Set<unknown>();
    let attempts = 0;
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
          attempts += 1;
          if (attempts <= 4) {
            await route.abort('connectionreset');
            return 'handled';
          }
          return REDEEMED;
        },
        redemption_outcome: { found: true, response: REDEEMED },
      },
      { app_user: PROFILE },
    );
    await page.goto(`/c/${CODE}`);
    await page.getByRole('button', { name: '₹100 paid – Confirm' }).click();
    await expect(page.getByText('Checking result… don’t pay again')).toBeVisible();
    await expect(page.getByText('Redeemed ✓ ₹100')).toBeVisible({ timeout: 20_000 });
    expect(keys.size).toBe(1);
  });

  test('EC-043 the server never saw it → "Not redeemed. Try again."', async ({ page }) => {
    await signInDealer(page);
    await stubApi(
      page,
      {
        check_coupon: VALID,
        redeem: async (_a, route) => {
          await route.abort('connectionreset');
          return 'handled';
        },
        redemption_outcome: { found: false },
      },
      { app_user: PROFILE },
    );
    await page.goto(`/c/${CODE}`);
    await page.getByRole('button', { name: '₹100 paid – Confirm' }).click();
    await expect(page.getByText('Not redeemed. Try again.')).toBeVisible({ timeout: 20_000 });
  });

  test('EC-047 captive portal is never green', async ({ page }) => {
    await signInDealer(page);
    await page.route('http://api.e2e.test/**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: '<html>Wi-Fi login</html>' }),
    );
    await page.goto(`/c/${CODE}`);
    await expect(page.getByText('This Wi-Fi needs a login page.')).toBeVisible();
  });

  test('EC-040 offline at scan: local check only, "don’t pay yet"', async ({ page, context }) => {
    await signInDealer(page);
    await stubApi(page, { dealer_home: HOME }, { app_user: PROFILE });
    await page.goto('/');
    await expect(page.getByText('Scan coupon').first()).toBeVisible();
    await context.setOffline(true);
    // In-app navigation (as after an in-app scan): the shell is already loaded.
    await page.evaluate((c) => {
      history.pushState({}, '', `/c/${c}`);
      dispatchEvent(new PopStateEvent('popstate'));
    }, CODE);
    await expect(page.getByText('No internet. Don’t pay yet.').first()).toBeVisible();
    await context.setOffline(false);
  });

  test('EC-005 a wrong check character never reaches the network', async ({ page }) => {
    let calls = 0;
    await page.route('http://api.e2e.test/**', (route) => {
      calls += 1;
      return route.fulfill({ json: [] });
    });
    await page.goto(`/c/${CODE.slice(0, 12)}0`);
    await expect(page.getByRole('alert')).toContainText('Not a valid 24M code');
    expect(calls).toBe(0);
  });
});
