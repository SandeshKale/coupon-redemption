import { type ReactNode, useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router';
import * as v from 'valibot';

import { BatchStatus, RedeemResponse } from '../../lib/api/schemas.ts';
import { useI18n } from '../../lib/i18n/index.ts';
import { useServices } from '../../lib/services.ts';
import { ResultCard, Skeleton } from '../../ui/index.ts';

import { resultView } from './resultCopy.ts';

/** What the receipt shows: from the redeem response if we just paid, else from the saved batch. */
export function summarise(
  response: RedeemResponse | null,
  batch: BatchStatus | null,
): {
  readonly count: number;
  readonly value: number;
  readonly partial: boolean;
  readonly failed: RedeemResponse['lines'];
} {
  if (response === null) {
    return { count: batch?.count ?? 0, value: batch?.value_paise ?? 0, partial: false, failed: [] };
  }
  return {
    count: response.count ?? 0,
    value: response.value_paise ?? 0,
    partial: response.result === 'PARTIAL',
    failed: response.lines.filter((l) => l.result !== 'REDEEMED'),
  };
}

/** Receipt after the dealer taps "Paid". Nothing else to wait for. */
export function ReceiptPage(): ReactNode {
  const params = useParams();
  const batchId = Number(params['batchId']);
  const initial = v.safeParse(RedeemResponse, useLocation().state);
  const response = initial.success ? initial.output : null;
  const i = useI18n();
  const { api } = useServices();
  const [batch, setBatch] = useState<BatchStatus | null>(null);
  useEffect(() => {
    if (response !== null) return;
    void api.rpc('batch_status', { p_batch_id: batchId }, BatchStatus).then((r) => {
      if (r.ok) setBatch(r.data);
    });
  }, [api, batchId, response]);
  if (batch === null && response === null) return <Skeleton />;
  const sum = summarise(response, batch);
  return (
    <div className="flex flex-col gap-4">
      <ResultCard variant="valid" title={i.t('receipt.title', { amount: i.money(sum.value) })}>
        <p>
          {sum.partial
            ? i.t('receipt.partial', { ok: sum.count, total: sum.count + sum.failed.length })
            : i.t('receipt.count', { count: sum.count })}
        </p>
      </ResultCard>
      <FailedLines lines={sum.failed} />
      <Link
        to="/scan"
        className="flex min-h-14 items-center justify-center rounded-btn border-2 border-border font-semibold"
      >
        {i.t('action.scanNext')}
      </Link>
    </div>
  );
}

function FailedLines({ lines }: { readonly lines: RedeemResponse['lines'] }): ReactNode {
  const i = useI18n();
  if (lines.length === 0) return null;
  return (
    <section className="rounded-card border-2 border-danger p-4">
      <h2 className="font-bold text-danger">{i.t('receipt.failedLines')}</h2>
      <ul>
        {lines.map((l, idx) => (
          <li key={`${l.code ?? ''}-${String(idx)}`}>
            {l.serial ?? l.code ?? ''} {resultView(l.result, l, i).title}
          </li>
        ))}
      </ul>
    </section>
  );
}
