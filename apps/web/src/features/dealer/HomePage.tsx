import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';

import { DealerHome } from '../../lib/api/schemas.ts';
import { useI18n } from '../../lib/i18n/index.ts';
import { useServices } from '../../lib/services.ts';
import { Button, ErrorState, Money, Skeleton } from '../../ui/index.ts';

const CACHE_KEY = '24m.home';
const BIG =
  'flex min-h-14 items-center justify-center rounded-btn border-2 border-border text-lg font-semibold';
const NAV = 'flex min-h-12 items-center font-semibold underline underline-offset-4';

function readCache(): DealerHome | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw === null ? null : (JSON.parse(raw) as DealerHome);
  } catch {
    return null;
  }
}

/** Totals from dealer_home, cached for offline use with a "last updated" time. */
function useHome(): {
  home: DealerHome | null;
  stale: boolean;
  failed: boolean;
  reload: () => void;
} {
  const { api } = useServices();
  const [home, setHome] = useState<DealerHome | null>(readCache);
  const [failed, setFailed] = useState(false);
  const load = useCallback(async () => {
    const r = await api.rpc('dealer_home', {}, DealerHome);
    setFailed(!r.ok);
    if (!r.ok) return;
    setHome(r.data);
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(r.data));
    } catch {
      // cache is best effort
    }
  }, [api]);
  useEffect(() => {
    void load();
  }, [load]);
  return { home, stale: failed, failed, reload: () => void load() };
}

/** Home: Scan / Scan many / Type code + today and month totals. */
export function HomePage({ userRole }: { readonly userRole: string }): ReactNode {
  const i = useI18n();
  const { home, stale, failed, reload } = useHome();
  return (
    <div className="flex flex-col gap-4">
      {home === null ? null : (
        <p className="text-lg">{i.t('home.hello', { name: home.user.name })}</p>
      )}
      <nav className="grid gap-3" aria-label={i.t('nav.home')}>
        <Link
          to="/scan"
          className="flex min-h-16 items-center justify-center rounded-btn bg-success text-xl font-bold text-white"
        >
          {i.t('home.scan')}
        </Link>
        <Link to="/scan-many" className={BIG}>
          {i.t('home.scanMany')}
        </Link>
        <Link to="/type" className={BIG}>
          {i.t('home.type')}
        </Link>
      </nav>
      {home === null ? (
        failed ? (
          <ErrorState onRetry={reload} />
        ) : (
          <Skeleton lines={2} />
        )
      ) : (
        <section className="grid grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-3">
          <Totals label={i.t('home.today')} count={home.today_count} paise={home.today_paise} />
          <Totals label={i.t('home.month')} count={home.month_count} paise={home.month_paise} />
          {home.pending_painter > 0 ? (
            <Link
              to="/history"
              className="col-span-full font-semibold text-warning-ink underline underline-offset-4"
            >
              {i.t('home.pendingPainter', { count: home.pending_painter })}
            </Link>
          ) : null}
          {stale ? (
            <p className="col-span-full text-sm text-muted">
              {i.t('common.lastUpdated', { time: i.dateTime(home.as_of) })}
            </p>
          ) : null}
        </section>
      )}
      <DealerNav owner={userRole === 'DEALER_OWNER'} />
    </div>
  );
}

function DealerNav({ owner }: { readonly owner: boolean }): ReactNode {
  const i = useI18n();
  const { signOut } = useServices();
  const navigate = useNavigate();
  return (
    <nav aria-label={i.t('nav.history')} className="flex flex-col gap-2">
      <Link to="/history" className={NAV}>
        {i.t('nav.history')}
      </Link>
      {owner ? (
        <>
          <Link to="/claims" className={NAV}>
            {i.t('nav.claims')}
          </Link>
          <Link to="/staff" className={NAV}>
            {i.t('nav.staff')}
          </Link>
        </>
      ) : null}
      <Button
        variant="ghost"
        onClick={() => {
          void signOut().then(() => navigate('/login'));
        }}
      >
        {i.t('nav.logout')}
      </Button>
    </nav>
  );
}

function Totals({
  label,
  count,
  paise,
}: {
  readonly label: string;
  readonly count: number;
  readonly paise: number;
}): ReactNode {
  const { t } = useI18n();
  return (
    <div className="min-w-0 rounded-card bg-surface-2 p-4 break-words">
      <h2 className="text-muted">{label}</h2>
      <p className="text-2xl font-bold">
        <Money paise={paise} />
      </p>
      <p>{t('home.coupons', { count })}</p>
    </div>
  );
}
