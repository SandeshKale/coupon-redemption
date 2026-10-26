import type { ReactNode } from 'react';

import { useI18n } from '../lib/i18n/index.ts';

/** Fixed-size placeholder (no layout shift, §18.2.7). */
export function Skeleton({ lines = 3 }: { readonly lines?: number }): ReactNode {
  const { t } = useI18n();
  return (
    <div
      role="status"
      aria-label={t('common.loading')}
      className="min-h-40 animate-pulse rounded-card bg-surface-2 p-5"
    >
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="mb-3 h-5 rounded bg-white" />
      ))}
    </div>
  );
}
