import { defineConfig, devices } from '@playwright/test';

/**
 * E2E against the production build (vite preview). The API is stubbed at the network layer
 * (e2e/support/api.ts) so journeys, axe checks and network profiles are deterministic; the
 * same specs run against a real `supabase start` stack in CI when E2E_LIVE=1.
 */
export default defineConfig({
  testDir: '.',
  timeout: 60_000,
  fullyParallel: true,
  retries: process.env['CI'] === undefined ? 0 : 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: '../playwright-report' }]],
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
    locale: 'en-IN',
    timezoneId: 'Asia/Kolkata',
  },
  webServer: {
    command: 'pnpm --filter @24m/web build && pnpm --filter @24m/web preview',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
    timeout: 180_000,
    env: {
      VITE_SUPABASE_URL: 'http://api.e2e.test',
      VITE_SUPABASE_ANON_KEY: 'anon',
      VITE_COUPON_HOST: 'c.example.in',
      VITE_HELPLINE: '+91 20 0000 0000',
    },
  },
  projects: [
    { name: 'pixel5', use: { ...devices['Pixel 5'] } },
    { name: 'iphone13', use: { ...devices['iPhone 13'], browserName: 'chromium' } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
  ],
});
