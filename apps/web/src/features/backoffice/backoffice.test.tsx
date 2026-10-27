import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import { PROFILE } from '../../test/fixtures.ts';
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
      if (fn === 'admin-login-link')
        return HttpResponse.json({
          link: 'https://x',
          whatsapp_url: 'https://wa.me/919800000001?text=hi',
        });
      if (fn === 'export-print-file')
        return new HttpResponse('serial,code13\r\n', { headers: { 'content-type': 'text/csv' } });
      if (fn === 'bulk-upload') return HttpResponse.json({ ok: true, rows: 1, committed: false });
      return HttpResponse.json({});
    }),
  );
  return calls;
}

const LINES = [
  {
    line_id: 1,
    coupon_id: 11,
    serial: 'P24-0000001',
    value_paise: 10000,
    redeemed_at: '2026-10-20T10:00:00Z',
    coupon_status: 'REDEEMED',
    line_status: 'PENDING',
    failures: [],
  },
  {
    line_id: 2,
    coupon_id: 12,
    serial: 'P24-0000002',
    value_paise: 10000,
    redeemed_at: '2026-10-20T10:00:00Z',
    coupon_status: 'ON_HOLD',
    line_status: 'PENDING',
    failures: ['R2-05'],
  },
  {
    line_id: 3,
    coupon_id: 13,
    serial: 'P24-0000003',
    value_paise: 10000,
    redeemed_at: '2026-10-20T10:00:00Z',
    coupon_status: 'REDEEMED',
    line_status: 'APPROVED',
    failures: [],
  },
];

