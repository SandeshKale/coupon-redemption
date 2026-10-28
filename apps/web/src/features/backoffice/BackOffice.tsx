import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { NavLink, Route, Routes } from 'react-router';

import { outcomeUnknown } from '../../lib/api/client.ts';
import type { Profile } from '../../lib/api/schemas.ts';
import { type Key, useI18n } from '../../lib/i18n/index.ts';

import { QueryError } from './data.ts';
import { DealersPage } from './distributor.tsx';
import { DashboardPage, LookupPage, LotsPage, MastersPage, ReviewPage, UsersPage } from './m24.tsx';
import { RedeemPage } from './redeem.tsx';

/** Distributor and 24M back-office: one lazy chunk (TanStack Query lives only here). */
function BackOffice({ profile }: { readonly profile: Profile }): ReactNode {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Retry only when the outcome is unknown (network/5xx); never on 4xx business errors.
            retry: (count: number, e: unknown) =>
              count < 2 && e instanceof QueryError && outcomeUnknown(e.failure),
            staleTime: 15_000,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );
  const isDist = profile.role === 'DISTRIBUTOR';
  const links: [string, Key][] = isDist
    ? [
        ['/d', 'nav.dealers'],
        ['/scan', 'home.scan'],
        ['/batch', 'home.batch'],
        ['/type', 'home.type'],
        ['/history', 'nav.history'],
        ['/pin', 'nav.pin'],
      ]
    : [
        ['/m', 'nav.dashboard'],
        ['/m/review', 'nav.review'],
        ['/m/lookup', 'nav.lookup'],
        ...(profile.role === 'M24_ADMIN' || profile.role === 'M24_FINANCE'
          ? ([['/m/redeem', 'nav.redeem']] as [string, Key][])
          : []),
        ...(profile.role === 'M24_ADMIN'
          ? ([
              ['/m/lots', 'nav.lots'],
              ['/m/masters', 'nav.masters'],
              ['/m/users', 'nav.users'],
            ] as [string, Key][])
          : []),
      ];
  return (
    <QueryClientProvider client={client}>
      <BackOfficeNav links={links} />
      <Routes>
        {isDist ? (
          <Route index element={<DealersPage distributorId={profile.distributor_id} />} />
        ) : (
          <>
            <Route index element={<DashboardPage />} />
            <Route path="review" element={<ReviewPage role={profile.role} />} />
            <Route path="lookup" element={<LookupPage role={profile.role} />} />
            <Route path="redeem" element={<RedeemPage />} />
            <Route path="lots" element={<LotsPage />} />
            <Route path="masters" element={<MastersPage />} />
            <Route path="users" element={<UsersPage />} />
          </>
        )}
      </Routes>
    </QueryClientProvider>
  );
}

function BackOfficeNav({ links }: { readonly links: readonly [string, Key][] }): ReactNode {
  const { t } = useI18n();
  return (
    <nav aria-label={t('app.name')} className="mb-4 flex gap-2 overflow-x-auto pb-1 sm:flex-wrap">
      {links.map(([to, key]) => (
        <NavLink
          key={to}
          to={to}
          end
          className={({ isActive }) =>
            `inline-flex min-h-12 shrink-0 items-center rounded-btn px-3 font-semibold whitespace-nowrap ${isActive ? 'bg-ink text-white' : 'bg-surface-2'}`
          }
        >
          {t(key)}
        </NavLink>
      ))}
    </nav>
  );
}

export default BackOffice;
