import { lazy } from 'react';

/** Non-critical routes are separate chunks, prefetched when the browser is idle (§18.2.6). */
const loaders = {
  receipt: () => import('../features/dealer/ReceiptPage.tsx'),
  bulk: () => import('../features/dealer/BulkScanPage.tsx'),
  scan: () => import('../features/dealer/ScanPage.tsx'),
  history: () => import('../features/dealer/HistoryPage.tsx'),
  claims: () => import('../features/dealer/ClaimsPage.tsx'),
  staff: () => import('../features/dealer/StaffPage.tsx'),
  login: () => import('../features/auth/LoginPage.tsx'),
  callback: () => import('../features/auth/AuthCallback.tsx'),
  privacy: () => import('./PrivacyPage.tsx'),
} as const;

export const ReceiptPage = lazy(() => loaders.receipt().then((m) => ({ default: m.ReceiptPage })));
export const BulkScanPage = lazy(() => loaders.bulk().then((m) => ({ default: m.BulkScanPage })));
export const ScanPage = lazy(() => loaders.scan().then((m) => ({ default: m.ScanPage })));
export const HistoryPage = lazy(() => loaders.history().then((m) => ({ default: m.HistoryPage })));
export const ClaimsPage = lazy(() => loaders.claims().then((m) => ({ default: m.ClaimsPage })));
export const StaffPage = lazy(() => loaders.staff().then((m) => ({ default: m.StaffPage })));
export const LoginPage = lazy(() => loaders.login().then((m) => ({ default: m.LoginPage })));
export const AuthCallback = lazy(() =>
  loaders.callback().then((m) => ({ default: m.AuthCallback })),
);
export const PrivacyPage = lazy(() => loaders.privacy().then((m) => ({ default: m.PrivacyPage })));

/** The receipt must appear instantly after Confirm: fetch its chunk as soon as a coupon is valid. */
export function prefetchReceipt(): void {
  void loaders.receipt();
}

export function prefetchDealerRoutes(win: Window = window): void {
  const nav = win.navigator as Navigator & { connection?: { saveData?: boolean } };
  if (nav.connection?.saveData === true) return;
  win.setTimeout(() => {
    void loaders.receipt();
    void loaders.scan();
    void loaders.bulk();
  }, 1500);
}
