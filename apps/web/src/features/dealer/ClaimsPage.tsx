import { type ReactNode, useCallback, useEffect, useState } from 'react';
import * as v from 'valibot';

import { useI18n } from '../../lib/i18n/index.ts';
import { useServices } from '../../lib/services.ts';
import { QrSvg } from '../../ui/QrBlock.tsx';
import { Button, EmptyState, ErrorState, Skeleton, StatusPill } from '../../ui/index.ts';

const Claims = v.array(
  v.object({
    id: v.number(),
    status: v.picklist(['OPEN', 'SUBMITTED', 'CN_ISSUED', 'ACKNOWLEDGED']),
    cn_no: v.nullable(v.string()),
    cn_date: v.nullable(v.string()),
    cn_total_paise: v.nullable(v.number()),
    lines: v.number(),
    value_paise: v.number(),
    slip_token: v.string(),
  }),
);
type Claims = v.InferOutput<typeof Claims>;

/** Dealer owner: claims, submit early, claim slip QR, mark CN received (§5.3). */
export function ClaimsPage(): ReactNode {
  const i = useI18n();
  const { api } = useServices();
  const [rows, setRows] = useState<Claims | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [slip, setSlip] = useState<string | null>(null);
  const load = useCallback(async () => {
    const r = await api.rpc('my_claims', { p_limit: 24 }, Claims);
    if (r.ok) setRows(r.data);
    else setError(i.t('common.error'));
  }, [api, i]);
  useEffect(() => {
    void load();
  }, [load]);
  const act = async (fn: string, args: Record<string, unknown>): Promise<void> => {
    const r = await api.rpc(fn, args, v.unknown());
    setError(r.ok ? null : i.t('common.error'));
    await load();
  };
  if (rows === null)
    return error === null ? <Skeleton /> : <ErrorState onRetry={() => void load()} />;
  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-2xl font-bold">{i.t('claims.title')}</h1>
      {error === null ? null : <ErrorState message={error} />}
      {rows.length === 0 ? <EmptyState>{i.t('claims.empty')}</EmptyState> : null}
      <ul className="flex flex-col gap-3">
        {rows.map((c) => (
          <li key={c.id} className="flex flex-col gap-2 rounded-card border border-border p-3">
            <p className="flex items-center justify-between">
              <span className="font-semibold">{`#${c.id}`}</span>
              <StatusPill tone={c.status === 'ACKNOWLEDGED' ? 'good' : 'neutral'}>
                {i.t(`status.${c.status}`)}
              </StatusPill>
            </p>
            <p>{i.t('claims.lines', { count: c.lines, amount: i.money(c.value_paise) })}</p>
            {c.cn_no === null || c.cn_date === null ? null : (
              <p>{i.t('claims.cn', { no: c.cn_no, date: i.date(c.cn_date) })}</p>
            )}
            {c.status === 'OPEN' && c.lines > 0 ? (
              <Button onClick={() => void act('submit_dealer_claim', {})}>
                {i.t('claims.submit')}
              </Button>
            ) : null}
            {c.status === 'CN_ISSUED' ? (
              <Button onClick={() => void act('ack_dealer_cn', { p_claim_id: c.id })}>
                {i.t('claims.markReceived')}
              </Button>
            ) : null}
            {c.status === 'SUBMITTED' ? (
              <Button
                variant="secondary"
                onClick={() => {
                  setSlip(slip === c.slip_token ? null : c.slip_token);
                }}
              >
                {i.t('claims.slip')}
              </Button>
            ) : null}
            {slip === c.slip_token ? (
              <figure className="flex flex-col items-center gap-2">
                <QrSvg
                  value={`${window.location.origin}/d/slip/${c.slip_token}`}
                  label={i.t('claims.slip')}
                />
                <figcaption className="text-center text-sm">{i.t('claims.slipHelp')}</figcaption>
              </figure>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
