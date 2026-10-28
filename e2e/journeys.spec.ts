import { expect, type Page, test } from '@playwright/test';

import {
  API,
  CODE,
  HOME,
  jwt,
  PROFILE,
  PUBLIC_ACTIVE,
  stubApi,
  signInDealer,
  VALID,
  VALIDATED,
} from './support/api.ts';

/** The PIN login function answers with a session; the auth SDK then asks who the user is. */
async function stubPinLogin(page: Page, status = 200): Promise<{ bodies: unknown[] }> {
  const bodies: unknown[] = [];
  const token = jwt({
    sub: 'u-1',
    aal: 'aal1',
    role: 'authenticated',
    exp: Math.floor(Date.now() / 1000) + 3600,
  });
  await page.route(`${API}/functions/v1/pin-login`, async (route) => {
    bodies.push(route.request().postDataJSON());
    if (status !== 200) return route.fulfill({ status, json: { error: 'LOGIN_FAILED' } });
    return route.fulfill({
      json: { access_token: token, refresh_token: 'r', expires_in: 3600, token_type: 'bearer' },
    });
  });
  await page.route(`${API}/auth/v1/user`, (route) =>
    route.fulfill({
      json: {
        id: 'u-1',
        aud: 'authenticated',
        role: 'authenticated',
        app_metadata: {},
        user_metadata: {},
        created_at: '2026-01-01T00:00:00Z',
      },
    }),
  );
  return { bodies };
}

test.describe('journeys (stubbed API)', () => {
  test('anyone who scans a coupon sees it is genuine and its status, with two options', async ({
    page,
  }) => {
    await stubApi(page, { public_coupon_info: PUBLIC_ACTIVE });
    await page.goto(`/c/${CODE}`);
    await expect(page.getByText('Genuine 24M coupon · ₹100')).toBeVisible();
    await expect(page.getByText('Status: Active')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Login to validate' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Go to 24M home page' })).toHaveAttribute(
      'href',
      'https://24m.in',
    );
    await expect(page.getByRole('button')).toHaveCount(0);
  });

  test('a signed-in dealer sees one button and validates once', async ({ page }) => {
    await signInDealer(page);
    let validations = 0;
    await stubApi(
      page,
      {
        check_coupon: VALID,
        validate_coupon: () => ((validations += 1), VALIDATED),
        dealer_home: HOME,
      },
      { app_user: PROFILE },
    );
    await page.goto(`/c/${CODE.toLowerCase()}`);
    await expect(page.getByRole('status').getByText('Valid coupon · ₹100')).toBeVisible();
    await expect(page.getByRole('button')).toHaveCount(1);
    await page.getByRole('button', { name: 'Validate coupon' }).dblclick();
    await expect(page.getByText('Validated ✓')).toBeVisible();
    expect(validations).toBe(1);
  });

  test('login with mobile number and PIN from a coupon page, then validate', async ({ page }) => {
    let signedIn = false;
    await stubApi(
      page,
      {
        public_coupon_info: PUBLIC_ACTIVE,
        check_coupon: () => (signedIn ? VALID : { result: 'AUTH_REQUIRED' }),
        validate_coupon: VALIDATED,
        dealer_home: HOME,
      },
      { app_user: PROFILE },
    );
    const login = await stubPinLogin(page);
    await page.goto(`/c/${CODE}`);
    await page.getByRole('link', { name: 'Login to validate' }).click();
    await expect(page).toHaveURL(/\/login\?next=/);
    await page.getByLabel('Registered mobile number').fill('98000 00001');
    await page.getByLabel('4-digit PIN').fill('4817');
    signedIn = true;
    await page.getByRole('button', { name: 'Log in' }).first().click();
    await expect(page).toHaveURL(new RegExp(`/c/${CODE}$`));
    await page.getByRole('button', { name: 'Validate coupon' }).click();
    await expect(page.getByText('Validated ✓')).toBeVisible();
    expect(login.bodies).toEqual([{ mobile: '+919800000001', pin: '4817' }]);
    // The same device stays signed in for the next coupon.
    await page.goto(`/c/${CODE}`);
    await expect(page.getByRole('button', { name: 'Validate coupon' })).toBeVisible();
  });

  test('a wrong PIN says so and does not log in', async ({ page }) => {
    await stubApi(page, {});
    await stubPinLogin(page, 401);
    await page.goto('/login');
    await page.getByLabel('Registered mobile number').fill('9800000001');
    await page.getByLabel('4-digit PIN').fill('1357');
    await page.getByRole('button', { name: 'Log in' }).first().click();
    await expect(page.getByText(/Wrong mobile number or PIN/)).toBeVisible();
    await expect(page.getByLabel('4-digit PIN')).toHaveValue('');
  });

  test('a coupon another dealer validated cannot be validated again', async ({ page }) => {
    await signInDealer(page);
    await stubApi(
      page,
      { check_coupon: { result: 'ALREADY_REDEEMED_OTHER' } },
      { app_user: PROFILE },
    );
    await page.goto(`/c/${CODE}`);
    await expect(page.getByRole('status')).toContainText('Already validated by another dealer.');
    await expect(page.getByRole('button', { name: 'Validate coupon' })).toHaveCount(0);
  });

  test('the connection drops while validating: a clear message and a retry', async ({ page }) => {
    await signInDealer(page);
    let attempts = 0;
    await stubApi(
      page,
      {
        check_coupon: VALID,
        dealer_home: HOME,
        validate_coupon: async (_a, route) => {
          attempts += 1;
          if (attempts === 1) {
            await route.abort('connectionreset');
            return 'handled';
          }
          return VALIDATED;
        },
      },
      { app_user: PROFILE },
    );
    await page.goto(`/c/${CODE}`);
    await page.getByRole('button', { name: 'Validate coupon' }).click();
    await expect(page.getByText('No internet. Try again when you are online.')).toBeVisible();
    await page.getByRole('button', { name: 'Try again' }).click();
    await page.getByRole('button', { name: 'Validate coupon' }).click();
    await expect(page.getByText('Validated ✓')).toBeVisible();
  });

  test('a captive Wi-Fi page is never treated as an answer', async ({ page }) => {
    await signInDealer(page);
    await page.route('http://api.e2e.test/**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: '<html>Wi-Fi login</html>' }),
    );
    await page.goto(`/c/${CODE}`);
    await expect(page.getByText('This Wi-Fi needs a login page.')).toBeVisible();
  });

  test('offline at scan: local check only, a clear message', async ({ page, context }) => {
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
    await expect(
      page.getByText('No internet. Try again when you are online.').first(),
    ).toBeVisible();
    await context.setOffline(false);
  });

  test('a wrong check character never reaches the network', async ({ page }) => {
    let calls = 0;
    await page.route('http://api.e2e.test/**', (route) => {
      // The page header reads the helpline in the background; that is not a coupon check.
      if (!route.request().url().endsWith('/rpc/public_helpline')) calls += 1;
      return route.fulfill({ json: [] });
    });
    await page.goto(`/c/${CODE.slice(0, 12)}0`);
    await expect(page.getByRole('alert')).toContainText('Not a valid 24M code');
    expect(calls).toBe(0);
  });
});
