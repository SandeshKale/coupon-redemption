import type { ReactNode } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router';

import { useI18n } from '../lib/i18n/index.ts';
import { useNetwork } from '../lib/network/status.ts';
import { useServices } from '../lib/services.ts';
import { Banner, HelpLink, LanguageSwitch } from '../ui/index.ts';

import { UpdateBanner } from './UpdateBanner.tsx';

/** Log out, in the header of every screen while someone is signed in (dealer, distributor, staff). */
function LogoutButton(): ReactNode {
  const { t } = useI18n();
  const { session, signOut } = useServices();
  const navigate = useNavigate();
  if (session.userId() === null) return null;
  return (
    <button
      type="button"
      className="inline-flex min-h-12 items-center font-semibold underline underline-offset-4"
      onClick={() => {
        void signOut().then(() => navigate('/login'));
      }}
    >
      {t('nav.logout')}
    </button>
  );
}

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
      <header className="flex flex-wrap items-center justify-between gap-2 py-3">
        <Link to="/" className="text-xl font-bold">
          {t('app.name')}
        </Link>
        <span className="flex flex-wrap items-center gap-3">
          <LanguageSwitch />
          <HelpLink phone={helpline} />
          <LogoutButton />
        </span>
      </header>
      {net === 'offline' ? <Banner tone="warning">{t('state.offline')}</Banner> : null}
      <UpdateBanner />
      <main id="content" className="py-4">
        <Outlet />
      </main>
      <footer className="py-6 text-center text-sm text-muted">
        <Link to="/privacy" className="underline">
          {t('public.privacy')}
        </Link>
      </footer>
    </div>
  );
}
