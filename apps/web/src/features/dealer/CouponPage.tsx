import { normaliseCode } from '@24m/shared';
import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';

import { prefetchReceipt } from '../../app/lazy.ts';
import type { ApiFailure } from '../../lib/api/client.ts';
import { CheckResponse, PublicInfo } from '../../lib/api/schemas.ts';
import { useI18n } from '../../lib/i18n/index.ts';
import { useNetwork } from '../../lib/network/status.ts';
import { useServices } from '../../lib/services.ts';
import { reportTiming } from '../../lib/telemetry.ts';
import { Banner, Button, ResultCard, Skeleton } from '../../ui/index.ts';

import { failureView, resultView } from './resultCopy.ts';
import { useRedeem } from './useRedeem.ts';

type View =
  | { kind: 'loading' }
  | { kind: 'local_invalid'; notOurs: boolean }
  | { kind: 'checked'; data: CheckResponse; code: string }
  | { kind: 'declined'; serial: string | undefined }
  | {
      kind: 'public';
      result: 'GENUINE' | 'NOT_RECOGNISED' | 'INVALID_FORMAT' | 'RATE_LIMITED';
      value: number;
    }
  | { kind: 'failed'; error: ApiFailure };

/**
 * /c/:code — what the phone camera opens (§4.1). Format and check character are validated on
 * the device first (no network for bad scans); then exactly one request.
 */
export function CouponPage(): ReactNode {
  const params = useParams();
  const { api, session, config } = useServices();
  const i = useI18n();
  const net = useNetwork();
  const navigate = useNavigate();
  const [view, setView] = useState<View>({ kind: 'loading' });
  const { state, redeem, busy } = useRedeem();
  const [declining, setDeclining] = useState(false);
  const raw = params['code'] ?? '';

  const load = useCallback(async () => {
    const local = normaliseCode(raw, config.couponHost);
    if (!local.ok) {
      setView({ kind: 'local_invalid', notOurs: local.reason === 'NOT_24M' });
      return;
    }
    setView({ kind: 'loading' });
    const started = performance.now();
    if ((await session.getToken()) === null) {
      const r = await api.rpc('public_coupon_info', { p_code: local.code }, PublicInfo);
      setView(
        r.ok
          ? { kind: 'public', result: r.data.result, value: r.data.value_paise ?? 0 }
          : { kind: 'failed', error: r.error },
      );
      return;
    }
    const r = await api.rpc('check_coupon', { p_code: local.code }, CheckResponse);
    reportTiming('scan_to_result', performance.now() - started);
    if (r.ok && r.data.result === 'VALID') prefetchReceipt();
    setView(
      r.ok
        ? { kind: 'checked', data: r.data, code: local.code }
        : { kind: 'failed', error: r.error },
    );
  }, [api, session, raw, config.couponHost]);

  useEffect(() => {
    void load();
  }, [load]);

  const confirm = async (code: string): Promise<void> => {
    const next = await redeem([code]);
    if (next.phase === 'done' && next.response.batch_id !== undefined) {
      void navigate(`/receipt/${next.response.batch_id}`, { state: next.response, replace: true });
    }
  };

  const decline = async (code: string): Promise<void> => {
    setDeclining(true);
    const r = await api.rpc('decline_payment', { p_code: code }, CheckResponse);
    setDeclining(false);
    if (!r.ok) setView({ kind: 'failed', error: r.error });
    else if (r.data.result === 'DECLINED') setView({ kind: 'declined', serial: r.data.serial });
    else setView({ kind: 'checked', data: r.data, code });
  };

  return (
    <div className="flex flex-col gap-4">
      {net === 'offline' ? <Banner tone="warning">{i.t('state.offline')}</Banner> : null}
      {net === 'slow' && view.kind === 'loading' ? (
        <Banner tone="info">{i.t('state.slow')}</Banner>
      ) : null}
      <CouponBody
        view={view}
        busy={busy || declining}
        redeemState={state}
        onConfirm={confirm}
        onDecline={decline}
        onRetry={() => void load()}
      />
    </div>
  );
}

interface BodyProps {
  readonly view: View;
  readonly busy: boolean;
  readonly redeemState: ReturnType<typeof useRedeem>['state'];
  readonly onConfirm: (code: string) => Promise<void>;
  readonly onDecline: (code: string) => Promise<void>;
  readonly onRetry: () => void;
}

