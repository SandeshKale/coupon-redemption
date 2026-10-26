import { normaliseE164, waShareLink } from '@24m/shared';
import { type ReactNode, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import * as v from 'valibot';

import type { Row } from '../../lib/api/schemas.ts';
import { type Key, useI18n } from '../../lib/i18n/index.ts';
import { useServices } from '../../lib/services.ts';
import {
  Button,
  type Column,
  Dialog,
  ErrorState,
  Field,
  Money,
  painterTone,
  Select,
  Skeleton,
  StatusPill,
} from '../../ui/index.ts';

import { num, str, useAction, useRows, useRpcData } from './data.ts';
import { ActionForm, cols, RowsView, Section, Status } from './parts.tsx';

const REASONS = [
  'NOT_ELIGIBLE',
  'OUT_OF_WINDOW',
  'PAINTER_DISPUTE',
  'SUSPECTED_FRAUD',
  'DUPLICATE',
  'OTHER',
] as const;

export function QueuePage(): ReactNode {
  const { t, dateTime } = useI18n();
  const navigate = useNavigate();
  const q = useRows(
    'dealer_claim?select=id,status,submitted_at,dealer:dealer_id(name,code)&status=eq.SUBMITTED&order=submitted_at.asc',
  );
  const [slip, setSlip] = useState('');
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">{t('nav.queue')}</h1>
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void navigate(`/d/slip/${encodeURIComponent(slip.trim())}`);
        }}
      >
        <Field
          label={t('dist.slipToken')}
          value={slip}
          onChange={(e) => {
            setSlip(e.target.value);
          }}
        />
        <span className="w-40">
          <Button type="submit">{t('dist.scanSlip')}</Button>
        </span>
      </form>
      <RowsView
        query={q}
        caption={t('nav.queue')}
        columns={[
          {
            key: 'id',
            label: t('col.id'),
            render: (r) => (
              <Link
                className="underline"
                to={`/d/claim/${num(r, 'id')}`}
              >{`#${num(r, 'id')}`}</Link>
            ),
          },
          {
            key: 'dealer',
            label: t('col.dealer'),
            value: (r) => str((r['dealer'] ?? {}) as Row, 'name'),
          },
          {
            key: 'submitted_at',
            label: t('col.submitted'),
            value: (r) => dateTime(str(r, 'submitted_at')),
          },
        ]}
      />
    </div>
  );
}

export function SlipRedirect(): ReactNode {
  const { token = '' } = useParams();
  const { t } = useI18n();
  const q = useRpcData(
    'get_claim_by_slip',
    { p_token: token },
    v.object({ kind: v.picklist(['DEALER', 'DIST']), claim_id: v.number() }),
  );
  if (q.isLoading) return <Skeleton />;
  if (q.data === undefined) return <ErrorState message={t('common.forbidden')} />;
  return (
    <Link
      className="underline"
      to={q.data.kind === 'DEALER' ? `/d/claim/${q.data.claim_id}` : `/m/claim/${q.data.claim_id}`}
    >
      {t('dist.claim', { id: q.data.claim_id, dealer: '' })}
    </Link>
  );
}

const Detail = v.object({
  claim: v.record(v.string(), v.unknown()),
  lines: v.array(v.record(v.string(), v.unknown())),
});

type Decide = (couponIds: number[] | null, decision: 'APPROVE' | 'REJECT' | 'HOLD') => void;

function lineColumns(i: ReturnType<typeof useI18n>, decide: Decide): Column<Row>[] {
  return [
    { key: 'serial', label: i.t('col.serial') },
    {
      key: 'value_paise',
      label: i.t('col.value'),
      render: (r) => <Money paise={num(r, 'value_paise')} />,
      value: (r) => num(r, 'value_paise'),
    },
    {
      key: 'redeemed_at',
      label: i.t('col.redeemed'),
      value: (r) => i.dateTime(str(r, 'redeemed_at')),
    },
    {
      key: 'painter_status',
      label: i.t('col.painter'),
      render: (r) => (
        <StatusPill tone={painterTone(str(r, 'painter_status'))}>
          {i.t(`pstatus.${str(r, 'painter_status')}` as Key)} {str(r, 'painter')}
        </StatusPill>
      ),
    },
    {
      key: 'line_status',
      label: i.t('col.status'),
      value: (r) => i.t(`status.${str(r, 'line_status')}` as Key),
    },
    { key: 'failures', label: i.t('col.failures'), value: (r) => failureList(r, i.t) },
    {
      key: 'actions',
      label: i.t('col.actions'),
      render: (r) =>
        ['PENDING', 'HELD'].includes(str(r, 'line_status')) ? (
          <LineActions id={num(r, 'coupon_id')} decide={decide} />
        ) : null,
    },
  ];
}

