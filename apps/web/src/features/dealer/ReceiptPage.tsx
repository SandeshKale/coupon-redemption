import { painterConfirmLink, painterConfirmText } from '@24m/shared';
import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router';
import * as v from 'valibot';

import { BatchStatus, DealerHome, RedeemResponse } from '../../lib/api/schemas.ts';
import { type Key, useI18n } from '../../lib/i18n/index.ts';
import { useNetwork } from '../../lib/network/status.ts';
import { useServices } from '../../lib/services.ts';
import { QrSvg } from '../../ui/QrBlock.tsx';
import { Button, ResultCard, type ResultVariant, Skeleton } from '../../ui/index.ts';

import { resultView } from './resultCopy.ts';

const FINAL = new Set(['CONFIRMED', 'LATE', 'DISPUTED', 'SKIPPED', 'EXPIRED', 'NONE']);
export const WARN_MS = 8 * 60_000;
export const HIDE_MS = 10 * 60_000;

/** Polls batch_status until the painter outcome is final (3 s, or 6 s on slow networks). */
function useBatchStatus(batchId: number): { status: BatchStatus | null; refresh: () => void } {
  const { api } = useServices();
  const net = useNetwork();
  const [status, setStatus] = useState<BatchStatus | null>(null);
  const poll = useCallback(async () => {
    const r = await api.rpc('batch_status', { p_batch_id: batchId }, BatchStatus, {
      timeoutMs: 10_000,
    });
    if (r.ok) setStatus(r.data);
  }, [api, batchId]);
  useEffect(() => {
    void poll();
  }, [poll]);
  useEffect(() => {
    if ((status !== null && FINAL.has(status.status)) || net === 'offline') return undefined;
    const id = window.setInterval(
      () => {
        if (document.visibilityState === 'visible') void poll();
      },
      net === 'slow' ? 6000 : 3000,
    );
    return () => {
      window.clearInterval(id);
    };
  }, [net, poll, status]);
  return { status, refresh: () => void poll() };
}

function useWaNumber(): string | null {
  const { api } = useServices();
  const [n, setN] = useState<string | null>(null);
  useEffect(() => {
    void api.rpc('dealer_home', {}, DealerHome).then((r) => {
      if (r.ok) setN(r.data.wa_business_number);
    });
  }, [api]);
  return n;
}

interface Summary {
  readonly count: number;
  readonly value: number;
  readonly partial: boolean;
  readonly failed: RedeemResponse['lines'];
  readonly token: string | null;
}

/** Combines the redeem response (if we just redeemed) with the latest server status. */
export function summarise(response: RedeemResponse | null, status: BatchStatus | null): Summary {
  if (response === null) {
    return {
      count: status?.count ?? 0,
      value: status?.value_paise ?? 0,
      partial: false,
      failed: [],
      token: status?.token ?? null,
    };
  }
  const liveToken = status === null ? response.painter_token : status.token;
  return {
    count: response.count ?? 0,
    value: response.value_paise ?? 0,
    partial: response.result === 'PARTIAL',
    failed: response.lines.filter((l) => l.result !== 'REDEEMED'),
    token: liveToken ?? null,
  };
}

/** Receipt + painter QR + live confirmation status (§4.1 step 6, §4.2 step 4). */
export function ReceiptPage(): ReactNode {
  const params = useParams();
  const batchId = Number(params['batchId']);
  const location = useLocation();
  const initial = v.safeParse(RedeemResponse, location.state);
  const response = initial.success ? initial.output : null;
  const i = useI18n();
  const { status, refresh } = useBatchStatus(batchId);
  const waNumber = useWaNumber();
  if (status === null && response === null) return <Skeleton />;
  const sum = summarise(response, status);
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
      {status === null || status.status === 'PENDING' ? (
        <PainterQr batchId={batchId} token={sum.token} waNumber={waNumber} onChanged={refresh} />
      ) : (
        <PainterOutcome status={status.status} />
      )}
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

const OUTCOME: Record<string, readonly [ResultVariant, Key]> = {
  CONFIRMED: ['valid', 'painter.confirmed'],
  LATE: ['valid', 'painter.late'],
  DISPUTED: ['invalid', 'painter.disputed'],
  SKIPPED: ['warning', 'painter.skipped'],
  EXPIRED: ['warning', 'painter.expired'],
  NONE: ['warning', 'painter.none'],
};

function PainterOutcome({ status }: { readonly status: string }): ReactNode {
  const { t } = useI18n();
  const [variant, key] = OUTCOME[status] ?? (['warning', 'painter.none'] as const);
  return <ResultCard variant={variant} title={t(key)} />;
}

/** 2.2.1 timing adjustable: warning at 8 min with "Keep showing"; collapses at 10 min (token stays valid 24 h). */
function useShowWindow(): { elapsed: number; reset: () => void } {
  const [shownAt, setShownAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => {
      setNow(Date.now());
    }, 15_000);
    return () => {
      window.clearInterval(id);
    };
  }, []);
  return {
    elapsed: now - shownAt,
    reset: () => {
      setShownAt(Date.now());
      setNow(Date.now());
    },
  };
}

function PainterQr({
  batchId,
  token,
  waNumber,
  onChanged,
}: {
  readonly batchId: number;
  readonly token: string | null;
  readonly waNumber: string | null;
  readonly onChanged: () => void;
}): ReactNode {
  const i = useI18n();
  const { api } = useServices();
  const { elapsed, reset } = useShowWindow();
  if (token === null || waNumber === null) return <p role="status">{i.t('painter.waiting')}</p>;
  const text = painterConfirmText(token);
  const skip = (reason: 'NO_WHATSAPP' | 'NO_PHONE'): void => {
    void api
      .rpc('skip_painter_confirmation', { p_batch_id: batchId, p_reason: reason }, v.unknown())
      .then(onChanged);
  };
  return (
    <section
      className="flex flex-col items-center gap-3 rounded-card border-2 border-border p-4"
      aria-labelledby="painter-h"
    >
      <h2 id="painter-h" className="text-center text-xl font-bold">
        {i.t('painter.scan')}
      </h2>
      {elapsed < HIDE_MS ? (
        <QrSvg value={painterConfirmLink(waNumber, token)} label={i.t('painter.qrAlt', { text })} />
      ) : (
        <Button variant="secondary" onClick={reset}>
          {i.t('history.showQr')}
        </Button>
      )}
      <p className="text-center">{i.t('painter.orType', { number: `+${waNumber}` })}</p>
      <p className="font-mono text-2xl font-bold tracking-widest">{text}</p>
      <p role="status" className="text-warning-ink">
        {i.t('painter.waiting')}
      </p>
      {elapsed >= WARN_MS && elapsed < HIDE_MS ? (
        <div role="alert" className="flex w-full flex-col gap-2">
          <p>{i.t('painter.timeWarning')}</p>
          <Button variant="secondary" onClick={reset}>
            {i.t('painter.keepShowing')}
          </Button>
        </div>
      ) : null}
      <div className="grid w-full grid-cols-2 gap-2">
        <Button
          variant="ghost"
          onClick={() => {
            skip('NO_WHATSAPP');
          }}
        >
          {i.t('painter.no_whatsapp')}
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            skip('NO_PHONE');
          }}
        >
          {i.t('painter.no_phone')}
        </Button>
      </div>
    </section>
  );
}
