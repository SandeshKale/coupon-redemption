import { expect, test } from '@playwright/test';

import { CODE, HOME, PROFILE, REDEEMED, signInDealer, stubApi, VALID } from './support/api.ts';

test.describe('§20.6 journeys (stubbed API)', () => {
  test('J2 scan → Paid ₹100 to painter → receipt', async ({ page }) => {
    await signInDealer(page);
    let redeems = 0;
    await stubApi(
      page,
      {
        check_coupon: VALID,
        redeem: () => ((redeems += 1), REDEEMED),
        dealer_home: HOME,
      },
      { app_user: PROFILE },
    );
    await page.goto(`/c/${CODE.toLowerCase()}`);
    await expect(page.getByRole('status').getByText('Valid coupon · ₹100')).toBeVisible();
    await expect(page.getByRole('button')).toHaveCount(2);
    await page.getByRole('button', { name: 'Paid ₹100 to painter' }).dblclick();
    await expect(page.getByText('Redeemed ✓ ₹100')).toBeVisible();
    await expect(page.getByRole('img')).toHaveCount(0);
    expect(redeems).toBe(1);
  });

  test('J3 scan → Declined to pay → noted, nothing redeemed', async ({ page }) => {
    await signInDealer(page);
    let redeems = 0;
    let declines = 0;
    await stubApi(
      page,
      {
        check_coupon: VALID,
        redeem: () => ((redeems += 1), REDEEMED),
        decline_payment: () => (
          (declines += 1),
          { result: 'DECLINED', serial: 'P24-0000001', value_paise: 10000 }
        ),
        dealer_home: HOME,
      },
      { app_user: PROFILE },
    );
    await page.goto(`/c/${CODE}`);
    await page.getByRole('button', { name: 'Declined to pay' }).click();
    await expect(page.getByText('Noted: you did not pay. The coupon stays valid.')).toBeVisible();
    expect(declines).toBe(1);
    expect(redeems).toBe(0);
  });

  test('EC-021 used elsewhere: Do NOT pay and no pay or decline buttons', async ({ page }) => {
    await signInDealer(page);
    await stubApi(
      page,
      { check_coupon: { result: 'ALREADY_REDEEMED_OTHER' } },
      { app_user: PROFILE },
    );
    await page.goto(`/c/${CODE}`);
    await expect(page.getByRole('alert')).toContainText('Do NOT pay');
    await expect(page.getByRole('button', { name: /Paid|Declined/ })).toHaveCount(0);
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
    await page.getByRole('button', { name: 'Paid ₹100 to painter' }).click();
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
    await page.getByRole('button', { name: 'Paid ₹100 to painter' }).click();
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