export function failureList(r: Row, t: (k: Key) => string): string {
  const f = r['failures'];
  return Array.isArray(f) ? f.map((x) => t(`rule.${String(x)}` as Key)).join('; ') : '';
}

export function LineActions({
  id,
  decide,
}: {
  readonly id: number;
  readonly decide: Decide;
}): ReactNode {
  const { t } = useI18n();
  return (
    <span className="flex gap-1">
      <Button
        variant="secondary"
        onClick={() => {
          decide([id], 'APPROVE');
        }}
      >
        {t('dist.approve')}
      </Button>
      <Button
        variant="danger"
        onClick={() => {
          decide([id], 'REJECT');
        }}
      >
        {t('dist.reject')}
      </Button>
      <Button
        variant="ghost"
        onClick={() => {
          decide([id], 'HOLD');
        }}
      >
        {t('dist.hold')}
      </Button>
    </span>
  );
}

/** Distributor claim validation with per-line rule results and painter status (§5.3). */
export function ClaimDetailPage(): ReactNode {
  const { id = '0' } = useParams();
  const claimId = Number(id);
  const i = useI18n();
  const q = useRpcData('dealer_claim_detail', { p_claim_id: claimId }, Detail);
  const act = useAction();
  const [reason, setReason] = useState<string>(REASONS[0]);
  if (q.isLoading) return <Skeleton />;
  if (q.data === undefined) return <ErrorState onRetry={() => void q.refetch()} />;
  const { claim, lines } = q.data;
  const approved = lines.filter((l) => str(l, 'line_status') === 'APPROVED');
  const decide: Decide = (couponIds, decision) => {
    void act.run('dist_decide', {
      p_claim_id: claimId,
      p_coupon_ids: couponIds,
      p_decision: decision,
      p_reason: decision === 'APPROVE' ? null : reason,
    });
  };
  const dealerName = str((claim['dealer'] ?? {}) as Row, 'name');
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">
        {i.t('dist.claim', { id: claimId, dealer: dealerName })}
      </h1>
      <p>
        <StatusPill tone="neutral">{i.t(`status.${str(claim, 'status')}` as Key)}</StatusPill>
      </p>
      <p className="text-sm text-muted">{i.t('dist.shortcuts')}</p>
      <div className="grid gap-2 sm:grid-cols-3">
        <Button
          onClick={() => {
            decide(null, 'APPROVE');
          }}
        >
          {i.t('dist.approveAll')}
        </Button>
        <Select
          label={i.t('dist.selectReason')}
          value={reason}
          onChange={setReason}
          options={REASONS.map((r) => ({ value: r, label: i.t(`reason.${r}`) }))}
        />
      </div>
      <Status message={act.message} error={act.error} />
      <RowsView
        query={{ data: lines, error: null, isLoading: false, refetch: () => q.refetch() }}
        caption={i.t('dist.claim', { id: claimId, dealer: dealerName })}
        onRowKey={(key, row) => {
          if (key === 'a') decide([num(row, 'coupon_id')], 'APPROVE');
          if (key === 'r') decide([num(row, 'coupon_id')], 'REJECT');
        }}
        columns={lineColumns(i, decide)}
      />
      <CloseWithCn
        claimId={claimId}
        status={str(claim, 'status')}
        approvedCount={approved.length}
        total={approved.reduce((s2, l) => s2 + num(l, 'value_paise'), 0)}
      />
    </div>
  );
}

interface Closed {
  readonly total: number;
  readonly mobile: string | null;
  readonly cn: string;
}

