import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../ui/Scanner.tsx', async () => ({
  Scanner: (await import('../../test/scanner-stub.tsx')).ScannerStub,
}));

import { CODE, CODE2, HOME, REDEEMED, VALID } from '../../test/fixtures.ts';
import { renderAt, signIn } from '../../test/render.tsx';
import { scanned } from '../../test/scanner-stub.tsx';
import { API, err, rest, rpc, server } from '../../test/server.ts';

import { BulkScanPage } from './BulkScanPage.tsx';
import { ClaimsPage } from './ClaimsPage.tsx';
import { CouponPage } from './CouponPage.tsx';
import { HistoryPage } from './HistoryPage.tsx';
import { HomePage } from './HomePage.tsx';
import { ReceiptPage, summarise } from './ReceiptPage.tsx';
import { ScanPage } from './ScanPage.tsx';
import { StaffPage } from './StaffPage.tsx';
import { TypeCodePage } from './TypeCodePage.tsx';

beforeEach(() => {
  scanned.length = 0;
});

describe('CouponPage (§4.1)', () => {
  it('logged out: public genuineness check, then the dealer login prompt', async () => {
    rpc({ public_coupon_info: { result: 'GENUINE', value_paise: 10000 } });
    renderAt(<CouponPage />, { path: '/c/:code', route: `/c/${CODE}` });
    expect(
      await screen.findByText('Genuine 24M coupon · ₹100. Take it to your 24M dealer.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Dealer? Log in' })).toBeInTheDocument();
  });

  it.each([
    ['NOT_RECOGNISED', 'This coupon is not recognised. Call 24M.'],
    ['RATE_LIMITED', 'Too many checks. Try again later.'],
  ])('public %s', async (result, text) => {
    rpc({ public_coupon_info: { result } });
    renderAt(<CouponPage />, { path: '/c/:code', route: `/c/${CODE}` });
    expect(await screen.findByText(text)).toBeInTheDocument();
  });

  it('EC-005 a bad check character never reaches the network', async () => {
    renderAt(<CouponPage />, {
      path: '/c/:code',
      route: `/c/${CODE.slice(0, 12)}${CODE.endsWith('0') ? '1' : '0'}`,
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('Not a valid 24M code. Do NOT pay.');
  });

  it('valid coupon → one tap → receipt (and the button locks while saving)', async () => {
    signIn();
    let redeemCalls = 0;
    rpc({
      check_coupon: VALID,
      redeem: () => {
        redeemCalls += 1;
        return REDEEMED;
      },
    });
    renderAt(<CouponPage />, { path: '/c/:code', route: `/c/${CODE.toLowerCase()}` });
    expect(await screen.findByText('Valid coupon · ₹100')).toBeInTheDocument();
    expect(screen.getByText('Serial P24-0000001')).toBeInTheDocument();
    expect(screen.getByText('24M Primer 1 L')).toBeInTheDocument();
    const confirm = screen.getByRole('button', { name: '₹100 paid – Confirm' });
    await userEvent.dblClick(confirm);
    expect(await screen.findByText('navigated')).toBeInTheDocument();
    expect(redeemCalls).toBe(1);
  });

  it('EC-021 already used elsewhere: red, Do NOT pay, no confirm button', async () => {
    signIn();
    rpc({
      check_coupon: { result: 'ALREADY_REDEEMED_OTHER', serial: 'P24-0000001', value_paise: 10000 },
    });
    renderAt(<CouponPage />, { path: '/c/:code', route: `/c/${CODE}` });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Already used at another shop. Do NOT pay.',
    );
    expect(screen.getByText('Do NOT pay')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Confirm/ })).not.toBeInTheDocument();
  });

  it('EC-020 already redeemed by me shows when', async () => {
    signIn();
    rpc({ check_coupon: { result: 'ALREADY_REDEEMED_SELF', redeemed_at: '2026-11-12T05:02:00Z' } });
    renderAt(<CouponPage />, { path: '/c/:code', route: `/c/${CODE}` });
    expect(
      await screen.findByText('Already redeemed by you on 12 Nov 2026, 10:32'),
    ).toBeInTheDocument();
  });

  it('expired coupon', async () => {
    signIn();
    rpc({ check_coupon: { result: 'EXPIRED', expires_at: '2026-11-12T05:02:00Z' } });
    renderAt(<CouponPage />, { path: '/c/:code', route: `/c/${CODE}` });
    expect(await screen.findByText('Coupon expired on 12 Nov 2026.')).toBeInTheDocument();
  });

  it('session expired → login prompt; server error → retry', async () => {
    signIn();
    rpc({ check_coupon: err(401, 'AUTH_REQUIRED') });
    renderAt(<CouponPage />, { path: '/c/:code', route: `/c/${CODE}` });
    expect(await screen.findByRole('link', { name: 'Dealer? Log in' })).toBeInTheDocument();
  });

  it('server failure is never green; retry works', async () => {
    signIn();
    let n = 0;
    rpc({ check_coupon: () => (n++ === 0 ? err(500, 'x') : VALID) });
    renderAt(<CouponPage />, { path: '/c/:code', route: `/c/${CODE}` });
    expect(await screen.findByText('No internet. Don’t pay yet.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Valid coupon · ₹100')).toBeInTheDocument();
  });

  it('a definite redeem failure says "Not redeemed"', async () => {
    signIn();
    rpc({ check_coupon: VALID, redeem: err(403, 'FORBIDDEN') });
    renderAt(<CouponPage />, { path: '/c/:code', route: `/c/${CODE}` });
    await userEvent.click(await screen.findByRole('button', { name: '₹100 paid – Confirm' }));
    expect(await screen.findByText('Not redeemed. Try again.')).toBeInTheDocument();
  });

  it('forbidden role and captive portal', async () => {
    signIn();
    rpc({ check_coupon: err(403, 'FORBIDDEN') });
    renderAt(<CouponPage />, { path: '/c/:code', route: `/c/${CODE}` });
    expect(await screen.findByText('This login cannot redeem coupons.')).toBeInTheDocument();
  });

  it('EC-008 a foreign QR URL is not a 24M coupon', async () => {
    renderAt(<CouponPage />, {
      path: '/*',
      route: '/c/https%3A%2F%2Fevil.example.com%2Fc%2F' + CODE,
    });
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});

