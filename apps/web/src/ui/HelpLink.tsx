import type { ReactNode } from 'react';

import { useI18n } from '../lib/i18n/index.ts';

/** 3.2.6 consistent help: same place on every screen. */
export function HelpLink({ phone }: { readonly phone: string | null }): ReactNode {
  const { t } = useI18n();
  if (phone === null || phone === '') return null;
  return (
    <a
      href={`tel:${phone.replace(/\s/g, '')}`}
      className="inline-flex min-h-12 items-center font-semibold underline underline-offset-4"
      aria-label={t('help.call', { phone })}
    >
      {t('help.label')}
    </a>
  );
}
