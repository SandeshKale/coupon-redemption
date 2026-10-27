import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '../lib/i18n/index.ts';
import { ServicesContext } from '../lib/services.ts';
import { HOME, PROFILE, STATS } from '../test/fixtures.ts';
import { renderAt, signIn, testServices } from '../test/render.tsx';
import { API, rest, rpc, server } from '../test/server.ts';

import { RoleGate, useProfile } from './Gate.tsx';
import { PrivacyPage } from './PrivacyPage.tsx';
import { notifyUpdate, UpdateBanner } from './UpdateBanner.tsx';
import { prefetchDealerRoutes } from './lazy.ts';
import { AppRoutes } from './routes.tsx';

function app(route: string) {
  return render(
    <ServicesContext.Provider value={testServices()}>
      <I18nProvider lang="en">
        <MemoryRouter initialEntries={[route]}>
          <AppRoutes helpline="+91 20 0000 0000" />
        </MemoryRouter>
      </I18nProvider>
    </ServicesContext.Provider>,
  );
}

describe('routing and gates', () => {
  it('logged-out home goes to login; help and language are on every screen', async () => {
    app('/');
    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Call 24M: +91 20 0000 0000' })).toBeInTheDocument();
    expect(screen.getByLabelText('Language')).toBeInTheDocument();
  });

  it('a dealer cannot open the back office', async () => {
    signIn();
    rest({ app_user: PROFILE('DEALER_STAFF') });
    rpc({ dealer_home: HOME });
    app('/m');
    expect(await screen.findByText('You do not have permission for this.')).toBeInTheDocument();
  });

  it('the old claim and staff pages are gone: they land on home', async () => {
    signIn();
    rest({ app_user: PROFILE('DEALER_OWNER') });
    rpc({ dealer_home: HOME });
    app('/claims');
    expect(await screen.findByText('Namaste, Owner A')).toBeInTheDocument();
  });

  it('distributors and 24M are routed to their back-office', async () => {
    signIn();
    rest({ app_user: PROFILE('DISTRIBUTOR') });
    rpc({ list_dealers: [] });
    app('/');
    expect((await screen.findAllByRole('heading', { name: 'Dealers' })).length).toBeGreaterThan(0);
  });

  it('24M without MFA is sent to login', async () => {
    signIn('u', 'aal1');
    rest({ app_user: [] });
    app('/m');
    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
  });

  it('24M admin lands on the dashboard', async () => {
    signIn('u', 'aal2');
    rest({ app_user: PROFILE('M24_ADMIN') });
    rpc({ coupon_stats: STATS });
    app('/');
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Skip to content' })).toBeInTheDocument();
  });

  it('privacy page and the wildcard route', async () => {
    app('/privacy');
    expect(await screen.findByRole('heading', { name: 'Privacy' })).toBeInTheDocument();
    app('/nope');
    expect((await screen.findAllByRole('heading', { name: 'Log in' })).length).toBeGreaterThan(0);
  });

  it('every lazy dealer route renders', async () => {
    signIn();
    rest({ app_user: PROFILE('DEALER_OWNER') });
    rpc({ dealer_home: HOME, my_validations: [] });
    for (const [route, heading] of [
      ['/history', 'My validations'],
      ['/pin', 'Change PIN'],
      ['/scan', 'Scan coupon'],
      ['/type', 'Type the code'],
    ] as const) {
      const r = app(route);
      expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument();
      r.unmount();
    }
  });

  it('distributors can change their PIN too', async () => {
    signIn();
    rest({ app_user: PROFILE('DISTRIBUTOR') });
    app('/pin');
    expect(await screen.findByRole('heading', { name: 'Change PIN' })).toBeInTheDocument();
  });

  it('useProfile and RoleGate states', async () => {
    function Probe() {
      return <p>{useProfile().kind}</p>;
    }
    renderAt(<Probe />);
    expect(await screen.findByText('anon')).toBeInTheDocument();
    signIn();
    server.use(http.get(`${API}/rest/v1/app_user`, () => HttpResponse.json([])));
    renderAt(<RoleGate roles={['DEALER_OWNER']}>{() => <p>{'inside'}</p>}</RoleGate>);
    expect(await screen.findByText('navigated')).toBeInTheDocument();
  });
});

describe('Shell', () => {
  it('offline banner', async () => {
    const spy = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    app('/privacy');
    expect(
      await screen.findAllByText('No internet. Try again when you are online.'),
    ).not.toHaveLength(0);
    spy.mockRestore();
  });
});

describe('UpdateBanner (EC-055)', () => {
  it('appears when a new version waits and applies on request', async () => {
    const apply = vi.fn(() => Promise.resolve());
    render(
      <I18nProvider lang="en">
        <UpdateBanner />
      </I18nProvider>,
    );
    expect(screen.queryByText('A new version is available.')).not.toBeInTheDocument();
    act(() => {
      notifyUpdate(apply);
    });
    await userEvent.click(screen.getByRole('button', { name: 'Update now' }));
    expect(apply).toHaveBeenCalled();
  });
});

describe('misc', () => {
  it('privacy copy and prefetchers', () => {
    render(
      <I18nProvider lang="en">
        <PrivacyPage />
      </I18nProvider>,
    );
    expect(screen.getByText(/do not collect painters’ phone numbers/)).toBeInTheDocument();
    const setTimeout = vi.fn((cb: () => void) => (cb(), 1));
    prefetchDealerRoutes({ navigator: {}, setTimeout } as unknown as Window);
    expect(setTimeout).toHaveBeenCalled();
    const noop = vi.fn();
    prefetchDealerRoutes({
      navigator: { connection: { saveData: true } },
      setTimeout: noop,
    } as unknown as Window);
    expect(noop).not.toHaveBeenCalled();
  });
});
