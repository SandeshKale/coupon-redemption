import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { NavLink, Route, Routes } from 'react-router';

import { outcomeUnknown } from '../../lib/api/client.ts';
import type { Profile } from '../../lib/api/schemas.ts';
import { type Key, useI18n } from '../../lib/i18n/index.ts';

import { QueryError } from './data.ts';
import {
  ClaimDetailPage,
  ClaimTo24mPage,
  DealersPage,
  QueuePage,
  SlipRedirect,
} from './distributor.tsx';
import {
  LookupPage,
  LotsPage,
  M24ClaimDetailPage,
  M24ClaimsPage,
  MastersPage,
  ReportsPage,
  ReviewPage,
  UsersPage,
} from './m24.tsx';

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
        ['/d', 'nav.queue'],
        ['/d/claims', 'nav.claimTo24m'],
        ['/d/dealers', 'nav.dealers'],
      ]
    : [
        ['/m', 'nav.review'],
        ['/m/claims', 'nav.m24claims'],
        ['/m/lookup', 'nav.lookup'],
        ['/m/reports', 'nav.reports'],
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
          <>
            <Route index element={<QueuePage />} />
            <Route path="claim/:id" element={<ClaimDetailPage />} />
            <Route path="slip/:token" element={<SlipRedirect />} />
            <Route path="claims" element={<ClaimTo24mPage />} />
            <Route
              path="dealers"
              element={<DealersPage distributorId={profile.distributor_id} />}
            />
          </>
        ) : (
          <>
            <Route index element={<ReviewPage role={profile.role} />} />
            <Route path="claims" element={<M24ClaimsPage />} />
            <Route path="claim/:id" element={<M24ClaimDetailPage role={profile.role} />} />
            <Route path="slip/:token" element={<SlipRedirect />} />
            <Route path="lookup" element={<LookupPage role={profile.role} />} />
            <Route path="reports" element={<ReportsPage />} />
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
    <nav aria-label={t('app.name')} className="mb-4 flex flex-wrap gap-2">
      {links.map(([to, key]) => (
        <NavLink
          key={to}
          to={to}
          end
          className={({ isActive }) =>
            `inline-flex min-h-12 items-center rounded-btn px-3 font-semibold ${isActive ? 'bg-ink text-white' : 'bg-surface-2'}`
          }
        >
          {t(key)}
        </NavLink>
      ))}
    </nav>
  );
}

export default BackOffice;
