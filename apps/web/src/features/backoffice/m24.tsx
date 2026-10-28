import { normaliseE164, rupeesToPaise } from '@24m/shared';
import { type ReactNode, useState } from 'react';
import * as v from 'valibot';

import { CouponStats, JsonArray, type Row } from '../../lib/api/schemas.ts';
import { type Key, useI18n } from '../../lib/i18n/index.ts';
import { useServices } from '../../lib/services.ts';
import {
  Button,
  downloadBlob,
  ErrorState,
  Field,
  Money,
  Select,
  Skeleton,
  StatusPill,
} from '../../ui/index.ts';

import {
  failureText,
  num,
  staticQuery,
  str,
  useAction,
  useAdminCall,
  useRows,
  useRpcData,
} from './data.ts';
import { GST_PATTERN, newDealerBody, PinReset } from './distributor.tsx';
import { ActionForm, cols, intOrNull, nullIfEmpty, RowsView, Section, Status } from './parts.tsx';
import { HelplineSection, MobileChange, RedeemOne } from './redeem.tsx';

interface LotOption {
  readonly value: string;
  readonly label: string;
}

/** Lots: create → generate in batches → export print file → void spoiled → activate / block (§5.1). */
export function LotsPage(): ReactNode {
  const i = useI18n();
  const act = useAction();
  const lots = useRows(
    'coupon_lot?select=id,lot_no,quantity,value_paise,intended_sku,serial_prefix,serial_from,serial_to,status,generated_count,export_count&order=id.desc',
  );
  const [progress, setProgress] = useState<string | null>(null);
  const generate = async (id: number, total: number): Promise<void> => {
    for (;;) {
      const r = (await act.run('generate_lot_codes', { p_lot_id: id, p_max: 50000 })) as Row | null;
      if (r === null) return;
      setProgress(i.t('m24.generating', { done: num(r, 'generated'), total }));
      if (r['done'] === true) return;
    }
  };
  const lotOptions: LotOption[] = (lots.data ?? []).map((l) => ({
    value: String(num(l, 'id')),
    label: `${str(l, 'lot_no')} (${str(l, 'serial_prefix')} ${str(l, 'serial_from')}–${str(l, 'serial_to')})`,
  }));
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">{i.t('nav.lots')}</h1>
      <Status message={progress ?? act.message} error={act.error} />
      <RowsView
        query={lots}
        caption={i.t('nav.lots')}
        columns={[
          ...cols(i.t, ['lot_no', 'quantity', 'status', 'generated_count', 'export_count']),
          {
            key: 'actions',
            label: i.t('col.actions'),
            render: (r) =>
              str(r, 'status') === 'GENERATING' ? (
                <Button onClick={() => generate(num(r, 'id'), num(r, 'quantity'))}>
                  {i.t('m24.generate')}
                </Button>
              ) : null,
          },
        ]}
      />
      <CreateLot onCreated={(id, total) => generate(id, total)} run={act.run} />
      <ExportLot lots={lotOptions} onDone={() => void lots.refetch()} onMessage={setProgress} />
      <LotRangeActions lots={lotOptions} run={act.run} />
    </div>
  );
}

type Run = ReturnType<typeof useAction>['run'];

function CreateLot({
  run,
  onCreated,
}: {
  readonly run: Run;
  readonly onCreated: (id: number, total: number) => Promise<void>;
}): ReactNode {
  const i = useI18n();
  return (
    <Section title={i.t('m24.createLot')}>
      <ActionForm
        submitLabel={i.t('m24.createLot')}
        fields={[
          { name: 'lot_no', label: 'm24.lotNo' },
          { name: 'quantity', label: 'm24.quantity', type: 'number' },
          { name: 'value', label: 'm24.value', type: 'number', initial: '100' },
          { name: 'sku', label: 'm24.sku' },
          { name: 'prefix', label: 'm24.prefix', initial: 'P24' },
        ]}
        onSubmit={async (vals) => {
          const r = (await run('create_lot', {
            p_lot_no: vals['lot_no'],
            p_quantity: intOrNull(vals['quantity']),
            p_value_paise: rupeesToPaise(Number(vals['value'])),
            p_sku: vals['sku'],
            p_serial_prefix: vals['prefix'],
          })) as Row | null;
          if (r !== null) await onCreated(num(r, 'lot_id'), intOrNull(vals['quantity']) ?? 0);
        }}
      />
    </Section>
  );
}

