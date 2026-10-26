import type { ReactNode } from 'react';

import { useI18n } from '../lib/i18n/index.ts';

export function PrivacyPage(): ReactNode {
  const { t } = useI18n();
  return (
    <article className="flex flex-col gap-3">
      <h1 className="text-2xl font-bold">{t('privacy.title')}</h1>
      <p>{t('privacy.body')}</p>
    </article>
  );
}