/** Close with CN: the dialog shows the exact system-computed total first (§16.5). */
function CloseWithCn({
  claimId,
  status,
  approvedCount,
  total,
}: {
  readonly claimId: number;
  readonly status: string;
  readonly approvedCount: number;
  readonly total: number;
}): ReactNode {
  const i = useI18n();
  const [open, setOpen] = useState(false);
  const [closed, setClosed] = useState<Closed | null>(null);
  return (
    <>
      <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-2 bg-surface py-3">
        <p className="font-semibold">
          {i.t('dist.total', { amount: i.money(total), count: approvedCount })}
        </p>
        <span className="w-56">
          <Button
            onClick={() => {
              setOpen(true);
            }}
            disabledReason={status === 'SUBMITTED' ? null : i.t(`status.${status}` as Key)}
          >
            {i.t('dist.close')}
          </Button>
        </span>
      </div>
      <CloseDialog
        open={open}
        claimId={claimId}
        total={total}
        cnRequired={approvedCount > 0}
        onClose={() => {
          setOpen(false);
        }}
        onClosed={setClosed}
      />
      {closed === null ? null : <NotifyDealer claimId={claimId} closed={closed} />}
    </>
  );
}

function CloseDialog({
  open,
  claimId,
  total,
  cnRequired,
  onClose,
  onClosed,
}: {
  readonly open: boolean;
  readonly claimId: number;
  readonly total: number;
  readonly cnRequired: boolean;
  readonly onClose: () => void;
  readonly onClosed: (c: Closed) => void;
}): ReactNode {
  const i = useI18n();
  const act = useAction();
  const [cn, setCn] = useState('');
  const [cnDate, setCnDate] = useState(() => new Date().toISOString().slice(0, 10));
  return (
    <>
      <Status message={act.message} error={act.error} />
      <Dialog
        open={open}
        title={i.t('dist.confirmClose', { cn: cn === '' ? '…' : cn, amount: i.money(total) })}
        onClose={onClose}
      >
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void act
              .run('dist_close_claim', {
                p_claim_id: claimId,
                p_cn_no: cn === '' ? null : cn,
                p_cn_date: cnDate,
              })
              .then((r) => {
                onClose();
                if (r === null || typeof r !== 'object') return;
                const row = r as Row;
                onClosed({
                  total: num(row, 'total_paise'),
                  mobile: typeof row['dealer_mobile'] === 'string' ? row['dealer_mobile'] : null,
                  cn,
                });
              });
          }}
        >
          <Field
            label={i.t('dist.cnNo')}
            value={cn}
            onChange={(e) => {
              setCn(e.target.value);
            }}
            required={cnRequired}
          />
          <Field
            label={i.t('dist.cnDate')}
            type="date"
            value={cnDate}
            onChange={(e) => {
              setCnDate(e.target.value);
            }}
            required
          />
          <Button type="submit">{i.t('dist.close')}</Button>
        </form>
      </Dialog>
    </>
  );
}

/** One-tap WhatsApp share to the dealer (₹0, §5.3 step 5). */
function NotifyDealer({
  claimId,
  closed,
}: {
  readonly claimId: number;
  readonly closed: Closed;
}): ReactNode {
  const i = useI18n();
  return (
    <Section title={i.t('dist.closed', { amount: i.money(closed.total) })}>
      {closed.mobile === null ? null : (
        <a
          className="flex min-h-12 items-center justify-center rounded-btn bg-success font-semibold text-white"
          href={waShareLink(
            closed.mobile,
            i.t('dist.notifyText', { id: claimId, cn: closed.cn, amount: i.money(closed.total) }),
          )}
          target="_blank"
          rel="noreferrer"
        >
          {i.t('dist.notify')}
        </a>
      )}
    </Section>
  );
}