describe('ReceiptPage (§4.2)', () => {
  it('shows the painter QR, number and message, and updates live to confirmed', async () => {
    signIn();
    let polls = 0;
    rpc({
      dealer_home: HOME,
      batch_status: () => {
        polls += 1;
        return {
          batch_id: 42,
          status: polls > 1 ? 'CONFIRMED' : 'PENDING',
          count: 1,
          value_paise: 10000,
          token: 'K7Q2M9',
        };
      },
    });
    renderAt(<ReceiptPage />, { path: '/receipt/:batchId', route: '/receipt/42', state: REDEEMED });
    expect(screen.getByText('Redeemed ✓ ₹100')).toBeInTheDocument();
    expect(
      await screen.findByRole('img', { name: 'QR code. Message: 24M PAID K7Q2M9' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Or send this on WhatsApp to +919000000000:')).toBeInTheDocument();
    expect(
      await screen.findByText('Painter confirmed ✓', {}, { timeout: 5000 }),
    ).toBeInTheDocument();
  });

  it('EC-095 painter has no WhatsApp', async () => {
    signIn();
    let skipped = false;
    rpc({
      dealer_home: HOME,
      batch_status: () => ({
        batch_id: 42,
        status: skipped ? 'SKIPPED' : 'PENDING',
        count: 1,
        value_paise: 10000,
        token: 'K7Q2M9',
      }),
      skip_painter_confirmation: () => {
        skipped = true;
        return {};
      },
    });
    renderAt(<ReceiptPage />, { path: '/receipt/:batchId', route: '/receipt/42' });
    await userEvent.click(await screen.findByRole('button', { name: 'Painter has no WhatsApp' }));
    expect(await screen.findByText('Marked: painter has no WhatsApp')).toBeInTheDocument();
  });

  it.each([
    ['DISPUTED', 'Painter says NOT paid. Coupons on hold.'],
    ['LATE', 'Painter confirmed (late) ✓'],
    ['EXPIRED', 'Painter did not confirm'],
    ['NONE', 'No painter confirmation'],
  ])('outcome %s', async (status, text) => {
    signIn();
    rpc({
      dealer_home: HOME,
      batch_status: { batch_id: 42, status, count: 2, value_paise: 20000 },
    });
    renderAt(<ReceiptPage />, { path: '/receipt/:batchId', route: '/receipt/42' });
    expect(await screen.findByText(text)).toBeInTheDocument();
    expect(screen.getByText('2 coupons')).toBeInTheDocument();
  });

  it('EC-027 partial batches list what was not redeemed', () => {
    signIn();
    rpc({ dealer_home: HOME, batch_status: err(500, 'x') });
    const partial = {
      ...REDEEMED,
      result: 'PARTIAL',
      lines: [...REDEEMED.lines, { code: CODE2, result: 'ALREADY_REDEEMED_OTHER' }],
    };
    renderAt(<ReceiptPage />, { path: '/receipt/:batchId', route: '/receipt/42', state: partial });
    expect(screen.getByText('1 of 2 coupons redeemed')).toBeInTheDocument();
    expect(screen.getByText(/Already used at another shop/)).toBeInTheDocument();
  });

  it('summarise prefers live status for the token', () => {
    expect(summarise(null, null)).toMatchObject({ count: 0, value: 0, token: null });
    expect(
      summarise(null, { batch_id: 1, status: 'PENDING', count: 2, value_paise: 5, token: 'T1' })
        .token,
    ).toBe('T1');
  });

  it('2.2.1 warns before hiding the QR and lets the dealer keep showing it', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      signIn();
      rpc({
        dealer_home: HOME,
        batch_status: {
          batch_id: 42,
          status: 'PENDING',
          count: 1,
          value_paise: 10000,
          token: 'K7Q2M9',
        },
      });
      renderAt(<ReceiptPage />, { path: '/receipt/:batchId', route: '/receipt/42' });
      await screen.findByRole('img');
      await vi.advanceTimersByTimeAsync(8.5 * 60_000);
      const keep = await screen.findByRole('button', { name: 'Keep showing' });
      await vi.advanceTimersByTimeAsync(2 * 60_000);
      expect(await screen.findByRole('button', { name: 'Show painter QR' })).toBeInTheDocument();
      expect(keep).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('BulkScanPage (§5.2)', () => {
  it('checks each scan, ignores duplicates, and redeems all valid in one request', async () => {
    signIn();
    scanned.push(CODE, CODE2, 'https://other.brand/p/1', 'garbage');
    let sent: unknown = null;
    rpc({
      check_coupon: ({ p_code }) =>
        p_code === CODE ? VALID : { result: 'ALREADY_REDEEMED_OTHER', serial: 'P24-0000002' },
      redeem: (args) => {
        sent = args['p_codes'];
        return REDEEMED;
      },
    });
    renderAt(<BulkScanPage />, { path: '/scan-many', route: '/scan-many' });
    expect(screen.getByRole('button', { name: /Confirm/ })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: `scan ${CODE}` }));
    await userEvent.click(screen.getByRole('button', { name: `scan ${CODE2}` }));
    await userEvent.click(screen.getByRole('button', { name: `scan ${CODE}` }));
    expect(screen.getByText('Already in list')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'scan https://other.brand/p/1' }));
    expect(screen.getByText('Not a 24M coupon. Do NOT pay.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'scan garbage' }));
    expect(screen.getByText('Not a valid 24M code. Do NOT pay.')).toBeInTheDocument();
    await screen.findByText('Valid coupon · ₹100');
    await userEvent.click(screen.getByRole('button', { name: /Remove P24-0000002/ }));
    await userEvent.click(screen.getByRole('button', { name: '₹100 for 1 coupons – Confirm' }));
    expect(await screen.findByText('navigated')).toBeInTheDocument();
    expect(sent).toEqual([CODE]);
  });

  it('EC-025 caps the list at 50 and shows check failures', async () => {
    signIn();
    const { code } = await import('../../test/fixtures.ts');
    for (let n = 0; n < 51; n += 1) scanned.push(code(`AAAAAAAAA${n.toString().padStart(3, '0')}`));
    rpc({ check_coupon: err(500, 'x') });
    renderAt(<BulkScanPage />, { path: '/scan-many', route: '/scan-many' });
    for (const s of scanned)
      await userEvent.click(screen.getByRole('button', { name: `scan ${s}` }));
    expect(screen.getByText('Maximum 50 coupons at once.')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(50);
    await userEvent.click(screen.getByRole('button', { name: 'close scanner' }));
  }, 30_000);
});

describe('Home, history, type, scan', () => {
  it('home totals, links for the owner, cached when offline', async () => {
    signIn();
    rpc({ dealer_home: HOME });
    renderAt(<HomePage userRole="DEALER_OWNER" />);
    expect(await screen.findByText('Namaste, Owner A')).toBeInTheDocument();
    expect(screen.getByText('₹300')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'My claims' })).toBeInTheDocument();
    expect(screen.getByText('1 waiting for painter')).toBeInTheDocument();
    server.use(http.post(`${API}/rest/v1/rpc/dealer_home`, () => HttpResponse.error()));
    renderAt(<HomePage userRole="DEALER_STAFF" />);
    expect(await screen.findByText(/Last updated/)).toBeInTheDocument();
  });

  it('home with nothing cached shows a retryable error; log out', async () => {
    signIn();
    rpc({ dealer_home: err(500, 'x') });
    renderAt(<HomePage userRole="DEALER_STAFF" />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'My claims' })).not.toBeInTheDocument();
  });

  it('history lists batches with painter status, re-show QR and paging', async () => {
    signIn();
    const row = (id: number, token: string | null) => ({
      batch_id: id,
      created_at: '2026-10-26T10:00:00Z',
      count: 1,
      value_paise: 10000,
      redeemed_by: 'Staff A',
      painter_status: token === null ? 'CONFIRMED' : 'PENDING',
      token,
      serials: ['P24-1'],
    });
    rpc({
      my_batches: ({ p_before_id }) =>
        p_before_id === null
          ? Array.from({ length: 20 }, (_, i) => row(100 - i, i === 0 ? 'K7Q2M9' : null))
          : [row(1, null)],
    });
    renderAt(<HistoryPage />);
    expect(await screen.findAllByText('✓ Confirmed')).toHaveLength(19);
    expect(screen.getByRole('link', { name: 'Show painter QR' })).toHaveAttribute(
      'href',
      '/receipt/100',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Show more' }));
    await waitFor(() => {
      expect(screen.getAllByRole('listitem')).toHaveLength(21);
    });
  });

  it('history empty and error', async () => {
    signIn();
    rpc({ my_batches: [] });
    renderAt(<HistoryPage />);
    expect(await screen.findByText('No coupons yet')).toBeInTheDocument();
  });

  it('history error', async () => {
    signIn();
    rpc({ my_batches: err(500, 'x') });
    renderAt(<HistoryPage />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
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
    expect(screen.getByText('Not a 24M coupon. Do NOT pay.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'scan abc' }));
    expect(screen.getByText('Not a valid 24M code. Do NOT pay.')).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole('button', { name: `scan https://c.example.in/c/${CODE}` }),
    );
    expect(await screen.findByText('navigated')).toBeInTheDocument();
  });
});

describe('Owner: claims and staff', () => {
  const claims = [
    {
      id: 3,
      status: 'OPEN',
      cn_no: null,
      cn_date: null,
      cn_total_paise: null,
      lines: 2,
      value_paise: 20000,
      slip_token: 's3',
    },
    {
      id: 2,
      status: 'SUBMITTED',
      cn_no: null,
      cn_date: null,
      cn_total_paise: null,
      lines: 1,
      value_paise: 10000,
      slip_token: 's2',
    },
    {
      id: 1,
      status: 'CN_ISSUED',
      cn_no: 'CN-1',
      cn_date: '2026-10-01',
      cn_total_paise: 10000,
      lines: 1,
      value_paise: 10000,
      slip_token: 's1',
    },
  ];

  it('submit, slip QR, mark CN received', async () => {
    signIn();
    const calls: string[] = [];
    rpc({
      my_claims: claims,
      submit_dealer_claim: () => (calls.push('submit'), 3),
      ack_dealer_cn: () => (calls.push('ack'), null),
    });
    renderAt(<ClaimsPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Submit claim now' }));
    await userEvent.click(screen.getByRole('button', { name: 'Mark CN received' }));
    await userEvent.click(screen.getByRole('button', { name: 'Claim slip' }));
    expect(screen.getByRole('img', { name: 'Claim slip' })).toBeInTheDocument();
    expect(screen.getByText('CN CN-1 · 1 Oct 2026')).toBeInTheDocument();
    await waitFor(() => {
      expect(calls).toEqual(['submit', 'ack']);
    });
  });

  it('claims: empty, error on action, load failure', async () => {
    signIn();
    rpc({ my_claims: [] });
    renderAt(<ClaimsPage />);
    expect(await screen.findByText('No claims yet')).toBeInTheDocument();
  });

  it('claims load failure', async () => {
    signIn();
    rpc({ my_claims: err(500, 'x') });
    renderAt(<ClaimsPage />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('staff: request a login and remove someone (with confirmation)', async () => {
    signIn();
    rest({
      app_user: [
        { id: 2, name: 'Staff A', mobile_e164: '+919800000002', status: 'ACTIVE' },
        { id: 11, name: 'Old', mobile_e164: null, status: 'INACTIVE' },
      ],
    });
    let requested: unknown = null;
    let removed: unknown = null;
    rpc({ request_staff: (a) => ((requested = a), 9) });
    server.use(
      http.post(
        `${API}/functions/v1/admin-user-status`,
        async ({ request }) => ((removed = await request.json()), HttpResponse.json({})),
      ),
    );
    renderAt(<StaffPage dealerId={1} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Remove' }));
    expect(
      screen.getByRole('dialog', { name: 'Remove Staff A? They will be logged out immediately.' }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await userEvent.click(screen.getAllByRole('button', { name: 'Remove' })[1]!);
    await waitFor(() => {
      expect(removed).toMatchObject({ user_id: 2, status: 'INACTIVE' });
    });
    await userEvent.type(screen.getByLabelText('Name'), 'Ravi');
    await userEvent.type(screen.getByLabelText('Mobile number'), '123');
    expect(screen.getByText('Your mobile number')).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText('Mobile number'));
    await userEvent.type(screen.getByLabelText('Mobile number'), '98765 43210');
    await userEvent.click(screen.getByRole('button', { name: 'Send request' }));
    expect(await screen.findByText('Request sent to your distributor.')).toBeInTheDocument();
    expect(requested).toEqual({ p_name: 'Ravi', p_mobile: '+919876543210' });
  });

  it('staff: empty list and failed request', async () => {
    signIn();
    rest({ app_user: [] });
    rpc({ request_staff: err(409, 'DUPLICATE_MOBILE') });
    renderAt(<StaffPage dealerId={1} />);
    expect(await screen.findByText('No staff yet')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Name'), 'Ravi');
    await userEvent.type(screen.getByLabelText('Mobile number'), '9876543210');
    await userEvent.click(screen.getByRole('button', { name: 'Send request' }));
    expect(await screen.findByText('Something went wrong. Try again.')).toBeInTheDocument();
  });
});
