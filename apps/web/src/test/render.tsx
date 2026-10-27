import { render, type RenderResult } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';

import { STORAGE_KEY } from '../lib/auth/session.ts';
import { readConfig } from '../lib/config.ts';
import { I18nProvider, type Lang } from '../lib/i18n/index.ts';
import { createServices, type Services, ServicesContext } from '../lib/services.ts';

import { API } from './server.ts';

/** A JWT-shaped token with the given claims (signature not checked client-side). */
export function fakeJwt(claims: Record<string, unknown>): string {
  const b64 = (o: unknown): string => btoa(JSON.stringify(o)).replace(/=+$/, '');
  return `${b64({ alg: 'HS256' })}.${b64(claims)}.sig`;
}

export function signIn(userId = 'u-1', aal = 'aal1'): void {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      access_token: fakeJwt({ sub: userId, aal }),
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: userId },
    }),
  );
}

export function testServices(overrides: Partial<Services> = {}): Services {
  const s = createServices(
    readConfig({
      VITE_SUPABASE_URL: API,
      VITE_SUPABASE_ANON_KEY: 'anon',
      VITE_COUPON_HOST: 'c.example.in',
      VITE_HELPLINE: '+91 20 0000 0000',
    }),
  );
  return { ...s, ...overrides };
}

export function renderAt(
  element: ReactNode,
  {
    path = '/',
    route = '/',
    services = testServices(),
    lang = 'en',
    state,
  }: { path?: string; route?: string; services?: Services; lang?: Lang; state?: unknown } = {},
): RenderResult & { services: Services } {
  const r = render(
    <ServicesContext.Provider value={services}>
      <I18nProvider lang={lang}>
        <MemoryRouter
          initialEntries={[
            {
              pathname: route.split('?')[0] ?? '/',
              search: route.includes('?') ? `?${route.split('?')[1] ?? ''}` : '',
              state,
            },
          ]}
        >
          <Routes>
            <Route path={path} element={element} />
            <Route path="*" element={<p>{'navigated'}</p>} />
          </Routes>
        </MemoryRouter>
      </I18nProvider>
    </ServicesContext.Provider>,
  );
  return { ...r, services };
}