function ExportLot({
  lots,
  onDone,
  onMessage,
}: {
  readonly lots: readonly LotOption[];
  readonly onDone: () => void;
  readonly onMessage: (m: string) => void;
}): ReactNode {
  const i = useI18n();
  const { callFunction } = useServices();
  return (
    <Section title={i.t('m24.export')}>
      <ActionForm
        submitLabel={i.t('m24.export')}
        fields={[
          { name: 'lot_id', label: 'col.lot', options: lots },
          { name: 'reason', label: 'm24.exportReason', required: false },
        ]}
        onSubmit={async (vals) => {
          const reason = nullIfEmpty(vals['reason']);
          const res = await callFunction('export-print-file', {
            method: 'GET',
            query: `?lot_id=${vals['lot_id'] ?? ''}${reason === null ? '' : `&reason=${encodeURIComponent(reason)}`}`,
          });
          if (!res.ok) {
            const body = (await res.json().catch(() => ({}))) as Row;
            onMessage(typeof body['error'] === 'string' ? body['error'] : i.t('common.error'));
            return;
          }
          downloadBlob(`lot-${vals['lot_id'] ?? ''}.csv`, await res.blob());
          onDone();
        }}
      />
    </Section>
  );
}

function LotRangeActions({
  lots,
  run,
}: {
  readonly lots: readonly LotOption[];
  readonly run: Run;
}): ReactNode {
  const i = useI18n();
  const [lotId, setLotId] = useState('');
  const selected = Number(lotId === '' ? (lots[0]?.value ?? '0') : lotId);
  return (
    <>
      <Section title={i.t('m24.void')}>
        <ActionForm
          submitLabel={i.t('m24.void')}
          fields={[
            { name: 'lot_id', label: 'col.lot', options: lots },
            { name: 'serials', label: 'm24.voidHelp', type: 'textarea' },
            { name: 'reason', label: 'common.reason' },
          ]}
          onSubmit={(vals) =>
            run('void_serials', {
              p_lot_id: Number(vals['lot_id']),
              p_serials: (vals['serials'] ?? '').split(/\s+/).filter((x) => x !== ''),
              p_reason: vals['reason'],
            })
          }
        />
      </Section>
      <Section title={i.t('m24.activate')}>
        <Select
          label={i.t('col.lot')}
          options={lots}
          value={String(selected)}
          onChange={setLotId}
        />
        <ActionForm
          submitLabel={i.t('m24.activate')}
          fields={[
            { name: 'from', label: 'm24.from', type: 'number' },
            { name: 'to', label: 'm24.to', type: 'number' },
            { name: 'sku', label: 'm24.sku' },
            { name: 'batch', label: 'm24.batchNo' },
            { name: 'mfg', label: 'm24.mfgDate', type: 'date' },
          ]}
          onSubmit={(vals) =>
            run('activate_range', {
              p_lot_id: selected,
              p_serial_from: intOrNull(vals['from']),
              p_serial_to: intOrNull(vals['to']),
              p_sku: vals['sku'],
              p_batch_no: vals['batch'],
              p_mfg_date: vals['mfg'],
            })
          }
        />
      </Section>
      <Section title={i.t('m24.block')}>
        <ActionForm
          submitLabel={i.t('m24.block')}
          fields={[
            { name: 'from', label: 'm24.from', type: 'number' },
            { name: 'to', label: 'm24.to', type: 'number' },
            { name: 'reason', label: 'common.reason' },
          ]}
          onSubmit={(vals) =>
            run('block_range', {
              p_lot_id: selected,
              p_serial_from: intOrNull(vals['from']),
              p_serial_to: intOrNull(vals['to']),
              p_reason: vals['reason'],
            })
          }
        />
      </Section>
    </>
  );
}

