import { type ReactNode, useEffect } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router';

import { useI18n } from '../lib/i18n/index.ts';
import { useNetwork } from '../lib/network/status.ts';
import { useServices } from '../lib/services.ts';
import { Banner, Button, HelpLink, Icon, LanguageSwitch, Logo } from '../ui/index.ts';

import { UpdateBanner } from './UpdateBanner.tsx';

/** Log out, in the header of every screen while someone is signed in (dealer, distributor, staff). */
function LogoutButton(): ReactNode {
  const { t } = useI18n();
  const { session, signOut } = useServices();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  // The coupon screen keeps one button only (Validate), so a stray tap cannot log the dealer out.
  if (session.userId() === null || /^\/(c|100Coupons)\//i.test(pathname)) return null;
  return (
    <Button
      variant="ghost"
      className="w-auto! px-0!"
      onClick={() => signOut().then(() => navigate('/login'))}
    >
      {t('nav.logout')}
    </Button>
  );
}

const NO_BACK = new Set(['/', '/login', '/d', '/m']);

/** Back on every page except the entry pages. With no earlier page in the app it goes home. */
function BackButton(): ReactNode {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { pathname, key } = useLocation();
  const path = pathname.length > 1 ? pathname.replace(/\/$/, '') : pathname;
  if (NO_BACK.has(path)) return null;
  const home = path.startsWith('/d/') ? '/d' : path.startsWith('/m/') ? '/m' : '/';
  return (
    <a
      href={home}
      className="inline-flex min-h-12 items-center font-semibold underline underline-offset-4"
      onClick={(e) => {
        e.preventDefault();
        if (key === 'default') void navigate(home);
        else void navigate(-1);
      }}
    >
      <Icon name="back" className="mr-1 h-5 w-5" />
      {t('nav.back')}
    </a>
  );
}

/** Header (language switch + help in the same place on every screen, 3.2.6), banners, outlet. */
export function Shell({ helpline }: { readonly helpline: string | null }): ReactNode {
  const { t } = useI18n();
  const net = useNetwork();
  const location = useLocation();
  const backoffice = location.pathname.startsWith('/d') || location.pathname.startsWith('/m');
  // A new screen starts at the top, as it would on a fresh page.
  useEffect(() => {
    document.documentElement.scrollTop = 0;
  }, [location.pathname]);
  return (
    <div
      className={`${backoffice ? 'backoffice mx-auto max-w-6xl' : 'dealer mx-auto max-w-md'} min-h-dvh px-4`}
    >
      {backoffice ? (
        <a href="#content" className="sr-only focus:not-sr-only">
          {t('nav.skip')}
        </a>
      ) : null}
      <header className="border-b border-border/30 pb-1">
        <div className="flex flex-wrap items-center justify-between gap-2 py-2">
          <Link to="/" className="flex min-h-12 flex-wrap items-center gap-x-2 text-xl font-bold">
            <Logo className="h-8 w-auto" />
            <span className="max-sm:sr-only">{t('app.name')}</span>
          </Link>
          <span className="flex flex-wrap items-center gap-3">
            <LanguageSwitch />
            <HelpLink phone={helpline} />
          </span>
        </div>
        <div className="flex items-center justify-between gap-3 empty:hidden">
          <BackButton />
          <LogoutButton />
        </div>
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
