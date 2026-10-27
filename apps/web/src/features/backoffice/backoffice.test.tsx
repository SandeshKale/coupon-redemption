import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import { PROFILE, STATS } from '../../test/fixtures.ts';
import { renderAt, signIn } from '../../test/render.tsx';
import { API, err, rest, rpc, server } from '../../test/server.ts';

import BackOffice from './BackOffice.tsx';
import { failureText, num, str, summarise } from './data.ts';

const profile = (role: string) => PROFILE(role)[0] as never;
const open = (role: string, route: string) =>
  renderAt(<BackOffice profile={profile(role)} />, {
    path: `/${role === 'DISTRIBUTOR' ? 'd' : 'm'}/*`,
    route,
  });

function captureFunctions(): Record<string, unknown[]> {
  const calls: Record<string, unknown[]> = {};
  server.use(
    http.all(`${API}/functions/v1/:fn`, async ({ params, request }) => {
      const fn = String(params['fn']);
      const text = request.method === 'GET' ? new URL(request.url).search : await request.text();
      let body: unknown = text;
      try {
        body = JSON.parse(text);
      } catch {
        // CSV or query string
      }
      (calls[fn] ??= []).push(body);
      if (fn === 'admin-create-user') return HttpResponse.json({ user_id: 50 }, { status: 201 });
      if (fn === 'export-print-file')
        return new HttpResponse('serial,code13\r\n', { headers: { 'content-type': 'text/csv' } });
      if (fn === 'bulk-upload') return HttpResponse.json({ ok: true, rows: 1, committed: false });
      return HttpResponse.json({});
    }),
  );
  return calls;
}

const DEALERS = [
  {
    id: 1,
    code: 'DL00001',
    name: 'Shree Ganesh Paints',
    gst: '27AAAPL1234C1Z5',
    mobile_e164: '+919700000001',
    status: 'ACTIVE',
    distributor_id: 1,
    distributor: 'Pune',
    user_id: 21,
    user_status: 'ACTIVE',
    validated: 5,
  },
  {
    id: 2,
    code: 'DL00002',
    name: 'Sai Hardware',
    gst: null,
    mobile_e164: '+919700000002',
    status: 'ACTIVE',
    distributor_id: 1,
    distributor: 'Pune',
    user_id: 22,
    user_status: 'INACTIVE',
    validated: 0,
  },
  {
    id: 3,
    code: 'DL00003',
    name: 'No Login Yet',
    gst: null,
    mobile_e164: '+919700000003',
    status: 'ACTIVE',
    distributor_id: 1,
    distributor: 'Pune',
    user_id: null,
    user_status: null,
    validated: 0,
  },
];

