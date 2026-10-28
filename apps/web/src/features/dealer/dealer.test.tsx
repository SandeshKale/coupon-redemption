import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../ui/Scanner.tsx', async () => ({
  Scanner: (await import('../../test/scanner-stub.tsx')).ScannerStub,
}));
vi.mock('../../lib/auth/client.ts', () => ({
  loadAuthClient: () => Promise.resolve({ signOut: () => Promise.resolve({ error: null }) }),
}));

import { CODE, HOME, VALID, VALIDATED } from '../../test/fixtures.ts';
import { renderAt, signIn } from '../../test/render.tsx';
import { scanned } from '../../test/scanner-stub.tsx';
import { API, err, rpc, server } from '../../test/server.ts';

import { CouponPage, HOME_URL } from './CouponPage.tsx';
import { HistoryPage } from './HistoryPage.tsx';
import { HomePage } from './HomePage.tsx';
import { PinPage } from './PinPage.tsx';
import { ScanPage } from './ScanPage.tsx';
import { TypeCodePage } from './TypeCodePage.tsx';

beforeEach(() => {
  scanned.length = 0;
});

const open = (code = CODE) => renderAt(<CouponPage />, { path: '/c/:code', route: `/c/${code}` });

describe('CouponPage: what anyone sees', () => {
  it('shows a genuine active coupon with a login option and the 24M home page', async () => {
    rpc({ public_coupon_info: { result: 'GENUINE', value_paise: 10000, state: 'ACTIVE' } });
    open();
    expect(await screen.findByText('Genuine 24M coupon · ₹100')).toBeInTheDocument();
    expect(screen.getByText('Status: Active')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Login to validate' })).toHaveAttribute(
      'href',
      `/login?next=${encodeURIComponent(`/c/${CODE}`)}`,
    );
    const home = screen.getByRole('link', { name: 'Go to 24M home page' });
    expect(home).toHaveAttribute('href', HOME_URL);
    expect(HOME_URL).toBe('https://www.24m.in');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it.each([
    ['VALIDATED', 'Status: Validated'],
    ['REDEEMED', 'Status: Redeemed'],
    ['EXPIRED', 'Status: Expired'],
  ])('shows the %s status', async (state, text) => {
    rpc({ public_coupon_info: { result: 'GENUINE', value_paise: 10000, state } });
    open();
    expect(await screen.findByText(text)).toBeInTheDocument();
  });

  it('a genuine coupon without a state is treated as active', async () => {
    rpc({ public_coupon_info: { result: 'GENUINE', value_paise: 10000 } });
    open();
    expect(await screen.findByText('Status: Active')).toBeInTheDocument();
  });

  it.each([
    ['NOT_RECOGNISED', 'This coupon is not recognised. Call 24M.'],
    ['RATE_LIMITED', 'Too many checks. Try again later.'],
  ])('public %s', async (result, text) => {
    rpc({ public_coupon_info: { result } });
    open();
    expect(await screen.findByText(text)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to 24M home page' })).toBeInTheDocument();
  });

  it('a bad check character never reaches the network', async () => {
    open(`${CODE.slice(0, 12)}${CODE.endsWith('0') ? '1' : '0'}`);
    expect(await screen.findByRole('alert')).toHaveTextContent('Not a valid 24M code.');
  });

  it('a foreign QR address is not a 24M coupon', async () => {
    renderAt(<CouponPage />, {
      path: '/c/:code',
      route: '/c/https%3A%2F%2Fevil.example.com%2Fc%2F' + CODE,
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('Not a 24M coupon.');
  });

  it('a network failure on the public check offers a retry', async () => {
    let n = 0;
    rpc({
      public_coupon_info: () =>
        n++ === 0 ? err(500, 'x') : { result: 'GENUINE', value_paise: 10000, state: 'ACTIVE' },
    });
    open();
    expect(
      await screen.findByText('No internet. Try again when you are online.'),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Status: Active')).toBeInTheDocument();
  });
});

describe('CouponPage: a signed-in dealer', () => {
  it('sees one action, Validate, and the validation sticks', async () => {
    signIn();
    let validateCalls = 0;
    rpc({
      check_coupon: VALID,
      validate_coupon: () => {
        validateCalls += 1;
        return VALIDATED;
      },
    });
    open(CODE.toLowerCase());
    expect(await screen.findByText('Valid coupon · ₹100')).toBeInTheDocument();
    expect(screen.getByText('Serial P24-0000001')).toBeInTheDocument();
    expect(screen.getByText('24M Primer 1 L')).toBeInTheDocument();
    expect(screen.getByText('Status: Active')).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.queryByRole('link', { name: 'Login to validate' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to 24M home page' })).toBeInTheDocument();
    await userEvent.dblClick(screen.getByRole('button', { name: 'Validate coupon' }));
    expect(await screen.findByText('Validated ✓')).toBeInTheDocument();
    expect(screen.getByText('Serial P24-0000001')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Scan next coupon' })).toBeInTheDocument();
    expect(validateCalls).toBe(1);
  });

  it('sends the normalised code', async () => {
    signIn();
    let sent: unknown = null;
    rpc({
      check_coupon: VALID,
      validate_coupon: (a) => ((sent = a['p_code']), VALIDATED),
    });
    open(CODE.toLowerCase());
    await userEvent.click(await screen.findByRole('button', { name: 'Validate coupon' }));
    await screen.findByText('Validated ✓');
    expect(sent).toBe(CODE);
  });

  it.each([
    [
      { result: 'ALREADY_REDEEMED_SELF', redeemed_at: '2026-11-12T05:02:00Z' },
      'Already validated by you on 12 Nov 2026, 10:32',
    ],
    [
      { result: 'ALREADY_REDEEMED_OTHER', serial: 'P24-0000001' },
      'Already validated by another dealer.',
    ],
    [{ result: 'ALREADY_CLOSED' }, 'Already redeemed. This coupon cannot be used again.'],
    [{ result: 'EXPIRED', expires_at: '2026-11-12T05:02:00Z' }, 'Coupon expired on 12 Nov 2026.'],
    [{ result: 'NOT_ACTIVE' }, 'This coupon is not active yet. Call 24M.'],
    [{ result: 'BLOCKED' }, 'This coupon is blocked. Call 24M.'],
    [{ result: 'NOT_FOUND' }, 'Coupon not recognised. Call 24M.'],
    [{ result: 'DEALER_INACTIVE' }, 'Your shop is not active. Call 24M.'],
    [{ result: 'TOO_MANY_INVALID' }, 'Too many wrong scans. Wait 10 minutes.'],
  ])('%j offers no Validate button', async (check, text) => {
    signIn();
    rpc({ check_coupon: check });
    open();
    expect(await screen.findByText(text)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Validate coupon' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Scan next coupon' })).toBeInTheDocument();
  });

  it('a coupon someone else validated first is explained', async () => {
    signIn();
    rpc({
      check_coupon: VALID,
      validate_coupon: { result: 'ALREADY_REDEEMED_OTHER', serial: 'P24-0000001' },
    });
    open();
    await userEvent.click(await screen.findByRole('button', { name: 'Validate coupon' }));
    expect(await screen.findByText('Already validated by another dealer.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Validate coupon' })).not.toBeInTheDocument();
  });

  it('a failed validation says so and can be retried from the start', async () => {
    signIn();
    let n = 0;
    rpc({ check_coupon: VALID, validate_coupon: () => (n++ === 0 ? err(500, 'x') : VALIDATED) });
    open();
    await userEvent.click(await screen.findByRole('button', { name: 'Validate coupon' }));
    expect(
      await screen.findByText('No internet. Try again when you are online.'),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Validate coupon' }));
    expect(await screen.findByText('Validated ✓')).toBeInTheDocument();
  });

  it('a session that ran out falls back to the public view with the login option', async () => {
    signIn();
    rpc({
      check_coupon: err(401, 'AUTH_REQUIRED'),
      public_coupon_info: { result: 'GENUINE', value_paise: 10000, state: 'ACTIVE' },
    });
    open();
    expect(await screen.findByRole('link', { name: 'Login to validate' })).toBeInTheDocument();
  });

  it('a failed validation with an expired session offers the login again', async () => {
    signIn();
    rpc({ check_coupon: VALID, validate_coupon: err(401, 'AUTH_REQUIRED') });
    open();
    await userEvent.click(await screen.findByRole('button', { name: 'Validate coupon' }));
    expect(await screen.findByText('Log in to validate')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Login to validate' })).toBeInTheDocument();
  });

  it('a signed-in distributor or 24M user sees the status but no way to validate', async () => {
    signIn();
    rpc({
      check_coupon: err(403, 'FORBIDDEN'),
      public_coupon_info: { result: 'GENUINE', value_paise: 10000, state: 'VALIDATED' },
    });
    open();
    expect(await screen.findByText('Status: Validated')).toBeInTheDocument();
    expect(screen.getByText('Only dealers can validate coupons.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Login to validate' })).not.toBeInTheDocument();
  });

  it('a captive Wi-Fi page is never treated as an answer', async () => {
    signIn();
    server.use(
      http.post(
        `${API}/rest/v1/rpc/check_coupon`,
        () =>
          new HttpResponse('<html>Wi-Fi login</html>', {
            headers: { 'content-type': 'text/html' },
          }),
      ),
    );
    open();
    expect(
      await screen.findByText('This Wi-Fi needs a login page. Use mobile data.'),
    ).toBeInTheDocument();
  });
});

describe('Home, history, PIN, type, scan', () => {
  it('home shows validated counts and the right links; cached when offline', async () => {
    signIn();
    rpc({ dealer_home: HOME });
    renderAt(<HomePage />);
    expect(await screen.findByText('Namaste, Owner A')).toBeInTheDocument();
    expect(screen.getByText('3 validated')).toBeInTheDocument();
    expect(screen.getByText('20 validated')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Scan coupon' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Type code' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'My validations' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Change PIN' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /claims|staff|scan many/i })).not.toBeInTheDocument();
    server.use(http.post(`${API}/rest/v1/rpc/dealer_home`, () => HttpResponse.error()));
    renderAt(<HomePage />);
    expect(await screen.findByText(/Last updated/)).toBeInTheDocument();
  });

  it('home with nothing cached shows a retryable error', async () => {
    signIn();
    rpc({ dealer_home: err(500, 'x') });
    renderAt(<HomePage />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('log out goes to the login page', async () => {
    signIn();
    rpc({ dealer_home: HOME });
    renderAt(<HomePage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Log out' }));
    expect(await screen.findByText('navigated')).toBeInTheDocument();
  });

  it('history lists validated coupons and pages', async () => {
    signIn();
    const row = (n: number) => ({
      serial: `P24-${String(n).padStart(7, '0')}`,
      value_paise: 10000,
      validated_at: `2026-10-26T10:${String(n % 60).padStart(2, '0')}:00Z`,
      validated_by: 'Staff A',
    });
    let before: unknown = 'unset';
    rpc({
      my_validations: ({ p_before }) => {
        before = p_before;
        return p_before === null ? Array.from({ length: 20 }, (_, i) => row(100 - i)) : [row(1)];
      },
    });
    renderAt(<HistoryPage />);
    expect(await screen.findAllByText(/by Staff A/)).toHaveLength(20);
    expect(before).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Show more' }));
    await waitFor(() => {
      expect(screen.getAllByRole('listitem')).toHaveLength(21);
    });
    expect(before).toBe('2026-10-26T10:21:00Z');
  });

  it('history: empty', async () => {
    signIn();
    rpc({ my_validations: [] });
    renderAt(<HistoryPage />);
    expect(await screen.findByText('No coupons validated yet')).toBeInTheDocument();
  });

  it('history error', async () => {
    signIn();
    rpc({ my_validations: err(500, 'x') });
    renderAt(<HistoryPage />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('change PIN: needs a full, matching PIN, then saves', async () => {
    signIn();
    let sent: unknown = null;
    rpc({ change_my_pin: (a) => ((sent = a), null) });
    renderAt(<PinPage />);
    const save = screen.getByRole('button', { name: 'Change PIN' });
    expect(save).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Current PIN'), '2468x');
    await userEvent.type(screen.getByLabelText('New PIN'), '1357');
    await userEvent.type(screen.getByLabelText('New PIN again'), '135');
    expect(screen.getByText('The two new PINs are different.')).toBeInTheDocument();
    expect(save).toBeDisabled();
    await userEvent.type(screen.getByLabelText('New PIN again'), '7');
    await userEvent.click(save);
    expect(await screen.findByText('PIN changed.')).toBeInTheDocument();
    expect(sent).toEqual({ p_old: '2468', p_new: '1357' });
    expect(screen.getByLabelText('Current PIN')).toHaveValue('');
  });

  it.each([
    ['WRONG_PIN', 'The current PIN is wrong.'],
    [
      'WEAK_PIN',
      'Choose a PIN that is hard to guess: not 1234 or 1111, and not the last four digits of your mobile number.',
    ],
  ])('change PIN: %s is explained', async (code, text) => {
    signIn();
    rpc({ change_my_pin: err(409, code) });
    renderAt(<PinPage />);
    await userEvent.type(screen.getByLabelText('Current PIN'), '2468');
    await userEvent.type(screen.getByLabelText('New PIN'), '1357');
    await userEvent.type(screen.getByLabelText('New PIN again'), '1357');
    await userEvent.click(screen.getByRole('button', { name: 'Change PIN' }));
    expect(await screen.findByText(text)).toBeInTheDocument();
  });

  it('change PIN: any other failure is a generic error', async () => {
    signIn();
    rpc({ change_my_pin: err(500, 'x') });
    renderAt(<PinPage />);
    await userEvent.type(screen.getByLabelText('Current PIN'), '2468');
    await userEvent.type(screen.getByLabelText('New PIN'), '1357');
    await userEvent.type(screen.getByLabelText('New PIN again'), '1357');
    await userEvent.click(screen.getByRole('button', { name: 'Change PIN' }));
    expect(await screen.findByText('Something went wrong. Try again.')).toBeInTheDocument();
  });

  it('type code → coupon page', async () => {
    renderAt(<TypeCodePage />, { path: '/type', route: '/type' });
    await userEvent.type(screen.getByLabelText('Coupon code (13 characters)'), CODE);
    await userEvent.click(screen.getByRole('button', { name: 'Check coupon' }));
    expect(await screen.findByText('navigated')).toBeInTheDocument();
  });

  it('scan page: valid scan navigates; foreign QR is refused', async () => {
    scanned.push('https://x.brand/p', 'abc', `https://c.example.in/c/${CODE}`);
    renderAt(<ScanPage />, { path: '/scan', route: '/scan' });
    await userEvent.click(screen.getByRole('button', { name: 'scan https://x.brand/p' }));
    expect(screen.getByText('Not a 24M coupon.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'scan abc' }));
    expect(screen.getByText('Not a valid 24M code.')).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole('button', { name: `scan https://c.example.in/c/${CODE}` }),
    );
    expect(await screen.findByText('navigated')).toBeInTheDocument();
  });
});
