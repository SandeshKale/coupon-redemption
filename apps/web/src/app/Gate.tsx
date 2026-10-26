import { lazy, type ReactNode, Suspense, useEffect, useState } from 'react';
import { Navigate } from 'react-router';

import type { Profile } from '../lib/api/schemas.ts';
import { useI18n } from '../lib/i18n/index.ts';
import { useServices } from '../lib/services.ts';
import { ResultCard, Skeleton } from '../ui/index.ts';

const BackOffice = lazy(() => import('../features/backoffice/BackOffice.tsx'));

type Loaded =
  { kind: 'loading' } | { kind: 'anon' } | { kind: 'user'; profile: Profile } | { kind: 'mfa' };

export function useProfile(): Loaded {
  const { profile, session } = useServices();
  const [state, setState] = useState<Loaded>({ kind: 'loading' });
  useEffect(() => {
    void session.getToken().then(async (accessToken) => {
      if (accessToken === null) {
        setState({ kind: 'anon' });
        return;
      }
      const p = await profile();
      // 24M users without aal2 see no rows (RLS) — they must finish two-step verification.
      setState(
        p === null
          ? session.aal() === 'aal1'
            ? { kind: 'mfa' }
            : { kind: 'anon' }
          : { kind: 'user', profile: p },
      );
    });
  }, [profile, session]);
  return state;
}

/** Route guard: renders children only for the allowed roles, otherwise routes to the right home. */
export function RoleGate({
  roles,
  children,
}: {
  readonly roles: readonly string[];
  readonly children: (p: Profile) => ReactNode;
}): ReactNode {
  const state = useProfile();
  const { t } = useI18n();
  if (state.kind === 'loading') return <Skeleton />;
  if (state.kind === 'anon') return <Navigate to="/login" replace />;
  if (state.kind === 'mfa') return <Navigate to="/login" replace state={{ mfa: true }} />;
  if (!roles.includes(state.profile.role)) {
    if (state.profile.role === 'DISTRIBUTOR') return <Navigate to="/d" replace />;
    if (state.profile.role.startsWith('M24_')) return <Navigate to="/m" replace />;
    return <ResultCard variant="invalid" title={t('common.forbidden')} />;
  }
  return children(state.profile);
}

export function BackOfficeRoute({ roles }: { readonly roles: readonly string[] }): ReactNode {
  return (
    <RoleGate roles={roles}>
      {(p) => (
        <Suspense fallback={<Skeleton />}>
          <BackOffice profile={p} />
        </Suspense>
      )}
    </RoleGate>
  );
}