describe('distributor and sales rep: dealers', () => {
  it('lists dealers and adds one with a PIN; GST is optional', async () => {
    signIn();
    const calls = captureFunctions();
    rpc({ list_dealers: DEALERS });
    open('DISTRIBUTOR', '/d');
    expect(await screen.findByText('Shree Ganesh Paints')).toBeInTheDocument();
    expect(screen.getByText('27AAAPL1234C1Z5')).toBeInTheDocument();
    const add = screen.getByRole('heading', { name: 'Add dealer' }).closest('section')!;
    await userEvent.type(within(add).getByLabelText('Dealer name'), 'Om Paints');
    await userEvent.type(
      within(add).getByLabelText('Dealer WhatsApp mobile number (this is the login)'),
      '98222 00001',
    );
    await userEvent.type(within(add).getByLabelText('4-digit PIN'), '24x68');
    await userEvent.click(within(add).getByRole('button', { name: 'Add dealer' }));
    expect(
      await screen.findByText('Dealer added. They log in with their mobile number and this PIN.'),
    ).toBeInTheDocument();
    expect(calls['admin-create-user']).toEqual([
      {
        name: 'Om Paints',
        mobile: '+919822200001',
        role: 'DEALER_OWNER',
        parent_distributor_id: 1,
        pin: '2468',
      },
    ]);
  });

  it('sends the GST number when given', async () => {
    signIn();
    const calls = captureFunctions();
    rpc({ list_dealers: [] });
    open('DISTRIBUTOR', '/d');
    const add = (await screen.findByRole('heading', { name: 'Add dealer' })).closest('section')!;
    await userEvent.type(within(add).getByLabelText('Dealer name'), 'Om Paints');
    await userEvent.type(within(add).getByLabelText('GST number (optional)'), '27AAAPL1234C1Z5');
    await userEvent.type(
      within(add).getByLabelText('Dealer WhatsApp mobile number (this is the login)'),
      '9822200001',
    );
    await userEvent.type(within(add).getByLabelText('4-digit PIN'), '2468');
    await userEvent.click(within(add).getByRole('button', { name: 'Add dealer' }));
    await waitFor(() => {
      expect(calls['admin-create-user']).toEqual([
        expect.objectContaining({ gst: '27AAAPL1234C1Z5' }),
      ]);
    });
  });

  it('shows the reason when a dealer cannot be added', async () => {
    signIn();
    server.use(
      http.post(`${API}/functions/v1/admin-create-user`, () =>
        HttpResponse.json({ error: 'DUPLICATE_MOBILE' }, { status: 409 }),
      ),
    );
    rpc({ list_dealers: [] });
    open('DISTRIBUTOR', '/d');
    const add = (await screen.findByRole('heading', { name: 'Add dealer' })).closest('section')!;
    await userEvent.type(within(add).getByLabelText('Dealer name'), 'Om Paints');
    await userEvent.type(
      within(add).getByLabelText('Dealer WhatsApp mobile number (this is the login)'),
      '9822200001',
    );
    await userEvent.type(within(add).getByLabelText('4-digit PIN'), '2468');
    await userEvent.click(within(add).getByRole('button', { name: 'Add dealer' }));
    expect(await screen.findByText('DUPLICATE_MOBILE')).toBeInTheDocument();
  });

  it('reports a network failure when adding', async () => {
    signIn();
    server.use(http.post(`${API}/functions/v1/admin-create-user`, () => HttpResponse.error()));
    rpc({ list_dealers: [] });
    open('DISTRIBUTOR', '/d');
    const add = (await screen.findByRole('heading', { name: 'Add dealer' })).closest('section')!;
    await userEvent.type(within(add).getByLabelText('Dealer name'), 'Om Paints');
    await userEvent.type(
      within(add).getByLabelText('Dealer WhatsApp mobile number (this is the login)'),
      '9822200001',
    );
    await userEvent.type(within(add).getByLabelText('4-digit PIN'), '2468');
    await userEvent.click(within(add).getByRole('button', { name: 'Add dealer' }));
    expect(await screen.findByText('Something went wrong. Try again.')).toBeInTheDocument();
  });

  it('switches a dealer login off and on', async () => {
    signIn();
    const calls = captureFunctions();
    rpc({ list_dealers: DEALERS });
    open('DISTRIBUTOR', '/d');
    const on = (await screen.findByText('Shree Ganesh Paints')).closest('tr')!;
    await userEvent.click(within(on).getByRole('button', { name: 'Switch off' }));
    expect(await screen.findByText('Login switched off.')).toBeInTheDocument();
    const off = screen.getByText('Sai Hardware').closest('tr')!;
    await userEvent.click(within(off).getByRole('button', { name: 'Switch on' }));
    expect(await screen.findByText('Login switched on.')).toBeInTheDocument();
    expect(calls['admin-user-status']).toEqual([
      { user_id: 21, status: 'INACTIVE', reason: 'Changed from the dealers list' },
      { user_id: 22, status: 'ACTIVE', reason: 'Changed from the dealers list' },
    ]);
    const none = screen.getByText('No Login Yet').closest('tr')!;
    expect(within(none).queryByRole('button')).not.toBeInTheDocument();
  });

  it('sets a new PIN for a dealer; a weak PIN is explained', async () => {
    signIn();
    const sent: unknown[] = [];
    rpc({
      list_dealers: DEALERS,
      set_user_pin: (a) => (sent.push(a), a['p_pin'] === '1111' ? err(409, 'WEAK_PIN') : null),
    });
    open('DISTRIBUTOR', '/d');
    const row = (await screen.findByText('Shree Ganesh Paints')).closest('tr')!;
    await userEvent.click(within(row).getByRole('button', { name: 'Set new PIN' }));
    const save = within(row).getByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();
    await userEvent.type(within(row).getByLabelText('4-digit PIN'), '1111');
    await userEvent.click(save);
    expect(await within(row).findByText(/Choose a PIN that is hard to guess/)).toBeInTheDocument();
    await userEvent.clear(within(row).getByLabelText('4-digit PIN'));
    await userEvent.type(within(row).getByLabelText('4-digit PIN'), '2468');
    await userEvent.click(within(row).getByRole('button', { name: 'Save' }));
    expect(await within(row).findByText('PIN updated.')).toBeInTheDocument();
    expect(sent).toEqual([
      { p_user_id: 21, p_pin: '1111' },
      { p_user_id: 21, p_pin: '2468' },
    ]);
  });

  it('a PIN reset that fails for another reason says so', async () => {
    signIn();
    rpc({ list_dealers: DEALERS, set_user_pin: err(500, 'x') });
    open('DISTRIBUTOR', '/d');
    const row = (await screen.findByText('Shree Ganesh Paints')).closest('tr')!;
    await userEvent.click(within(row).getByRole('button', { name: 'Set new PIN' }));
    await userEvent.type(within(row).getByLabelText('4-digit PIN'), '2468');
    await userEvent.click(within(row).getByRole('button', { name: 'Save' }));
    expect(await within(row).findByText('Something went wrong. Try again.')).toBeInTheDocument();
  });

  it('a distributor sees only dealers and PIN navigation', async () => {
    signIn();
    rpc({ list_dealers: [] });
    open('DISTRIBUTOR', '/d');
    await screen.findAllByText('Dealers');
    expect(screen.getByRole('link', { name: 'Change PIN' })).toHaveAttribute('href', '/pin');
    expect(screen.queryByRole('link', { name: /claim/i })).not.toBeInTheDocument();
  });
});

