import { lazy } from 'react';

/** Non-critical routes are separate chunks, prefetched when the browser is idle (§18.2.6). */
const loaders = {
  scan: () => import('../features/dealer/ScanPage.tsx'),
  history: () => import('../features/dealer/HistoryPage.tsx'),
  pin: () => import('../features/dealer/PinPage.tsx'),
  login: () => import('../features/auth/LoginPage.tsx'),
  privacy: () => import('./PrivacyPage.tsx'),
} as const;

export const ScanPage = lazy(() => loaders.scan().then((m) => ({ default: m.ScanPage })));
export const HistoryPage = lazy(() => loaders.history().then((m) => ({ default: m.HistoryPage })));
export const PinPage = lazy(() => loaders.pin().then((m) => ({ default: m.PinPage })));
export const LoginPage = lazy(() => loaders.login().then((m) => ({ default: m.LoginPage })));
export const PrivacyPage = lazy(() => loaders.privacy().then((m) => ({ default: m.PrivacyPage })));

export function prefetchDealerRoutes(win: Window = window): void {
  const nav = win.navigator as Navigator & { connection?: { saveData?: boolean } };
  if (nav.connection?.saveData === true) return;
  win.setTimeout(() => {
    void loaders.scan();
  }, 1500);
}
