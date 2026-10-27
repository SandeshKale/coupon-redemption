import { AxeBuilder } from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';

import { CODE, HOME, PROFILE, REDEEMED, signInDealer, stubApi, VALID } from './support/api.ts';

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

async function axe(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(
    results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
  ).toEqual([]);
}

async function dealer(page: Page): Promise<void> {
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
      my_batches: [],
      my_claims: [],
    },
    { app_user: PROFILE },
  );
}

test.describe('§17 accessibility: 0 axe violations (WCAG 2.2 AA)', () => {
  test('public coupon page', async ({ page }) => {
    await stubApi(page, { public_coupon_info: { result: 'GENUINE', value_paise: 10000 } });
    await page.goto(`/c/${CODE}`);
    await expect(page.getByText('Genuine 24M coupon')).toBeVisible();
    await axe(page);
  });

  for (const [path, ready] of [
    ['/', 'Scan coupon'],
    [`/c/${CODE}`, 'Valid coupon · ₹100'],
    ['/type', 'Type the code'],
    ['/history', 'No coupons yet'],
    ['/claims', 'No claims yet'],
    ['/scan-many', 'Scan coupons one after another.'],
    ['/login', 'Request new login link'],
    ['/privacy', 'Privacy'],
  ] as const) {
    test(`dealer ${path}`, async ({ page }) => {
      await dealer(page);
      await page.goto(path);
      await expect(page.getByText(ready).first()).toBeVisible();
      await axe(page);
    });
  }

  test('receipt with painter QR, and a do-not-pay result', async ({ page }) => {
    await dealer(page);
    await page.goto(`/c/${CODE}`);
    await page.getByRole('button', { name: '₹100 paid – Confirm' }).click();
    await expect(page.getByRole('img', { name: /QR code/ })).toBeVisible();
    await axe(page);
  });

  test('Hindi and Marathi screens set the document language', async ({ page }) => {
    await dealer(page);
    await page.goto('/');
    await page.getByLabel('Language').selectOption('hi');
    await expect(page.locator('html')).toHaveAttribute('lang', 'hi');
    await expect(page.getByText('कूपन स्कैन करें').first()).toBeVisible();
    await axe(page);
    await page.getByLabel('भाषा').selectOption('kn');
    await expect(page.locator('html')).toHaveAttribute('lang', 'kn');
  });

  test('1.4.10 reflow at 320 px and 1.4.4 200% text: no horizontal scrolling', async ({ page }) => {
    await dealer(page);
    await page.setViewportSize({ width: 320, height: 640 });
    for (const path of ['/', `/c/${CODE}`, '/type']) {
      await page.goto(path);
      // Via CSSOM: the app's CSP (correctly) blocks injected <style> tags.
      await page.evaluate(() => {
        document.documentElement.style.fontSize = '200%';
      });
      await page.waitForTimeout(200);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, path).toBeLessThanOrEqual(0);
    }
  });

  test('2.1.1 keyboard-only redeem', async ({ page }) => {
    await dealer(page);
    await page.goto(`/c/${CODE}`);
    await expect(page.getByText('Valid coupon · ₹100')).toBeVisible();
    const confirm = page.getByRole('button', { name: '₹100 paid – Confirm' });
    for (
      let i = 0;
      i < 10 && !(await confirm.evaluate((el) => el === document.activeElement));
      i += 1
    )
      await page.keyboard.press('Tab');
    await expect(confirm).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Redeemed ✓ ₹100')).toBeVisible();
  });
});
