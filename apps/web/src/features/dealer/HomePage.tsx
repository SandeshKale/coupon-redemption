import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';

import { DealerHome } from '../../lib/api/schemas.ts';
import { useI18n } from '../../lib/i18n/index.ts';
import { useServices } from '../../lib/services.ts';
import { Button, ErrorState, Icon, Skeleton } from '../../ui/index.ts';

const CACHE_KEY = '24m.home';
const TILE =
  'flex min-h-24 flex-col items-center justify-center gap-2 rounded-card border-2 border-border bg-surface p-3 text-center text-lg font-semibold active:scale-[0.98] transition-transform';
const ROW =
  'flex min-h-14 items-center gap-3 rounded-card border border-border px-4 font-semibold active:bg-surface-2';

function readCache(): DealerHome | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw === null ? null : (JSON.parse(raw) as DealerHome);
  } catch {
    return null;
  }
}

/** Counts from dealer_home, cached for offline use with a "last updated" time. */
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

/** Home: Scan / Type code + validated today and this month. */
export function HomePage(): ReactNode {
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
          className="flex min-h-28 flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded-card bg-success p-4 text-center text-2xl font-bold text-white shadow-md transition-transform active:scale-[0.98]"
        >
          <Icon name="scan" className="h-9 w-9" />
          {i.t('home.scan')}
        </Link>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-3">
          <Link to="/batch" className={TILE}>
            <Icon name="layers" className="h-7 w-7" />
            {i.t('home.batch')}
          </Link>
          <Link to="/type" className={TILE}>
            <Icon name="keyboard" className="h-7 w-7" />
            {i.t('home.type')}
          </Link>
        </div>
      </nav>
      {home === null ? (
        failed ? (
          <ErrorState onRetry={reload} />
        ) : (
          <Skeleton lines={2} />
        )
      ) : (
        <section className="grid grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-3">
          <Totals label={i.t('home.today')} count={home.today_count} />
          <Totals label={i.t('home.month')} count={home.month_count} />
          {stale ? (
            <p className="col-span-full text-sm text-muted">
              {i.t('common.lastUpdated', { time: i.dateTime(home.as_of) })}
            </p>
          ) : null}
        </section>
      )}
      <DealerNav />
    </div>
  );
}

function DealerNav(): ReactNode {
  const i = useI18n();
  const { signOut } = useServices();
  const navigate = useNavigate();
  return (
    <nav aria-label={i.t('nav.history')} className="flex flex-col gap-2">
      <Link to="/history" className={ROW}>
        <Icon name="history" />
        <span className="flex-1">{i.t('nav.history')}</span>
        <Icon name="chevron" className="h-5 w-5 text-muted" />
      </Link>
      <Link to="/pin" className={ROW}>
        <Icon name="lock" />
        <span className="flex-1">{i.t('nav.pin')}</span>
        <Icon name="chevron" className="h-5 w-5 text-muted" />
      </Link>
      <Button variant="ghost" onClick={() => signOut().then(() => navigate('/login'))}>
        {i.t('nav.logout')}
      </Button>
    </nav>
  );
}

function Totals({ label, count }: { readonly label: string; readonly count: number }): ReactNode {
  const { t } = useI18n();
  return (
    <div className="min-w-0 rounded-card bg-surface-2 p-4 break-words">
      <h2 className="text-muted">{label}</h2>
      <p className="text-2xl font-bold tabular-nums">{t('home.validated', { count })}</p>
    </div>
  );
}