describe('24M', () => {
  it('dashboard: totals, lots, distributors, top dealers and recent validations', async () => {
    signIn('u', 'aal2');
    rpc({ coupon_stats: STATS });
    open('M24_ADMIN', '/m');
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    const tile = (label: string) => screen.getByRole('heading', { name: label }).parentElement!;
    expect(within(tile('All coupons')).getByText('1000')).toBeInTheDocument();
    expect(within(tile('Active (live)')).getByText('800')).toBeInTheDocument();
    expect(within(tile('Validated today')).getByText('7')).toBeInTheDocument();
    expect(within(tile('Last 7 days')).getByText('40')).toBeInTheDocument();
    expect(within(tile('Last 30 days')).getByText('120')).toBeInTheDocument();
    expect(screen.getByText('LOT-001')).toBeInTheDocument();
    expect(screen.getByText('DIST-PUNE')).toBeInTheDocument();
    expect(screen.getAllByText('Shree Ganesh Paints').length).toBeGreaterThan(1);
    expect(screen.getByText('P24-0000001')).toBeInTheDocument();
  });

  it('dashboard: a failure says why, and can be retried', async () => {
    signIn('u', 'aal2');
    let n = 0;
    rpc({
      coupon_stats: () => (n++ === 0 ? err(403, 'MFA_REQUIRED') : STATS),
    });
    open('M24_VIEWER', '/m');
    expect(
      await screen.findByText(
        'Two-step verification is required for 24M access.',
        {},
        { timeout: 5000 },
      ),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('LOT-001')).toBeInTheDocument();
  });

  it('a generic dashboard failure shows the standard error', async () => {
    signIn('u', 'aal2');
    rpc({ coupon_stats: err(500, 'x') });
    open('M24_VIEWER', '/m');
    expect(
      await screen.findByText('Something went wrong. Try again.', {}, { timeout: 5000 }),
    ).toBeInTheDocument();
  });

  it('weekly review: sections listed, review logged', async () => {
    signIn('u', 'aal2');
    rest({});
    rpc({ log_weekly_review: 1 });
    open('M24_ADMIN', '/m/review');
    expect(await screen.findByLabelText('Notes')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'WhatsApp health' })).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Notes'), 'all good');
    await userEvent.click(screen.getByRole('button', { name: 'Mark weekly review done' }));
  });

  it('the weekly review is read-only for viewers', async () => {
    signIn('u', 'aal2');
    rest({});
    open('M24_VIEWER', '/m/review');
    await screen.findByRole('heading', { name: 'Weekly review' });
    expect(
      screen.queryByRole('button', { name: 'Mark weekly review done' }),
    ).not.toBeInTheDocument();
  });

  it('lookup: history, admin actions', async () => {
    signIn('u', 'aal2');
    const acts: string[] = [];
    rpc({
      lookup_coupon: ({ p_query }) =>
        p_query === 'none'
          ? { found: false }
          : {
              found: true,
              coupon: { id: 11, serial: 'P24-0000001', status: 'REDEEMED', value_paise: 10000 },
              dealer: { name: 'Shop' },
              events: [
                {
                  event: 'REDEEMED',
                  from: 'ACTIVE',
                  to: 'REDEEMED',
                  by: 'Owner A',
                  ref: 'batch:1',
                  at: '2026-10-01',
                },
              ],
            },
      hold_coupons: () => (acts.push('hold'), 1),
      release_coupons: () => (acts.push('release'), 1),
      reverse_redemption: () => (acts.push('reverse'), null),
    });
    open('M24_ADMIN', '/m/lookup');
    await userEvent.type(screen.getByLabelText('Serial or code'), 'none');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByText('Coupon not recognised. Call 24M.')).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText('Serial or code'));
    await userEvent.type(screen.getByLabelText('Serial or code'), 'P24-0000001');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByRole('heading', { name: 'P24-0000001' })).toBeInTheDocument();
    for (const name of ['Hold', 'Release', 'Reverse redemption']) {
      const form = screen.getByRole('button', { name }).closest('form')!;
      await userEvent.type(within(form).getByRole('textbox'), 'checked with dealer');
      await userEvent.click(within(form).getByRole('button', { name }));
    }
    await waitFor(() => {
      expect(acts).toEqual(['hold', 'release', 'reverse']);
    });
  });

  it('lots: create → generate in batches, export, void, activate, block', async () => {
    signIn('u', 'aal2');
    const calls = captureFunctions();
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    rest({
      coupon_lot: [
        {
          id: 1,
          lot_no: 'LOT-A',
          quantity: 100,
          status: 'GENERATING',
          serial_prefix: 'P24',
          serial_from: 1,
          serial_to: 100,
          generated_count: 0,
          export_count: 0,
        },
      ],
    });
    let gen = 0;
    const rpcs: string[] = [];
    rpc({
      create_lot: { lot_id: 1, serial_from: 1, serial_to: 100 },
      generate_lot_codes: () => ((gen += 50), { generated: gen, done: gen >= 100 }),
      void_serials: () => (rpcs.push('void'), { void: 1 }),
      activate_range: () => (rpcs.push('activate'), { activated: 10 }),
      block_range: () => (rpcs.push('block'), { blocked: 1 }),
    });
    open('M24_ADMIN', '/m/lots');
    await userEvent.click(await screen.findByRole('button', { name: 'Generate codes' }));
    expect(await screen.findByText('Generating… 100 of 100')).toBeInTheDocument();
    const create = screen.getByRole('heading', { name: 'Create lot' }).closest('section')!;
    await userEvent.type(within(create).getByLabelText('Lot number'), 'LOT-B');
    await userEvent.type(within(create).getByLabelText('Quantity'), '100');
    await userEvent.type(within(create).getByLabelText('SKU'), 'PRIMER-1L');
    gen = 0;
    await userEvent.click(within(create).getByRole('button', { name: 'Create lot' }));
    const exp = screen.getByRole('heading', { name: 'Download print file' }).closest('section')!;
    await userEvent.click(within(exp).getByRole('button', { name: 'Download print file' }));
    await waitFor(() => {
      expect(calls['export-print-file']).toEqual(['?lot_id=1']);
    });
    const voidS = screen.getByRole('heading', { name: 'Void spoiled serials' }).closest('section')!;
    await userEvent.type(
      within(voidS).getByLabelText('One serial per line'),
      'P24-0000001 P24-0000002',
    );
    await userEvent.type(within(voidS).getByLabelText('Reason'), 'smudged');
    await userEvent.click(within(voidS).getByRole('button', { name: 'Void spoiled serials' }));
    const act = screen.getByRole('heading', { name: 'Activate range' }).closest('section')!;
    for (const [label, v] of [
      ['From serial no.', '1'],
      ['To serial no.', '10'],
      ['SKU', 'PRIMER-1L'],
      ['Batch number', 'B1'],
    ])
      await userEvent.type(within(act).getByLabelText(label!), v!);
    await userEvent.type(within(act).getByLabelText('Mfg date'), '2026-10-01');
    await userEvent.click(within(act).getByRole('button', { name: 'Activate range' }));
    const blk = screen.getByRole('heading', { name: 'Block range' }).closest('section')!;
    await userEvent.type(within(blk).getByLabelText('From serial no.'), '1');
    await userEvent.type(within(blk).getByLabelText('To serial no.'), '2');
    await userEvent.type(within(blk).getByLabelText('Reason'), 'recall test');
    await userEvent.click(within(blk).getByRole('button', { name: 'Block range' }));
    await waitFor(() => {
      expect(rpcs).toEqual(['void', 'activate', 'block']);
    });
  });

  it('lots: export failure message', async () => {
    signIn('u', 'aal2');
    server.use(
      http.get(`${API}/functions/v1/export-print-file`, () =>
        HttpResponse.json({ error: 'REASON_REQUIRED' }, { status: 409 }),
      ),
    );
    rest({
      coupon_lot: [
        {
          id: 1,
          lot_no: 'LOT-A',
          quantity: 1,
          status: 'EXPORTED',
          serial_prefix: 'P24',
          serial_from: 1,
          serial_to: 1,
        },
      ],
    });
    open('M24_ADMIN', '/m/lots');
    const exp = (await screen.findByRole('heading', { name: 'Download print file' })).closest(
      'section',
    )!;
    await userEvent.type(within(exp).getByLabelText('Reason for another export'), 'reprint');
    await userEvent.click(within(exp).getByRole('button', { name: 'Download print file' }));
    expect(await screen.findByText('REASON_REQUIRED')).toBeInTheDocument();
  });

  it('masters: add a distributor with its login, a sales rep, a dealer, a SKU, and reassign', async () => {
    signIn('u', 'aal2');
    const calls = captureFunctions();
    const rpcs: Record<string, unknown>[] = [];
    rest({
      distributor: [{ id: 1, code: 'DIST-PUNE', name: 'Pune' }],
      sku: [{ code: 'PRIMER-1L', name: 'Primer' }],
    });
    rpc({
      list_dealers: DEALERS,
      upsert_distributor: (a) => (rpcs.push({ dist: a }), 7),
      upsert_sku: (a) => (rpcs.push({ sku: a }), null),
      reassign_dealer: (a) => (rpcs.push({ reassign: a }), null),
    });
    open('M24_ADMIN', '/m/masters');

    const dist = (await screen.findByRole('heading', { name: 'Add distributor' })).closest(
      'section',
    )!;
    await userEvent.type(within(dist).getByLabelText('Distributor name'), 'X Paints');
    await userEvent.type(
      within(dist).getByLabelText('Distributor code (letters and numbers)'),
      'DIST-X',
    );
    await userEvent.type(
      within(dist).getByLabelText('Distributor registered mobile number'),
      '98000 00055',
    );
    await userEvent.type(within(dist).getByLabelText('4-digit PIN'), '2468');
    await userEvent.click(within(dist).getByRole('button', { name: 'Add distributor' }));
    expect(
      await screen.findByText('Distributor added. They log in with this mobile number and PIN.'),
    ).toBeInTheDocument();

    const rep = screen
      .getByRole('heading', { name: 'Add distributor sales rep' })
      .closest('section')!;
    await userEvent.type(within(rep).getByLabelText('Sales rep name'), 'Rep One');
    await userEvent.type(within(rep).getByLabelText('Sales rep mobile number'), '9822200005');
    await userEvent.type(within(rep).getByLabelText('4-digit PIN'), '8642');
    await userEvent.click(within(rep).getByRole('button', { name: 'Add distributor sales rep' }));

    const dealer = screen.getByRole('heading', { name: 'Add dealer (24M)' }).closest('section')!;
    await userEvent.type(within(dealer).getByLabelText('Dealer name'), 'Om Paints');
    await userEvent.type(
      within(dealer).getByLabelText('Dealer WhatsApp mobile number (this is the login)'),
      '9822200001',
    );
    await userEvent.type(within(dealer).getByLabelText('4-digit PIN'), '2468');
    await userEvent.click(within(dealer).getByRole('button', { name: 'Add dealer (24M)' }));

    const sku = screen.getByRole('heading', { name: 'SKU' }).closest('section')!;
    await userEvent.type(within(sku).getByLabelText('Code'), 'PRIMER-4L');
    await userEvent.type(within(sku).getByLabelText('Name'), 'Primer 4 L');
    await userEvent.click(within(sku).getByRole('button', { name: 'Save' }));

    const dealers = screen.getAllByRole('heading', { name: 'Dealers' })[0]!.closest('section')!;
    await userEvent.type(within(dealers).getByLabelText('Dealer'), '1');
    await userEvent.type(within(dealers).getByLabelText('Distributor'), '2');
    await userEvent.type(within(dealers).getByLabelText('Reason'), 'territory');
    await userEvent.click(within(dealers).getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(calls['admin-create-user']).toHaveLength(3);
    });
    expect(calls['admin-create-user']).toEqual([
      {
        name: 'X Paints',
        mobile: '+919800000055',
        role: 'DISTRIBUTOR',
        distributor_id: 7,
        pin: '2468',
      },
      {
        name: 'Rep One',
        mobile: '+919822200005',
        role: 'DISTRIBUTOR',
        distributor_id: 1,
        is_rep: true,
        pin: '8642',
      },
      {
        name: 'Om Paints',
        mobile: '+919822200001',
        role: 'DEALER_OWNER',
        parent_distributor_id: 1,
        pin: '2468',
      },
    ]);
    await waitFor(() => {
      expect(rpcs.map((r) => Object.keys(r)[0])).toEqual(['dist', 'sku', 'reassign']);
    });
    expect(rpcs[0]).toEqual({
      dist: { p_code: 'DIST-X', p_name: 'X Paints', p_mobile: '+919800000055', p_city: null },
    });
  });

  it('masters: a distributor without a valid mobile number is not created', async () => {
    signIn('u', 'aal2');
    const calls = captureFunctions();
    let upserts = 0;
    rest({ distributor: [] });
    rpc({ list_dealers: [], upsert_distributor: () => (upserts += 1) });
    open('M24_ADMIN', '/m/masters');
    const dist = (await screen.findByRole('heading', { name: 'Add distributor' })).closest(
      'section',
    )!;
    await userEvent.type(within(dist).getByLabelText('Distributor name'), 'X Paints');
    await userEvent.type(
      within(dist).getByLabelText('Distributor code (letters and numbers)'),
      'DIST-X',
    );
    await userEvent.type(
      within(dist).getByLabelText('Distributor registered mobile number'),
      '123',
    );
    await userEvent.type(within(dist).getByLabelText('4-digit PIN'), '2468');
    await userEvent.click(within(dist).getByRole('button', { name: 'Add distributor' }));
    await new Promise((r) => setTimeout(r, 50));
    expect(upserts).toBe(0);
    expect(calls['admin-create-user']).toBeUndefined();
  });

  it('masters: if the distributor record is refused, no login is created', async () => {
    signIn('u', 'aal2');
    const calls = captureFunctions();
    rest({ distributor: [] });
    rpc({ list_dealers: [], upsert_distributor: err(409, 'DUPLICATE') });
    open('M24_ADMIN', '/m/masters');
    const dist = (await screen.findByRole('heading', { name: 'Add distributor' })).closest(
      'section',
    )!;
    await userEvent.type(within(dist).getByLabelText('Distributor name'), 'X Paints');
    await userEvent.type(
      within(dist).getByLabelText('Distributor code (letters and numbers)'),
      'DIST-X',
    );
    await userEvent.type(
      within(dist).getByLabelText('Distributor registered mobile number'),
      '9800000055',
    );
    await userEvent.type(within(dist).getByLabelText('4-digit PIN'), '2468');
    await userEvent.click(within(dist).getByRole('button', { name: 'Add distributor' }));
    expect(await screen.findByText('DUPLICATE')).toBeInTheDocument();
    expect(calls['admin-create-user']).toBeUndefined();
  });

  it('users: PIN reset, status changes and adding 24M staff', async () => {
    signIn('u', 'aal2');
    const calls = captureFunctions();
    const pins: unknown[] = [];
    rest({
      app_user: [
        { id: 1, name: 'Owner A', role: 'DEALER_OWNER', status: 'ACTIVE' },
        { id: 5, name: 'Rep One', role: 'DISTRIBUTOR', is_sales_rep: true, status: 'ACTIVE' },
        { id: 9, name: 'Finance', role: 'M24_FINANCE', status: 'INACTIVE' },
      ],
    });
    rpc({ set_user_pin: (a) => (pins.push(a), null) });
    open('M24_ADMIN', '/m/users');
    const owner = (await screen.findByText('Owner A')).closest('tr')!;
    await userEvent.click(within(owner).getByRole('button', { name: 'Set new PIN' }));
    await userEvent.type(within(owner).getByLabelText('4-digit PIN'), '2468');
    await userEvent.click(within(owner).getByRole('button', { name: 'Save' }));
    expect(await within(owner).findByText('PIN updated.')).toBeInTheDocument();
    await userEvent.click(within(owner).getByRole('button', { name: 'Switch off' }));
    const fin = screen.getByText('Finance').closest('tr')!;
    expect(within(fin).queryByRole('button', { name: 'Set new PIN' })).not.toBeInTheDocument();
    await userEvent.click(within(fin).getByRole('button', { name: 'Switch on' }));
    await userEvent.selectOptions(screen.getByLabelText('Role'), 'M24_VIEWER');
    await userEvent.type(screen.getByLabelText('Name'), 'Viewer');
    await userEvent.type(screen.getByLabelText('Email'), 'v@24m.in');
    await userEvent.click(screen.getByRole('button', { name: 'Add 24M staff' }));
    await waitFor(() => {
      expect(calls['admin-create-user']).toEqual([
        { name: 'Viewer', role: 'M24_VIEWER', email: 'v@24m.in' },
      ]);
    });
    expect(pins).toEqual([{ p_user_id: 1, p_pin: '2468' }]);
    expect(calls['admin-user-status']).toEqual([
      { user_id: 1, status: 'INACTIVE', reason: 'Changed by 24M admin' },
      { user_id: 9, status: 'ACTIVE', reason: 'Changed by 24M admin' },
    ]);
  });

  it('viewers and finance see the dashboard, review and lookup but not the editing pages', async () => {
    signIn('u', 'aal2');
    rpc({ coupon_stats: STATS });
    open('M24_VIEWER', '/m');
    await screen.findByRole('heading', { name: 'Dashboard' });
    expect(screen.getByRole('link', { name: 'Weekly review' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Coupon lookup' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Lots' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Masters' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /claim/i })).not.toBeInTheDocument();
  });
});

describe('data helpers', () => {
  it('summarise / failureText / str / num', () => {
    const t = (k: string) => k;
    expect(summarise(null)).toBe('✓');
    expect(summarise('ok')).toBe('ok');
    expect(summarise(Symbol('x'))).toBe('✓');
    expect(summarise({ a: 1, b: null, c: { d: 1 } })).toBe('a: 1, b: –');
    expect(failureText({ kind: 'business', code: 'X', status: 409 }, t as never)).toBe('X');
    expect(failureText({ kind: 'forbidden', code: 'FORBIDDEN' }, t as never)).toBe(
      'common.forbidden',
    );
    expect(failureText({ kind: 'offline' }, t as never)).toBe('state.offline');
    expect(failureText({ kind: 'server', status: 500 }, t as never)).toBe('common.error');
    expect([
      str({ a: 1 }, 'a'),
      str({ a: { b: 1 } }, 'a'),
      str({}, 'a'),
      num({ a: '3' }, 'a'),
      num({}, 'a'),
    ]).toEqual(['1', '{"b":1}', '', 3, 0]);
  });
});
