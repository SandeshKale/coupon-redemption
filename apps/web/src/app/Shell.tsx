import { type ReactNode, useEffect, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router';

import { hasPending, resolvePending } from '../lib/api/redeem.ts';
import { useI18n } from '../lib/i18n/index.ts';
import { useNetwork } from '../lib/network/status.ts';
import { useServices } from '../lib/services.ts';
import { Banner, HelpLink, LanguageSwitch, ResultCard } from '../ui/index.ts';

import { UpdateBanner } from './UpdateBanner.tsx';

/** Header (language switch + help in the same place on every screen, 3.2.6), banners, outlet. */
export function Shell({ helpline }: { readonly helpline: string | null }): ReactNode {
  const { t } = useI18n();
  const net = useNetwork();
  const location = useLocation();
  const backoffice = location.pathname.startsWith('/d') || location.pathname.startsWith('/m');
  return (
    <div
      className={`${backoffice ? 'backoffice mx-auto max-w-6xl' : 'dealer mx-auto max-w-md'} min-h-dvh px-4`}
    >
      {backoffice ? (
        <a href="#content" className="sr-only focus:not-sr-only">
          {t('nav.skip')}
        </a>
      ) : null}
      <header className="flex items-center justify-between gap-2 py-3">
        <Link to="/" className="text-xl font-bold">
          {t('app.name')}
        </Link>
        <span className="flex items-center gap-3">
          <LanguageSwitch />
          <HelpLink phone={helpline} />
        </span>
      </header>
      {net === 'offline' ? <Banner tone="warning">{t('state.offline')}</Banner> : null}
      <UpdateBanner />
      <main id="content" className="py-4">
        <PendingRedeemGate>
          <Outlet />
        </PendingRedeemGate>
      </main>
      <footer className="py-6 text-center text-sm text-muted">
        <Link to="/privacy" className="underline">
          {t('public.privacy')}
        </Link>
      </footer>
    </div>
  );
}

/** EC-044: if the app was closed during "Checking…", resolve that first, before anything else. */
function PendingRedeemGate({ children }: { readonly children: ReactNode }): ReactNode {
  const { redeemDeps } = useServices();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [state, setState] = useState<'checking' | 'none' | 'not_redeemed'>(() =>
    hasPending(redeemDeps.storage) ? 'checking' : 'none',
  );
  useEffect(() => {
    if (state !== 'checking') return;
    void resolvePending(redeemDeps).then((out) => {
      if (out.kind === 'done' && out.response.batch_id !== undefined) {
        setState('none');
        void navigate(`/receipt/${out.response.batch_id}`, { state: out.response, replace: true });
      } else setState(out.kind === 'not_redeemed' ? 'not_redeemed' : 'none');
    });
  }, [navigate, redeemDeps, state]);
  if (state === 'checking')
    return <ResultCard variant="checking" title={t('state.checkingResult')} />;
  return (
    <>
      {state === 'not_redeemed' ? (
        <ResultCard variant="warning" title={t('state.notRedeemed')} />
      ) : null}
      {children}
    </>
  );
}