/** Masters: distributors, sales reps, dealers and SKUs. */
export function MastersPage(): ReactNode {
  const i = useI18n();
  const dists = useRows('distributor?select=id,code,name,mobile_e164,city,status&order=code');
  const options = (dists.data ?? []).map((d) => ({
    value: String(num(d, 'id')),
    label: `${str(d, 'code')} · ${str(d, 'name')}`,
  }));
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">{i.t('nav.masters')}</h1>
      <DistributorsSection query={dists} />
      <AddRepSection options={options} />
      <AddDealerSection options={options} />
      <SkusSection />
      <HelplineSection />
      <DealersMaster />
    </div>
  );
}

type Call = (fn: string, body: unknown, success?: string) => Promise<Row | null>;

/** Add a distributor (name, code, registered mobile) and the PIN login for that mobile number. */
function DistributorsSection({ query }: { readonly query: ReturnType<typeof useRows> }): ReactNode {
  const i = useI18n();
  const act = useAction();
  const admin = useAdminCall(() => void query.refetch());
  return (
    <Section title={i.t('m24.addDistributor')}>
      <RowsView
        query={query}
        caption={i.t('col.distributor')}
        csvName="distributors"
        columns={cols(i.t, ['code', 'name', 'mobile_e164', 'status'])}
      />
      <ActionForm
        submitLabel={i.t('m24.addDistributor')}
        pending={act.pending}
        fields={[
          { name: 'name', label: 'm24.distName' },
          { name: 'code', label: 'm24.distCode', pattern: '[A-Za-z0-9/\\-]{2,20}' },
          { name: 'mobile', label: 'm24.distMobile', type: 'tel' },
          { name: 'pin', label: 'col.pin', type: 'pin' },
        ]}
        onSubmit={async (vals) => {
          const mobile = normaliseE164(vals['mobile'] ?? '');
          if (mobile === null) return;
          const id = await act.run('upsert_distributor', {
            p_code: vals['code'],
            p_name: vals['name'],
            p_mobile: mobile,
            p_city: null,
          });
          if (typeof id !== 'number') return;
          await admin.call(
            'admin-create-user',
            {
              name: vals['name'],
              mobile,
              role: 'DISTRIBUTOR',
              distributor_id: id,
              pin: vals['pin'],
            },
            i.t('m24.distributorAdded'),
          );
        }}
      />
      <Status
        message={admin.message ?? act.message}
        error={admin.message === null ? act.error : admin.error}
      />
    </Section>
  );
}

/** A sales rep logs in with their own mobile number and PIN and can only add dealers. */
function AddRepSection({ options }: { readonly options: readonly LotOption[] }): ReactNode {
  const i = useI18n();
  const admin = useAdminCall(() => undefined);
  return (
    <Section title={i.t('m24.addRep')}>
      <ActionForm
        submitLabel={i.t('m24.addRep')}
        fields={[
          { name: 'dist', label: 'col.distributor', options },
          { name: 'name', label: 'm24.repName' },
          { name: 'mobile', label: 'm24.repMobile', type: 'tel' },
          { name: 'pin', label: 'col.pin', type: 'pin' },
        ]}
        onSubmit={(vals) =>
          admin.call(
            'admin-create-user',
            {
              name: vals['name'],
              mobile: normaliseE164(vals['mobile'] ?? '') ?? vals['mobile'],
              role: 'DISTRIBUTOR',
              distributor_id: intOrNull(vals['dist']),
              is_rep: true,
              pin: vals['pin'],
            },
            i.t('m24.repAdded'),
          )
        }
      />
      <Status message={admin.message} error={admin.error} />
    </Section>
  );
}

/** 24M can add a dealer under any distributor. */
function AddDealerSection({ options }: { readonly options: readonly LotOption[] }): ReactNode {
  const i = useI18n();
  const admin = useAdminCall(() => undefined);
  return (
    <Section title={i.t('m24.addDealer')}>
      <ActionForm
        submitLabel={i.t('m24.addDealer')}
        fields={[
          { name: 'dist', label: 'col.distributor', options },
          { name: 'name', label: 'dist.dealerName' },
          { name: 'gst', label: 'dist.gst', required: false, pattern: GST_PATTERN },
          { name: 'mobile', label: 'dist.whatsapp', type: 'tel' },
          { name: 'pin', label: 'col.pin', type: 'pin' },
        ]}
        onSubmit={(vals) =>
          admin.call(
            'admin-create-user',
            newDealerBody(vals, intOrNull(vals['dist']) ?? 0),
            i.t('dist.created'),
          )
        }
      />
      <Status message={admin.message} error={admin.error} />
    </Section>
  );
}

