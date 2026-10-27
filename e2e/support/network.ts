import type { Page } from '@playwright/test';

/** §18.5 network profiles (RTT ms / down kbps / up kbps). */
export const PROFILES = {
  '4g': { latency: 50, down: 9000, up: 3000 },
  'slow-4g': { latency: 150, down: 1600, up: 750 },
  '3g': { latency: 300, down: 750, up: 250 },
  '2g': { latency: 800, down: 240, up: 200 },
} as const;
export type Profile = keyof typeof PROFILES;

export async function throttle(page: Page, profile: Profile): Promise<void> {
  const p = PROFILES[profile];
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: p.latency,
    downloadThroughput: (p.down * 1024) / 8,
    uploadThroughput: (p.up * 1024) / 8,
  });
}
