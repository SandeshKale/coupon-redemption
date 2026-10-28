import { normaliseCode } from '@24m/shared';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';

import type { ApiFailure } from '../../lib/api/client.ts';
import { CheckResponse, PublicInfo } from '../../lib/api/schemas.ts';
import { useI18n } from '../../lib/i18n/index.ts';
import { useNetwork } from '../../lib/network/status.ts';
import { useServices } from '../../lib/services.ts';
import { reportTiming } from '../../lib/telemetry.ts';
import { Banner, Button, Logo, ResultCard, Skeleton } from '../../ui/index.ts';

import { failureView, resultView } from './resultCopy.ts';

export const HOME_URL = 'https://24m.in/primer';

type View =
  | { kind: 'loading' }
  | { kind: 'local_invalid'; notOurs: boolean }
  | { kind: 'public'; info: PublicInfo; code: string; dealersOnly: boolean }
  | { kind: 'checked'; data: CheckResponse; code: string }
  | { kind: 'validated'; data: CheckResponse }
  | { kind: 'failed'; error: ApiFailure };

const LINK =
  'flex min-h-14 items-center justify-center rounded-btn border-2 border-border font-semibold active:bg-surface-2';
const LINK_PRIMARY =
  'flex min-h-14 items-center justify-center rounded-btn bg-success text-lg font-semibold text-white active:brightness-90';

/**
 * /c/:code: what the phone camera opens. Anyone sees whether the coupon is genuine and its
 * status. A signed-in dealer also gets one action: Validate. Format and check character are
 * checked on the device first (no network for bad scans).
 */
export function CouponPage(): ReactNode {
  const params = useParams();
  const { api, session, config } = useServices();
  const i = useI18n();
  const net = useNetwork();
  const [view, setView] = useState<View>({ kind: 'loading' });
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const raw = params['code'] ?? '';

  const load = useCallback(async () => {
    const local = normaliseCode(raw, config.couponHost);
    if (!local.ok) {
      setView({ kind: 'local_invalid', notOurs: local.reason === 'NOT_24M' });
      return;
    }
    setView({ kind: 'loading' });
    const started = performance.now();
    const publicView = async (dealersOnly: boolean): Promise<void> => {
      const r = await api.rpc('public_coupon_info', { p_code: local.code }, PublicInfo);
      setView(
        r.ok
          ? { kind: 'public', info: r.data, code: local.code, dealersOnly }
          : { kind: 'failed', error: r.error },
      );
    };
    if ((await session.getToken()) === null) {
      await publicView(false);
      return;
    }
    const r = await api.rpc('check_coupon', { p_code: local.code }, CheckResponse);
    reportTiming('scan_to_result', performance.now() - started);
    if (!r.ok && r.error.kind === 'auth') await publicView(false);
    else if (!r.ok && r.error.kind === 'forbidden') await publicView(true);
    else
      setView(
        r.ok
          ? { kind: 'checked', data: r.data, code: local.code }
          : { kind: 'failed', error: r.error },
      );
  }, [api, session, raw, config.couponHost]);

  useEffect(() => {
    void load();
  }, [load]);

  const validate = async (code: string): Promise<void> => {
    // One validation per tap, however fast the taps come.
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    const r = await api.rpc('validate_coupon', { p_code: code }, CheckResponse);
    inFlight.current = false;
    setBusy(false);
    if (!r.ok) setView({ kind: 'failed', error: r.error });
    else if (r.data.result === 'VALIDATED') {
      if ('vibrate' in navigator) navigator.vibrate([80, 40, 80]);
      setView({ kind: 'validated', data: r.data });
    } else setView({ kind: 'checked', data: r.data, code });
  };

  return (
    <div className="flex flex-col gap-4">
      {net === 'offline' ? <Banner tone="warning">{i.t('state.offline')}</Banner> : null}
      {net === 'slow' && view.kind === 'loading' ? (
        <Banner tone="info">{i.t('state.slow')}</Banner>
      ) : null}
      <CouponBody view={view} busy={busy} onValidate={validate} onRetry={() => load()} />
    </div>
  );
}

function CouponBody({
  view,
  busy,
  onValidate,
  onRetry,
}: {
  readonly view: View;
  readonly busy: boolean;
  readonly onValidate: (code: string) => Promise<void>;
  readonly onRetry: () => unknown;
}): ReactNode {
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
      return <PublicResult view={view} />;
    case 'failed':
      return <FailedResult error={view.error} onRetry={onRetry} />;
    case 'validated':
      return <ValidatedResult data={view.data} />;
    case 'checked':
      return (
        <CheckedResult data={view.data} code={view.code} busy={busy} onValidate={onValidate} />
      );
  }
}