function SkusSection(): ReactNode {
  const i = useI18n();
  const act = useAction();
  const skus = useRows('sku?select=code,name,active&order=code');
  return (
    <Section title={i.t('m24.sku')}>
      <RowsView query={skus} caption={i.t('m24.sku')} columns={cols(i.t, ['code', 'name'])} />
      <ActionForm
        submitLabel={i.t('common.save')}
        fields={[
          { name: 'code', label: 'col.code' },
          { name: 'name', label: 'col.name' },
        ]}
        onSubmit={(vals) => act.run('upsert_sku', { p_code: vals['code'], p_name: vals['name'] })}
      />
      <Status message={act.message} error={act.error} />
    </Section>
  );
}

function DealersMaster(): ReactNode {
  const i = useI18n();
  const act = useAction();
  const dealers = useRpcData('list_dealers', { p_distributor_id: null }, JsonArray);
  return (
    <Section title={i.t('nav.dealers')}>
      <RowsView
        query={dealers}
        caption={i.t('nav.dealers')}
        csvName="dealers"
        columns={cols(i.t, ['name', 'gst', 'mobile_e164', 'distributor', 'validated'])}
      />
      <ActionForm
        submitLabel={i.t('common.save')}
        fields={[
          { name: 'dealer', label: 'col.dealer', type: 'number' },
          { name: 'dist', label: 'col.distributor', type: 'number' },
          { name: 'reason', label: 'common.reason' },
        ]}
        onSubmit={(vals) =>
          act.run('reassign_dealer', {
            p_dealer_id: intOrNull(vals['dealer']),
            p_distributor_id: intOrNull(vals['dist']),
            p_reason: vals['reason'],
          })
        }
      />
      <Status message={act.message} error={act.error} />
    </Section>
  );
}

const STAFF_ROLES = ['M24_ADMIN', 'M24_FINANCE', 'M24_VIEWER'] as const;

export function UsersPage(): ReactNode {
  const i = useI18n();
  const users = useRows(
    'app_user?select=id,name,mobile_e164,email,role,is_sales_rep,dealer_id,distributor_id,status&order=id',
  );
  const admin = useAdminCall(() => void users.refetch());
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">{i.t('nav.users')}</h1>
      <Status message={admin.message} error={admin.error} />
      <RowsView
        query={users}
        caption={i.t('nav.users')}
        csvName="users"
        columns={[
          ...cols(i.t, ['id', 'name', 'mobile_e164', 'role', 'is_sales_rep', 'status']),
          {
            key: 'actions',
            label: i.t('col.actions'),
            render: (r) => <UserActions row={r} call={admin.call} />,
          },
        ]}
      />
      <Section title={i.t('m24.addStaff')}>
        <ActionForm
          submitLabel={i.t('m24.addStaff')}
          fields={[
            {
              name: 'role',
              label: 'col.role',
              options: STAFF_ROLES.map((r) => ({ value: r, label: r })),
            },
            { name: 'name', label: 'col.name' },
            { name: 'email', label: 'login.email', type: 'email' },
          ]}
          onSubmit={(vals) =>
            admin.call('admin-create-user', {
              name: vals['name'],
              role: vals['role'],
              email: vals['email'],
            })
          }
        />
      </Section>
    </div>
  );
}

function UserActions({ row, call }: { readonly row: Row; readonly call: Call }): ReactNode {
  const i = useI18n();
  const active = str(row, 'status') === 'ACTIVE';
  return (
    <span className="flex flex-wrap items-end gap-2">
      <MobileChange userId={num(row, 'id')} />
      {str(row, 'role') === 'DISTRIBUTOR' ? <PinReset userId={num(row, 'id')} /> : null}
      <Button
        variant={active ? 'danger' : 'secondary'}
        onClick={() =>
          call('admin-user-status', {
            user_id: num(row, 'id'),
            status: active ? 'INACTIVE' : 'ACTIVE',
            reason: 'Changed by 24M admin',
          })
        }
      >
        {active ? i.t('dist.switchOff') : i.t('dist.switchOn')}
      </Button>
    </span>
  );
}