export function ClaimTo24mPage(): ReactNode {
  const i = useI18n();
  const act = useAction();
  const todo = useRpcData('distributor_todo', {}, v.record(v.string(), v.number()));
  const q = useRows(
    'dist_claim?select=id,status,created_at,total_paise,cn_no,slip_token&order=id.desc&limit=50',
  );
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">{i.t('nav.claimTo24m')}</h1>
      <Button
        onClick={() => void act.run('create_dist_claim', {})}
        loading={act.pending}
        disabledReason={
          (todo.data?.['cn_ready_to_claim'] ?? 0) === 0 ? i.t('dist.nothingToClaim') : null
        }
      >
        {i.t('dist.createClaim')}
      </Button>
      <Status message={act.message} error={act.error} />
      <RowsView
        query={q}
        caption={i.t('nav.claimTo24m')}
        csvName="claims-to-24m"
        columns={[
          ...cols(i.t, ['id', 'status']),
          {
            key: 'total_paise',
            label: i.t('col.total'),
            render: (r) => <Money paise={num(r, 'total_paise')} />,
            value: (r) => num(r, 'total_paise'),
          },
          {
            key: 'created_at',
            label: i.t('col.created'),
            value: (r) => i.dateTime(str(r, 'created_at')),
          },
          { key: 'cn_no', label: i.t('col.cn') },
          { key: 'slip_token', label: i.t('dist.slipToken') },
        ]}
      />
    </div>
  );
}

/** Login creation + one-time link sharing on WhatsApp (₹0, §10.1). */
function useLogins(onChange: () => void): {
  link: { url: string | null; message: string } | null;
  sendLink: (userId: number) => Promise<void>;
  createUser: (vals: Record<string, string>, requestId: number | null) => Promise<void>;
} {
  const i = useI18n();
  const { callFunction } = useServices();
  const [link, setLink] = useState<{ url: string | null; message: string } | null>(null);
  const post = async (fn: string, body: unknown): Promise<{ ok: boolean; body: Row }> => {
    const r = await callFunction(fn, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { ok: r.ok, body: (await r.json().catch(() => ({}))) as Row };
  };
  const errorOf = (b: Row): string =>
    typeof b['error'] === 'string' ? b['error'] : i.t('common.error');
  const sendLink = async (userId: number): Promise<void> => {
    const r = await post('admin-login-link', { user_id: userId });
    setLink(
      r.ok
        ? {
            url: typeof r.body['whatsapp_url'] === 'string' ? r.body['whatsapp_url'] : null,
            message: i.t('common.done'),
          }
        : { url: null, message: errorOf(r.body) },
    );
  };
  const createUser = async (
    vals: Record<string, string>,
    requestId: number | null,
  ): Promise<void> => {
    const mobile = normaliseE164(vals['mobile'] ?? '');
    const r = await post('admin-create-user', {
      name: vals['name'],
      mobile: mobile ?? vals['mobile'],
      role: vals['role'],
      dealer_id: Number(vals['dealer_id']),
      ...(requestId === null ? {} : { request_id: requestId }),
    });
    if (r.ok && typeof r.body['user_id'] === 'number') await sendLink(r.body['user_id']);
    else setLink({ url: null, message: errorOf(r.body) });
    onChange();
  };
  return { link, sendLink, createUser };
}

/** Dealers, login creation/links (D5) and pending requests. */
export function DealersPage({
  distributorId,
}: {
  readonly distributorId: number | null;
}): ReactNode {
  const i = useI18n();
  const dealers = useRows('dealer?select=id,code,name,mobile_e164,city,status&order=name');
  const users = useRows(
    'app_user?select=id,name,mobile_e164,role,status,dealer_id&role=in.(DEALER_OWNER,DEALER_STAFF)&order=name',
  );
  const requests = useRows(
    'user_request?select=id,kind,name,mobile_e164,dealer_id,target_user_id,status,created_at&status=eq.PENDING&order=created_at',
  );
  const logins = useLogins(() => {
    void users.refetch();
    void requests.refetch();
  });
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">{i.t('nav.dealers')}</h1>
      {logins.link === null ? null : (
        <Section title={logins.link.message}>
          {logins.link.url === null ? null : (
            <a
              className="flex min-h-12 items-center justify-center rounded-btn bg-success font-semibold text-white"
              href={logins.link.url}
              target="_blank"
              rel="noreferrer"
            >
              {i.t('dist.openWhatsApp')}
            </a>
          )}
        </Section>
      )}
      <RequestsSection query={requests} logins={logins} />
      <Section title={i.t('nav.dealers')}>
        <RowsView
          query={dealers}
          caption={i.t('nav.dealers')}
          csvName="dealers"
          columns={cols(i.t, ['code', 'name', 'mobile_e164', 'city', 'status'])}
        />
      </Section>
      <Section title={i.t('nav.users')}>
        <RowsView
          query={users}
          caption={i.t('nav.users')}
          columns={[
            ...cols(i.t, ['name', 'role', 'status']),
            {
              key: 'actions',
              label: i.t('col.actions'),
              render: (r) =>
                str(r, 'status') === 'ACTIVE' ? (
                  <Button variant="secondary" onClick={() => void logins.sendLink(num(r, 'id'))}>
                    {i.t('dist.sendLink')}
                  </Button>
                ) : null,
            },
          ]}
        />
      </Section>
      {distributorId === null ? null : <AddDealer distributorId={distributorId} />}
      <AddLogin dealers={dealers.data ?? []} createUser={logins.createUser} />
    </div>
  );
}

