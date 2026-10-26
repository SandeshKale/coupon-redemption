import { normaliseCode } from '@24m/shared';
import { type ReactNode, useState } from 'react';
import { Link, useNavigate } from 'react-router';

import { useI18n } from '../../lib/i18n/index.ts';
import { useServices } from '../../lib/services.ts';
import { ResultCard, Scanner } from '../../ui/index.ts';

/** In-app single scan: a valid code goes straight to the result screen. */
export function ScanPage(): ReactNode {
  const { t } = useI18n();
  const { config } = useServices();
  const navigate = useNavigate();
  const [bad, setBad] = useState<'NOT_24M' | 'INVALID' | null>(null);
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">{t('home.scan')}</h1>
      <Scanner
        onCode={(text) => {
          const r = normaliseCode(text, config.couponHost);
          if (r.ok) void navigate(`/c/${r.code}`);
          else setBad(r.reason === 'NOT_24M' ? 'NOT_24M' : 'INVALID');
        }}
        onClose={() => void navigate('/')}
      />
      {bad === null ? null : (
        <ResultCard
          variant="invalid"
          title={bad === 'NOT_24M' ? t('result.not_24m') : t('result.invalid_format')}
        />
      )}
      <Link
        to="/type"
        className="flex min-h-12 items-center justify-center font-semibold underline underline-offset-4"
      >
        {t('home.type')}
      </Link>
    </div>
  );
}