describe('distributor', () => {
  it('queue lists submitted claims and opens a slip', async () => {
    signIn();
    rest({
      dealer_claim: [
        {
          id: 7,
          status: 'SUBMITTED',
          submitted_at: '2026-10-01T05:00:00Z',
          dealer: { name: 'Shree Ganesh Paints', code: 'DLR-001' },
        },
      ],
    });
    rpc({ get_claim_by_slip: { kind: 'DEALER', claim_id: 7 } });
    open('DISTRIBUTOR', '/d');
    expect(await screen.findByRole('link', { name: '#7' })).toHaveAttribute('href', '/d/claim/7');
    expect(screen.getByText('Shree Ganesh Paints')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Slip code'), 'abc');
    await userEvent.click(screen.getByRole('button', { name: 'Open claim slip' }));
    expect(await screen.findByRole('link', { name: /Claim #7/ })).toHaveAttribute(
      'href',
      '/d/claim/7',
    );
  });

  it('slip that is not ours', async () => {
    signIn();
    rpc({ get_claim_by_slip: err(409, 'NOT_FOUND') });
    open('DISTRIBUTOR', '/d/slip/zzz');
    expect(await screen.findByText('You do not have permission for this.')).toBeInTheDocument();
  });

  it('claim detail: rule results per line, decisions, close with CN, notify dealer', async () => {
    signIn();
    const decisions: unknown[] = [];
    rpc({
      dealer_claim_detail: {
        claim: { id: 7, status: 'SUBMITTED', dealer: { name: 'Shree Ganesh Paints' } },
        lines: LINES,
      },
      dist_decide: (a) => (decisions.push(a), { decided: 1, lines: [] }),
      dist_close_claim: {
        claim_id: 7,
        count: 1,
        total_paise: 10000,
        moved: 0,
        dealer_mobile: '+919700000001',
      },
    });
    open('DISTRIBUTOR', '/d/claim/7');
    expect(await screen.findByText('On hold at 24M')).toBeInTheDocument();
    expect(screen.getByText('Total ₹100 for 1 coupons')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Approve all eligible' }));
    await userEvent.selectOptions(screen.getByLabelText('Choose a reason'), 'SUSPECTED_FRAUD');
    const row = screen.getByText('P24-0000002').closest('tr')!;
    await userEvent.click(within(row).getByRole('button', { name: 'Reject' }));
    await userEvent.click(within(row).getByRole('button', { name: 'Hold' }));
    await userEvent.click(within(row).getByRole('button', { name: 'Approve' }));
    row.focus();
    await userEvent.keyboard('a');
    await userEvent.keyboard('r');
    await waitFor(() => {
      expect(decisions).toHaveLength(6);
    });
    expect(decisions[0]).toMatchObject({
      p_coupon_ids: null,
      p_decision: 'APPROVE',
      p_reason: null,
    });
    expect(decisions[1]).toMatchObject({
      p_coupon_ids: [12],
      p_decision: 'REJECT',
      p_reason: 'SUSPECTED_FRAUD',
    });
    await userEvent.click(screen.getByRole('button', { name: 'Close with CN' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('CN number'), 'CN-77');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close with CN' }));
    const notify = await screen.findByRole('link', { name: 'Notify dealer on WhatsApp' });
    expect(notify.getAttribute('href')).toMatch(/^https:\/\/wa\.me\/919700000001\?text=.*CN-77/);
  });

  it('claim detail errors and a closed claim', async () => {
    signIn();
    rpc({
      dealer_claim_detail: { claim: { id: 7, status: 'CN_ISSUED', dealer: {} }, lines: [] },
      dist_decide: err(409, 'CLAIM_NOT_SUBMITTED'),
    });
    open('DISTRIBUTOR', '/d/claim/7');
    expect(await screen.findByRole('button', { name: 'Close with CN' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Approve all eligible' }));
    expect(await screen.findByText('CLAIM_NOT_SUBMITTED')).toBeInTheDocument();
  });

  it('claim detail load failure', async () => {
    signIn();
    rpc({ dealer_claim_detail: err(500, 'x') });
    open('DISTRIBUTOR', '/d/claim/7');
    expect(await screen.findByRole('alert', {}, { timeout: 5000 })).toBeInTheDocument();
  });

  it('claim to 24M', async () => {
    signIn();
    rest({
      dist_claim: [
        {
          id: 3,
          status: 'SUBMITTED',
          created_at: '2026-10-01T05:00:00Z',
          total_paise: 30000,
          cn_no: null,
          slip_token: 'tok',
        },
      ],
    });
    rpc({
      distributor_todo: { cn_ready_to_claim: 4 },
      create_dist_claim: { claim_id: 4, count: 4, total_paise: 40000 },
    });
    open('DISTRIBUTOR', '/d/claims');
    await userEvent.click(await screen.findByRole('button', { name: 'Create claim to 24M' }));
    expect(await screen.findByText(/claim_id: 4/)).toBeInTheDocument();
    expect(screen.getByText('₹300')).toBeInTheDocument();
  });

  it('dealers: requests, links, new logins and new dealers', async () => {
    signIn();
    const calls = captureFunctions();
    rest({
      dealer: [
        {
          id: 1,
          code: 'DLR-001',
          name: 'Shree Ganesh Paints',
          mobile_e164: '+919700000001',
          city: 'Pune',
          status: 'ACTIVE',
        },
      ],
      app_user: [
        {
          id: 2,
          name: 'Staff A',
          mobile_e164: '+919800000002',
          role: 'DEALER_STAFF',
          status: 'ACTIVE',
          dealer_id: 1,
        },
      ],
      user_request: [
        {
          id: 5,
          kind: 'NEW_STAFF',
          name: 'Ravi',
          mobile_e164: '+919812300000',
          dealer_id: 1,
          target_user_id: null,
          status: 'PENDING',
        },
        {
          id: 6,
          kind: 'LOGIN_LINK',
          name: 'Staff A',
          mobile_e164: '+919800000002',
          dealer_id: 1,
          target_user_id: 2,
          status: 'PENDING',
        },
      ],
    });
    rpc({ reject_user_request: null, upsert_dealer: 21 });
    open('DISTRIBUTOR', '/d/dealers');
    const ravi = (await screen.findByText('Ravi')).closest('tr')!;
    await userEvent.click(within(ravi).getByRole('button', { name: 'Create login' }));
    expect(await screen.findByRole('link', { name: 'Open WhatsApp' })).toHaveAttribute(
      'href',
      'https://wa.me/919800000001?text=hi',
    );
    expect(calls['admin-create-user']?.[0]).toMatchObject({
      name: 'Ravi',
      role: 'DEALER_STAFF',
      dealer_id: 1,
      request_id: 5,
    });
    const link = screen.getAllByText('Staff A')[0]!.closest('tr')!;
    await userEvent.click(within(link).getByRole('button', { name: 'Send login link' }));
    await userEvent.click(within(link).getByRole('button', { name: 'Reject' }));
    const addDealer = screen.getByRole('heading', { name: 'Add dealer' }).closest('section')!;
    await userEvent.type(within(addDealer).getByLabelText('Code'), 'DLR-099');
    await userEvent.type(within(addDealer).getByLabelText('Name'), 'New Shop');
    await userEvent.type(within(addDealer).getByLabelText('Mobile'), '9700000099');
    await userEvent.click(within(addDealer).getByRole('button', { name: 'Add dealer' }));
    const addUser = screen
      .getAllByRole('heading', { name: 'Create login' })
      .at(-1)!
      .closest('section')!;
    await userEvent.type(within(addUser).getByLabelText('Name'), 'Owner Z');
    await userEvent.type(within(addUser).getByLabelText('Mobile'), '9700000098');
    await userEvent.click(within(addUser).getByRole('button', { name: 'Create login' }));
    await waitFor(() => {
      expect(calls['admin-create-user']).toHaveLength(2);
    });
    expect(calls['admin-login-link']?.length).toBeGreaterThanOrEqual(2);
  });

  it('dealers: login failures are shown', async () => {
    signIn();
    server.use(
      http.post(`${API}/functions/v1/admin-create-user`, () =>
        HttpResponse.json({ error: 'DUPLICATE_MOBILE' }, { status: 409 }),
      ),
    );
    rest({ dealer: [{ id: 1, code: 'D', name: 'Shop' }], user_request: [], app_user: [] });
    open('DISTRIBUTOR', '/d/dealers');
    const addUser = (await screen.findAllByRole('heading', { name: 'Create login' }))
      .at(-1)!
      .closest('section')!;
    await userEvent.type(within(addUser).getByLabelText('Name'), 'Owner Z');
    await userEvent.type(within(addUser).getByLabelText('Mobile'), '9700000098');
    await userEvent.click(within(addUser).getByRole('button', { name: 'Create login' }));
    expect(await screen.findByRole('heading', { name: 'DUPLICATE_MOBILE' })).toBeInTheDocument();
  });
});

describe('24M', () => {
  it('weekly review: sections listed, review logged', async () => {
    signIn('u', 'aal2');
    rpc({ log_weekly_review: 1 });
    open('M24_ADMIN', '/m');
    expect(await screen.findByLabelText('Notes')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'WhatsApp health' })).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Notes'), 'all good');
    await userEvent.click(screen.getByRole('button', { name: 'Mark weekly review done' }));
  });

  it('maker validates; checker settles; settled claims export', async () => {
    signIn('u', 'aal2');
    rest({
      dist_claim: [
        { id: 3, status: 'SUBMITTED', distributor_id: 1, total_paise: 30000, cn_no: null },
      ],
    });
    const calls: string[] = [];
    rpc({
      dist_claim_detail: {
        claim: { id: 3, status: 'SUBMITTED', distributor: { name: 'Pune' } },
        lines: [{ ...LINES[0], dealer: 'Shop', dealer_cn_no: 'CN-1' }],
      },
      m24_decide: () => (calls.push('decide'), { decided: 1 }),
      m24_validate_claim: () => (calls.push('validate'), { total_paise: 10000 }),
      m24_return_claim: () => (calls.push('return'), null),
    });
    const r = open('M24_ADMIN', '/m/claims');
    expect(await screen.findByRole('link', { name: '#3' })).toHaveAttribute('href', '/m/claim/3');
    r.unmount();
    open('M24_ADMIN', '/m/claim/3');
    await userEvent.click(await screen.findByRole('button', { name: 'Approve all eligible' }));
    const row = screen.getByText('P24-0000001').closest('tr')!;
    await userEvent.type(screen.getAllByLabelText('Reason')[0]!, 'bad');
    await userEvent.click(within(row).getByRole('button', { name: 'Reject' }));
    row.focus();
    await userEvent.keyboard('a');
    await userEvent.click(screen.getByRole('button', { name: 'Validate (maker)' }));
    const ret = screen.getByRole('heading', { name: 'Return to distributor' }).closest('section')!;
    await userEvent.type(within(ret).getByLabelText('Reason'), 'missing CN copies');
    await userEvent.click(within(ret).getByRole('button', { name: 'Return to distributor' }));
    await waitFor(() => {
      expect(calls).toEqual(['decide', 'decide', 'decide', 'validate', 'return']);
    });
  });

  it('checker settles a validated claim; settled export', async () => {
    signIn('u', 'aal2');
    let settled = false;
    rpc({
      dist_claim_detail: () => ({
        claim: { id: 3, status: settled ? 'SETTLED' : 'VALIDATED', distributor: { name: 'Pune' } },
        lines: [],
      }),
      m24_settle: () => ((settled = true), { total_paise: 10000 }),
    });
    server.use(
      http.get(`${API}/rest/v1/rpc/m24_settlement_export`, () =>
        HttpResponse.json([{ serial: 'P24-1', value_paise: 100 }]),
      ),
    );
    const createUrl = vi.fn(() => 'blob:x');
    URL.createObjectURL = createUrl;
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    open('M24_FINANCE', '/m/claim/3');
    const settle = (
      await screen.findByRole('heading', { name: 'Settle with 24M CN (checker)' })
    ).closest('section')!;
    await userEvent.type(within(settle).getByLabelText('CN number'), 'M24-1');
    await userEvent.click(
      within(settle).getByRole('button', { name: 'Settle with 24M CN (checker)' }),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Download CSV' }));
    await waitFor(() => {
      expect(createUrl).toHaveBeenCalled();
    });
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
    expect(await screen.findByText('Coupon not recognised. Do NOT pay.')).toBeInTheDocument();
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

  it('masters: distributors, SKUs, bulk upload dry run and commit, reassignment', async () => {
    signIn('u', 'aal2');
    const calls = captureFunctions();
    const rpcs: string[] = [];
    rest({
      distributor: [{ id: 1, code: 'DIST-PUNE', name: 'Pune' }],
      sku: [{ code: 'PRIMER-1L', name: 'Primer' }],
      dealer: [{ id: 1, code: 'DLR-001', name: 'Shop' }],
    });
    rpc({
      upsert_distributor: () => (rpcs.push('dist'), 1),
      upsert_sku: () => (rpcs.push('sku'), null),
      reassign_dealer: () => (rpcs.push('reassign'), null),
    });
    open('M24_ADMIN', '/m/masters');
    const dist = (await screen.findAllByRole('heading', { name: 'Distributor' }))[0]!.closest(
      'section',
    )!;
    await userEvent.type(within(dist).getByLabelText('Code'), 'DIST-X');
    await userEvent.type(within(dist).getByLabelText('Name'), 'X Paints');
    await userEvent.click(within(dist).getByRole('button', { name: 'Save' }));
    const sku = screen.getByRole('heading', { name: 'SKU' }).closest('section')!;
    await userEvent.type(within(sku).getByLabelText('Code'), 'PRIMER-4L');
    await userEvent.type(within(sku).getByLabelText('Name'), 'Primer 4 L');
    await userEvent.click(within(sku).getByRole('button', { name: 'Save' }));
    const file = new File(['code,name,mobile,city,distributor_code\n'], 'dealers.csv', {
      type: 'text/csv',
    });
    await userEvent.upload(screen.getByLabelText('Upload dealers CSV'), file);
    await userEvent.click(screen.getByRole('button', { name: 'Check file' }));
    await userEvent.click(screen.getByRole('button', { name: 'Import' }));
    expect(await screen.findByText(/"rows": 1/)).toBeInTheDocument();
    const dealers = screen.getByRole('heading', { name: 'Dealers' }).closest('section')!;
    await userEvent.type(within(dealers).getByLabelText('Dealer'), '1');
    await userEvent.type(within(dealers).getByLabelText('Distributor'), '2');
    await userEvent.type(within(dealers).getByLabelText('Reason'), 'territory');
    await userEvent.click(within(dealers).getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(rpcs).toEqual(['dist', 'sku', 'reassign']);
    });
    expect(calls['bulk-upload']).toHaveLength(2);
  });

  it('users: create (any role), links, status changes', async () => {
    signIn('u', 'aal2');
    const calls = captureFunctions();
    rest({
      app_user: [
        { id: 1, name: 'Owner A', role: 'DEALER_OWNER', status: 'ACTIVE' },
        { id: 9, name: 'Finance', role: 'M24_FINANCE', status: 'INACTIVE' },
      ],
    });
    open('M24_ADMIN', '/m/users');
    const owner = (await screen.findByText('Owner A')).closest('tr')!;
    await userEvent.click(within(owner).getByRole('button', { name: 'Send login link' }));
    expect(await screen.findByRole('link', { name: 'Open WhatsApp' })).toBeInTheDocument();
    await userEvent.click(within(owner).getByRole('button', { name: 'Remove' }));
    const fin = screen.getByText('Finance').closest('tr')!;
    expect(within(fin).queryByRole('button', { name: 'Send login link' })).not.toBeInTheDocument();
    await userEvent.click(within(fin).getByRole('button', { name: 'Approve' }));
    await userEvent.selectOptions(screen.getByLabelText('Role'), 'M24_VIEWER');
    await userEvent.type(screen.getByLabelText('Name'), 'Viewer');
    await userEvent.type(screen.getByLabelText('Email'), 'v@24m.in');
    await userEvent.click(screen.getByRole('button', { name: 'Create login' }));
    await waitFor(() => {
      expect(calls['admin-create-user']).toEqual([
        { name: 'Viewer', role: 'M24_VIEWER', email: 'v@24m.in' },
      ]);
    });
    expect(calls['admin-user-status']).toEqual([
      { user_id: 1, status: 'INACTIVE', reason: 'Changed by 24M admin' },
      { user_id: 9, status: 'ACTIVE', reason: 'Changed by 24M admin' },
    ]);
  });

  it('reports: monthly reconciliation and issues', async () => {
    signIn('u', 'aal2');
    rest({
      'rpc/recon_summary': [{ distributor_id: 1, redeemed: 10, settled: 4 }],
      recon_issue: [
        { id: 1, run_date: '2026-10-01', check_name: 'DEALER_CN_TOTAL', ref: 'dealer_claim:1' },
      ],
    });
    open('M24_VIEWER', '/m/reports');
    expect(await screen.findByText('DEALER_CN_TOTAL')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Lots' })).not.toBeInTheDocument();
  });

  it('a 24M query failing for MFA explains why', async () => {
    signIn('u', 'aal2');
    rest({ 'rpc/recon_summary': [] });
    server.use(
      http.get(`${API}/rest/v1/recon_issue`, () =>
        HttpResponse.json({ message: 'MFA_REQUIRED' }, { status: 403 }),
      ),
    );
    open('M24_VIEWER', '/m/reports');
    expect(
      await screen.findByText(
        'Two-step verification is required for 24M access.',
        {},
        { timeout: 5000 },
      ),
    ).toBeInTheDocument();
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
