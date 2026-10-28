import type { ReactNode } from 'react';

import { useI18n } from '../lib/i18n/index.ts';

import { Button } from './Button.tsx';

export function EmptyState({ children }: { readonly children: ReactNode }): ReactNode {
  return <p className="rounded-card bg-surface-2 p-6 text-center text-muted">{children}</p>;
}

export function ErrorState({
  message,
  onRetry,
}: {
  readonly message?: string;
  readonly onRetry?: () => unknown;
}): ReactNode {
  const { t } = useI18n();
  return (
    <div role="alert" className="flex flex-col gap-3 rounded-card bg-danger-bg p-5 text-danger">
      <p className="font-semibold">{message ?? t('common.error')}</p>
      {onRetry === undefined ? null : (
        <Button variant="secondary" onClick={onRetry}>
          {t('common.retry')}
        </Button>
      )}
    </div>
  );
}
