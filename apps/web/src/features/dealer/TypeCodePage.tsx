import type { ReactNode } from 'react';
import { useNavigate } from 'react-router';

import { useI18n } from '../../lib/i18n/index.ts';
import { CodeInput } from '../../ui/index.ts';

export function TypeCodePage(): ReactNode {
  const { t } = useI18n();
  const navigate = useNavigate();
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">{t('type.title')}</h1>
      <CodeInput onValid={(code) => void navigate(`/c/${code}`)} />
    </div>
  );
}