const TILE = 'min-w-0 rounded-card bg-surface-2 p-4 break-words';

/** The live picture for 24M: where every coupon is, and who is validating. */
export function DashboardPage(): ReactNode {
  const i = useI18n();
  const q = useRpcData('coupon_stats', {}, CouponStats);
  if (q.isLoading) return <Skeleton />;
  if (q.error !== null || q.data === undefined) {
    return (
      <ErrorState
        {...(q.error === null ? {} : { message: failureText(q.error.failure, i.t) })}
        onRetry={() => {
          void q.refetch();
        }}
      />
    );
  }
  const d = q.data;
  const tiles: [Key, number][] = [
    ['stats.all', d.totals.all],
    ['stats.active', d.totals.active],
    ['stats.validated', d.totals.validated],
    ['stats.validatedOpen', d.totals.validated_open],
    ['stats.redeemed', d.totals.redeemed],
    ['stats.today', d.totals.validated_today],
    ['stats.week', d.totals.validated_7d],
    ['stats.month', d.totals.validated_30d],
  ];
  const table = (rows: readonly object[], keys: readonly string[], title: Key): ReactNode => (
    <Section title={i.t(title)}>
      <RowsView
        query={staticQuery(rows as Row[])}
        caption={i.t(title)}
        csvName={title}
        columns={cols(i.t, keys)}
      />
    </Section>
  );
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">{i.t('nav.dashboard')}</h1>
      <section className="grid grid-cols-[repeat(auto-fit,minmax(10rem,1fr))] gap-3">
        {tiles.map(([key, n]) => (
          <div key={key} className={TILE}>
            <h2 className="text-muted">{i.t(key)}</h2>
            <p className="text-3xl font-bold">{n}</p>
          </div>
        ))}
      </section>
      <p className="text-sm text-muted">
        {i.t('common.lastUpdated', { time: i.dateTime(d.as_of) })}
      </p>
      {table(
        d.by_lot,
        ['lot_no', 'quantity', 'not_active', 'active', 'validated', 'redeemed'],
        'stats.byLot',
      )}
      {table(d.by_distributor, ['code', 'name', 'dealers', 'validated'], 'stats.byDistributor')}
      {table(d.top_dealers, ['dealer', 'distributor', 'validated'], 'stats.topDealers')}
      {table(
        d.recent.map((r) => ({ ...r, at: i.dateTime(r.at) })),
        ['serial', 'dealer', 'at'],
        'stats.recent',
      )}
    </div>
  );
}

export function LookupPage({ role }: { readonly role: string }): ReactNode {
  const i = useI18n();
  const { api } = useServices();
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<Row | null>(null);
  const search = async (): Promise<void> => {
    const r = await api.rpc('lookup_coupon', { p_query: query }, v.record(v.string(), v.unknown()));
    setResult(r.ok ? r.data : null);
  };
  const coupon = result?.['coupon'];
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">{i.t('nav.lookup')}</h1>
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
      >
        <Field
          label={i.t('m24.lookupHelp')}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
          }}
        />
        <span className="w-32">
          <Button type="submit">{i.t('common.search')}</Button>
        </span>
      </form>
      {result?.['found'] === false ? <ErrorState message={i.t('result.not_found')} /> : null}
      {result !== null && typeof coupon === 'object' && coupon !== null ? (
        <CouponCard
          result={result}
          coupon={coupon as Row}
          admin={role === 'M24_ADMIN'}
          canRedeem={role === 'M24_ADMIN' || role === 'M24_FINANCE'}
        />
      ) : null}
    </div>
  );
}

