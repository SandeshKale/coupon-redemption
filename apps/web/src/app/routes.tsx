import { type ReactNode, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router';

import { CouponPage } from '../features/dealer/CouponPage.tsx';
import { HomePage } from '../features/dealer/HomePage.tsx';
import { TypeCodePage } from '../features/dealer/TypeCodePage.tsx';
import { Skeleton } from '../ui/index.ts';

import { BackOfficeRoute, RoleGate } from './Gate.tsx';
import { Shell } from './Shell.tsx';
import { HistoryPage, LoginPage, PinPage, PrivacyPage, ScanPage } from './lazy.ts';

const DEALER = ['DEALER_OWNER', 'DEALER_STAFF'] as const;
const PIN_USERS = ['DEALER_OWNER', 'DEALER_STAFF', 'DISTRIBUTOR'] as const;

function L({ children }: { readonly children: ReactNode }): ReactNode {
  return <Suspense fallback={<Skeleton />}>{children}</Suspense>;
}

/** A lazy page behind a role gate. */
function Gated({
  roles,
  children,
}: {
  readonly roles: readonly string[];
  readonly children: ReactNode;
}): ReactNode {
  return <RoleGate roles={roles}>{() => <L>{children}</L>}</RoleGate>;
}

function publicRoutes(): ReactNode {
  return (
    <>
      <Route path="c/:code" element={<CouponPage />} />
      <Route path="100Coupons/:code" element={<CouponPage />} />
      <Route path="type" element={<TypeCodePage />} />
      <Route
        path="login"
        element={
          <L>
            <LoginPage />
          </L>
        }
      />
      <Route
        path="privacy"
        element={
          <L>
            <PrivacyPage />
          </L>
        }
      />
    </>
  );
}

function dealerRoutes(): ReactNode {
  return (
    <>
      <Route index element={<RoleGate roles={DEALER}>{() => <HomePage />}</RoleGate>} />
      <Route
        path="scan"
        element={
          <Gated roles={DEALER}>
            <ScanPage />
          </Gated>
        }
      />
      <Route
        path="history"
        element={
          <Gated roles={DEALER}>
            <HistoryPage />
          </Gated>
        }
      />
      <Route
        path="pin"
        element={
          <Gated roles={PIN_USERS}>
            <PinPage />
          </Gated>
        }
      />
    </>
  );
}

/**
 * Declarative routes. The coupon page (/c/:code — what the camera opens) and Home are in the
 * initial bundle; everything else is a lazy chunk.
 */
export function AppRoutes({ helpline }: { readonly helpline: string | null }): ReactNode {
  return (
    <Routes>
      <Route element={<Shell helpline={helpline} />}>
        {publicRoutes()}
        {dealerRoutes()}
        <Route path="d/*" element={<BackOfficeRoute roles={['DISTRIBUTOR']} />} />
        <Route
          path="m/*"
          element={<BackOfficeRoute roles={['M24_ADMIN', 'M24_FINANCE', 'M24_VIEWER']} />}
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