function CouponBody({
  view,
  busy,
  redeemState,
  onConfirm,
  onDecline,
  onRetry,
}: BodyProps): ReactNode {
  const i = useI18n();
  switch (view.kind) {
    case 'loading':
      return <Skeleton />;
    case 'local_invalid':
      return (
        <ResultCard
          variant="invalid"
          title={view.notOurs ? i.t('result.not_24m') : i.t('result.invalid_format')}
        >
          {i.t('type.checkLast')}
        </ResultCard>
      );
    case 'public':
      return <PublicResult result={view.result} value={view.value} />;
    case 'failed':
      return <FailedResult error={view.error} onRetry={onRetry} />;
    case 'checked':
      return (
        <CheckedResult
          data={view.data}
          code={view.code}
          busy={busy}
          redeemState={redeemState}
          onConfirm={onConfirm}
          onDecline={onDecline}
        />
      );
    case 'declined':
      return <DeclinedResult serial={view.serial} />;
  }
}

function FailedResult({
  error,
  onRetry,
}: {
  readonly error: ApiFailure;
  readonly onRetry: () => void;
}): ReactNode {
  const i = useI18n();
  const f = failureView(error, i);
  return (
    <>
      <ResultCard variant={f.variant} title={f.title} />
      {error.kind === 'auth' ? (
        <LoginPrompt />
      ) : (
        <Button variant="secondary" onClick={onRetry}>
          {i.t('common.retry')}
        </Button>
      )}
    </>
  );
}

function CheckedResult({
  data,
  code,
  busy,
  redeemState,
  onConfirm,
  onDecline,
}: Omit<BodyProps, 'view' | 'onRetry'> & {
  readonly data: CheckResponse;
  readonly code: string;
}): ReactNode {
  const i = useI18n();
  const r = resultView(data.result, data, i);
  const redeemFailed = redeemState.phase === 'failed' || redeemState.phase === 'not_redeemed';
  const busyTitle = i.t(redeemState.phase === 'checking' ? 'state.checkingResult' : 'state.saving');
  return (
    <>
      <ResultCard variant={busy ? 'checking' : r.variant} title={busy ? busyTitle : r.title}>
        {data.serial === undefined ? null : <p>{i.t('result.serial', { serial: data.serial })}</p>}
        {typeof data.product === 'string' ? <p>{data.product}</p> : null}
        {r.variant === 'invalid' ? (
          <p className="mt-2 text-xl font-bold text-danger">{i.t('result.do_not_pay')}</p>
        ) : null}
      </ResultCard>
      {redeemFailed ? <ResultCard variant="warning" title={i.t('state.notRedeemed')} /> : null}
      {r.payable ? (
        <div className="sticky bottom-0 flex flex-col gap-3 bg-surface pb-4">
          <Button size="lg" loading={busy} onClick={() => void onConfirm(code)}>
            {i.t('action.confirm', { amount: i.money(data.value_paise ?? 0) })}
          </Button>
          <Button size="lg" variant="secondary" loading={busy} onClick={() => void onDecline(code)}>
            {i.t('action.decline')}
          </Button>
        </div>
      ) : (
        <Link
          to="/scan"
          className="flex min-h-14 items-center justify-center rounded-btn border-2 border-border font-semibold"
        >
          {i.t('action.scanNext')}
        </Link>
      )}
    </>
  );
}

function DeclinedResult({ serial }: { readonly serial: string | undefined }): ReactNode {
  const i = useI18n();
  return (
    <>
      <ResultCard variant="warning" title={i.t('result.declined')}>
        {serial === undefined ? null : <p>{i.t('result.serial', { serial })}</p>}
      </ResultCard>
      <Link
        to="/scan"
        className="flex min-h-14 items-center justify-center rounded-btn border-2 border-border font-semibold"
      >
        {i.t('action.scanNext')}
      </Link>
    </>
  );
}

function PublicResult({
  result,
  value,
}: {
  readonly result: string;
  readonly value: number;
}): ReactNode {
  const i = useI18n();
  const title =
    result === 'GENUINE'
      ? i.t('public.genuine', { amount: i.money(value) })
      : result === 'RATE_LIMITED'
        ? i.t('public.rateLimited')
        : i.t('public.notRecognised');
  return (
    <>
      <ResultCard
        variant={result === 'GENUINE' ? 'valid' : result === 'RATE_LIMITED' ? 'warning' : 'invalid'}
        title={title}
      />
      <LoginPrompt />
    </>
  );
}

function LoginPrompt(): ReactNode {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-2">
      <Link
        to="/login"
        className="flex min-h-14 items-center justify-center rounded-btn bg-success font-semibold text-white"
      >
        {t('public.dealerLogin')}
      </Link>
      <p className="text-sm text-muted">{t('auth.openInChrome')}</p>
    </div>
  );
}