function CouponCard({
  result,
  coupon,
  admin,
  canRedeem,
}: {
  readonly result: Row;
  readonly coupon: Row;
  readonly admin: boolean;
  readonly canRedeem: boolean;
}): ReactNode {
  const i = useI18n();
  const events = Array.isArray(result['events']) ? (result['events'] as Row[]) : [];
  return (
    <Section title={str(coupon, 'serial')}>
      <p>
        <StatusPill tone="neutral">{str(coupon, 'status')}</StatusPill>{' '}
        <Money paise={num(coupon, 'value_paise')} />
      </p>
      <p>{str((result['dealer'] ?? {}) as Row, 'name')}</p>
      <RowsView
        query={{ data: events, error: null, isLoading: false, refetch: () => undefined }}
        caption={i.t('nav.lookup')}
        columns={cols(i.t, ['event', 'from', 'to', 'by', 'ref', 'at'])}
      />
      {canRedeem && ['ACTIVE', 'VALIDATED'].includes(str(coupon, 'status')) ? (
        <RedeemOne serial={str(coupon, 'serial')} />
      ) : null}
      {admin ? <AdminCouponActions couponId={num(coupon, 'id')} /> : null}
    </Section>
  );
}

function AdminCouponActions({ couponId }: { readonly couponId: number }): ReactNode {
  const i = useI18n();
  const act = useAction();
  return (
    <>
      <ActionForm
        submitLabel={i.t('m24.hold')}
        fields={[{ name: 'reason', label: 'common.reason' }]}
        onSubmit={(vals) =>
          act.run('hold_coupons', { p_coupon_ids: [couponId], p_reason: vals['reason'] })
        }
      />
      <ActionForm
        submitLabel={i.t('m24.release')}
        fields={[{ name: 'note', label: 'common.notes' }]}
        onSubmit={(vals) =>
          act.run('release_coupons', { p_coupon_ids: [couponId], p_note: vals['note'] })
        }
      />
      <ActionForm
        submitLabel={i.t('m24.reverse')}
        fields={[{ name: 'reason', label: 'common.reason' }]}
        onSubmit={(vals) =>
          act.run('reverse_redemption', { p_coupon_id: couponId, p_reason: vals['reason'] })
        }
      />
      <Status message={act.message} error={act.error} />
    </>
  );
}

const REVIEW: readonly { title: Key; path: string; cols: readonly string[]; csv?: string }[] = [
  {
    title: 'col.attempts',
    path: 'v_invalid_scans?select=user_id,user_name,dealer_id,result,attempts,last_at&order=attempts.desc',
    cols: ['user_name', 'dealer_id', 'result', 'attempts'],
  },
  {
    title: 'result.already_other',
    path: 'v_duplicate_attempts?select=coupon_id,serial,redeemed_dealer_id,attempted_by_dealer,at&order=at.desc',
    cols: ['serial', 'redeemed_dealer_id', 'attempted_by_dealer', 'at'],
  },
  {
    title: 'col.unusual',
    path: 'v_dealer_velocity?select=dealer_id,dealer_name,week,coupons,usual_weekly,unusual&unusual=is.true',
    cols: ['dealer_name', 'week', 'coupons', 'usual_weekly'],
  },
];

function ReviewTable({
  title,
  path,
  columns,
  csv,
}: {
  readonly title: Key;
  readonly path: string;
  readonly columns: readonly string[];
  readonly csv?: string | undefined;
}): ReactNode {
  const i = useI18n();
  const q = useRows(path);
  return (
    <Section title={i.t(title)}>
      <RowsView
        query={q}
        caption={i.t(title)}
        columns={cols(i.t, columns)}
        {...(csv === undefined ? {} : { csvName: csv })}
      />
    </Section>
  );
}

/** Weekly review (§22): disputes first, then flags and health; logged with date and reviewer. */
export function ReviewPage({ role }: { readonly role: string }): ReactNode {
  const i = useI18n();
  const act = useAction();
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">{i.t('nav.review')}</h1>
      {REVIEW.map((r) => (
        <ReviewTable key={r.path} title={r.title} path={r.path} columns={r.cols} csv={r.csv} />
      ))}
      {role === 'M24_ADMIN' ? (
        <ActionForm
          submitLabel={i.t('m24.logReview')}
          fields={[{ name: 'notes', label: 'common.notes', type: 'textarea' }]}
          onSubmit={(vals) => act.run('log_weekly_review', { p_notes: vals['notes'] })}
        />
      ) : null}
      <Status message={act.message} error={act.error} />
    </div>
  );
}
