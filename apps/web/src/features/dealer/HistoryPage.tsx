import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';

import { ValidationList } from '../../lib/api/schemas.ts';
import { useI18n } from '../../lib/i18n/index.ts';
import { useServices } from '../../lib/services.ts';
import { Button, EmptyState, ErrorState, Icon, Money, Skeleton } from '../../ui/index.ts';

const PAGE = 20;

/** The coupons this shop has validated, newest first. */
export function HistoryPage(): ReactNode {
  const i = useI18n();
  const { api } = useServices();
  const [rows, setRows] = useState<ValidationList | null>(null);
  const [error, setError] = useState(false);
  const [more, setMore] = useState(true);
  const load = useCallback(
    async (before: string | null) => {
      const r = await api.rpc(
        'my_validations',
        { p_limit: PAGE, p_before: before },
        ValidationList,
      );
      if (!r.ok) {
        setError(true);
        return;
      }
      setError(false);
      setMore(r.data.length === PAGE);
      setRows((xs) => (before === null ? r.data : [...(xs ?? []), ...r.data]));
    },
    [api],
  );
  useEffect(() => {
    void load(null);
  }, [load]);
  if (rows === null) return error ? <ErrorState onRetry={() => load(null)} /> : <Skeleton />;
  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-2xl font-bold">{i.t('history.title')}</h1>
      {rows.length === 0 ? (
        <>
          <EmptyState>{i.t('history.empty')}</EmptyState>
          <Link
            to="/scan"
            className="flex min-h-14 items-center justify-center gap-2 rounded-btn bg-success text-lg font-semibold text-white"
          >
            <Icon name="scan" />
            {i.t('home.scan')}
          </Link>
        </>
      ) : null}
      <ul className="flex flex-col gap-2">
        {rows.map((b) => (
          <li key={b.serial} className="flex flex-col gap-1 rounded-card border border-border p-3">
            <p className="flex justify-between font-semibold">
              <span>{b.serial}</span>
              <Money paise={b.value_paise} />
            </p>
            <p className="text-sm text-muted">
              {i.dateTime(b.validated_at)} · {i.t('history.by', { name: b.validated_by })}
            </p>
          </li>
        ))}
      </ul>
      {more && rows.length > 0 ? (
        <Button
          variant="secondary"
          onClick={() => load(rows[rows.length - 1]?.validated_at ?? null)}
        >
          {i.t('history.more')}
        </Button>
      ) : null}
    </div>
  );
}