function RequestsSection({
  query,
  logins,
}: {
  readonly query: ReturnType<typeof useRows>;
  readonly logins: ReturnType<typeof useLogins>;
}): ReactNode {
  const i = useI18n();
  const act = useAction();
  return (
    <Section title={i.t('dist.requests')}>
      <RowsView
        query={query}
        caption={i.t('dist.requests')}
        columns={[
          ...cols(i.t, ['kind', 'name', 'mobile_e164']),
          {
            key: 'actions',
            label: i.t('col.actions'),
            render: (r) => (
              <span className="flex gap-1">
                <Button
                  onClick={() => {
                    if (str(r, 'kind') === 'LOGIN_LINK')
                      void logins.sendLink(num(r, 'target_user_id'));
                    else
                      void logins.createUser(
                        {
                          name: str(r, 'name'),
                          mobile: str(r, 'mobile_e164'),
                          role: 'DEALER_STAFF',
                          dealer_id: str(r, 'dealer_id'),
                        },
                        num(r, 'id'),
                      );
                  }}
                >
                  {str(r, 'kind') === 'LOGIN_LINK' ? i.t('dist.sendLink') : i.t('dist.addUser')}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() =>
                    void act.run('reject_user_request', { p_request_id: num(r, 'id') })
                  }
                >
                  {i.t('dist.reject')}
                </Button>
              </span>
            ),
          },
        ]}
      />
      <Status message={act.message} error={act.error} />
    </Section>
  );
}

function AddDealer({ distributorId }: { readonly distributorId: number }): ReactNode {
  const i = useI18n();
  const act = useAction();
  return (
    <Section title={i.t('dist.addDealer')}>
      <ActionForm
        submitLabel={i.t('dist.addDealer')}
        pending={act.pending}
        fields={[
          { name: 'code', label: 'col.code' },
          { name: 'name', label: 'col.name' },
          { name: 'mobile', label: 'col.mobile', type: 'tel' },
          { name: 'city', label: 'col.city', required: false },
        ]}
        onSubmit={(vals) =>
          act.run('upsert_dealer', {
            p_code: vals['code'],
            p_name: vals['name'],
            p_mobile: normaliseE164(vals['mobile'] ?? '') ?? vals['mobile'],
            p_city: vals['city'] ?? null,
            p_distributor_id: distributorId,
          })
        }
      />
      <Status message={act.message} error={act.error} />
    </Section>
  );
}

function AddLogin({
  dealers,
  createUser,
}: {
  readonly dealers: readonly Row[];
  readonly createUser: (vals: Record<string, string>, requestId: number | null) => Promise<void>;
}): ReactNode {
  const i = useI18n();
  const options = dealers.map((d) => ({
    value: String(num(d, 'id')),
    label: `${str(d, 'code')} · ${str(d, 'name')}`,
  }));
  return (
    <Section title={i.t('dist.addUser')}>
      <ActionForm
        submitLabel={i.t('dist.addUser')}
        fields={[
          { name: 'dealer_id', label: 'col.dealer', options },
          { name: 'name', label: 'col.name' },
          { name: 'mobile', label: 'col.mobile', type: 'tel' },
          {
            name: 'role',
            label: 'col.role',
            options: [
              { value: 'DEALER_OWNER', label: 'DEALER_OWNER' },
              { value: 'DEALER_STAFF', label: 'DEALER_STAFF' },
            ],
          },
        ]}
        onSubmit={(vals) => createUser(vals, null)}
      />
    </Section>
  );
}