function FailedResult({
  error,
  onRetry,
}: {
  readonly error: ApiFailure;
  readonly onRetry: () => unknown;
}): ReactNode {
  const i = useI18n();
  const f = failureView(error, i);
  return (
    <>
      <ResultCard variant={f.variant} title={f.title} />
      {error.kind === 'auth' ? (
        <LoginLink />
      ) : (
        <Button variant="secondary" onClick={onRetry}>
          {i.t('common.retry')}
        </Button>
      )}
      <HomeLink />
    </>
  );
}

function ValidatedResult({ data }: { readonly data: CheckResponse }): ReactNode {
  const i = useI18n();
  return (
    <>
      <ResultCard variant="valid" title={i.t('result.validated')}>
        {data.serial === undefined ? null : <p>{i.t('result.serial', { serial: data.serial })}</p>}
      </ResultCard>
      <Link to="/scan" className={LINK_PRIMARY}>
        {i.t('action.scanNext')}
      </Link>
      <HomeLink />
    </>
  );
}

function CheckedResult({
  data,
  code,
  busy,
  onValidate,
}: {
  readonly data: CheckResponse;
  readonly code: string;
  readonly busy: boolean;
  readonly onValidate: (code: string) => Promise<void>;
}): ReactNode {
  const i = useI18n();
  const r = resultView(data.result, data, i);
  return (
    <>
      <ResultCard variant={r.variant} title={r.title}>
        {data.serial === undefined ? null : <p>{i.t('result.serial', { serial: data.serial })}</p>}
        {typeof data.product === 'string' ? <p>{data.product}</p> : null}
        {r.canValidate ? <p className="font-semibold">{i.t('public.state.ACTIVE')}</p> : null}
      </ResultCard>
      {r.canValidate ? (
        <div className="sticky bottom-0 bg-surface pt-2 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <Button size="lg" loading={busy} onClick={() => onValidate(code)}>
            {i.t('action.validate')}
          </Button>
        </div>
      ) : (
        <Link to="/scan" className={LINK}>
          {i.t('action.scanNext')}
        </Link>
      )}
      <HomeLink />
    </>
  );
}

function PublicResult({ view }: { readonly view: Extract<View, { kind: 'public' }> }): ReactNode {
  const i = useI18n();
  const { info, code, dealersOnly } = view;
  const genuine = info.result === 'GENUINE';
  const state = info.state ?? 'ACTIVE';
  const title = genuine
    ? i.t('public.genuine', { amount: i.money(info.value_paise ?? 0) })
    : info.result === 'RATE_LIMITED'
      ? i.t('public.rateLimited')
      : i.t('public.notRecognised');
  const variant = !genuine
    ? info.result === 'RATE_LIMITED'
      ? 'warning'
      : 'invalid'
    : state === 'ACTIVE'
      ? 'valid'
      : state === 'VALIDATED'
        ? 'warning'
        : 'invalid';
  return (
    <>
      <div className="flex justify-center py-2">
        <Logo className="h-14 w-auto" />
      </div>
      <ResultCard variant={variant} title={title}>
        {genuine ? <p className="font-semibold">{i.t(`public.state.${state}`)}</p> : null}
      </ResultCard>
      {dealersOnly ? <p>{i.t('public.dealersOnly')}</p> : <LoginLink code={code} />}
      <HomeLink />
    </>
  );
}

function LoginLink({ code }: { readonly code?: string }): ReactNode {
  const { t } = useI18n();
  const next = code === undefined ? '' : `?next=${encodeURIComponent(`/c/${code}`)}`;
  return (
    <div className="flex flex-col gap-2">
      <Link
        to={`/login${next}`}
        className="flex min-h-14 items-center justify-center rounded-btn bg-success font-semibold text-white"
      >
        {t('public.login')}
      </Link>
      <p className="text-sm text-muted">{t('auth.openInChrome')}</p>
    </div>
  );
}

function HomeLink(): ReactNode {
  const { t } = useI18n();
  return (
    <a href={HOME_URL} rel="noopener" className={LINK}>
      {t('public.home')}
    </a>
  );
}
