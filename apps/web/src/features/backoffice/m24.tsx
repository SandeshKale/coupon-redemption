import { normaliseE164, rupeesToPaise } from '@24m/shared';
import { type ReactNode, useState } from 'react';
import { Link, useParams } from 'react-router';
import * as v from 'valibot';

import type { Row } from '../../lib/api/schemas.ts';
import { type Key, useI18n } from '../../lib/i18n/index.ts';
import { useServices } from '../../lib/services.ts';
import {
  Button,
  type Column,
  downloadBlob,
  ErrorState,
  Field,
  Money,
  painterTone,
  Select,
  Skeleton,
  StatusPill,
  toCsv,
} from '../../ui/index.ts';

import { num, str, useAction, useRows, useRpcData } from './data.ts';
import { failureList, LineActions } from './distributor.tsx';
import { ActionForm, cols, intOrNull, nullIfEmpty, RowsView, Section, Status } from './parts.tsx';

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
                <Button onClick={() => void generate(num(r, 'id'), num(r, 'quantity'))}>
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

/** Masters: distributors, SKUs, bulk dealer upload (dry run first), reassignment. */
export function MastersPage(): ReactNode {
  const i = useI18n();
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">{i.t('nav.masters')}</h1>
      <DistributorsSection />
      <SkusSection />
      <UploadSection />
      <DealersMaster />
    </div>
  );
}

function DistributorsSection(): ReactNode {
  const i = useI18n();
  const act = useAction();
  const dists = useRows('distributor?select=id,code,name,mobile_e164,city,status&order=code');
  return (
    <Section title={i.t('col.distributor')}>
      <RowsView
        query={dists}
        caption={i.t('col.distributor')}
        csvName="distributors"
        columns={cols(i.t, ['code', 'name', 'mobile_e164', 'city', 'status'])}
      />
      <ActionForm
        submitLabel={i.t('common.save')}
        fields={[
          { name: 'code', label: 'col.code' },
          { name: 'name', label: 'col.name' },
          { name: 'mobile', label: 'col.mobile', type: 'tel', required: false },
          { name: 'city', label: 'col.city', required: false },
        ]}
        onSubmit={(vals) =>
          act.run('upsert_distributor', {
            p_code: vals['code'],
            p_name: vals['name'],
            p_mobile: normaliseE164(vals['mobile'] ?? ''),
            p_city: nullIfEmpty(vals['city']),
          })
        }
      />
      <Status message={act.message} error={act.error} />
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

/** EC-130: dry run first; commit only a clean file, in one transaction. */
function UploadSection(): ReactNode {
  const i = useI18n();
  const { callFunction } = useServices();
  const [report, setReport] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const upload = async (dryRun: boolean): Promise<void> => {
    if (file === null) return;
    const res = await callFunction('bulk-upload', {
      method: 'POST',
      query: `?dry_run=${String(dryRun)}`,
      headers: { 'content-type': 'text/csv' },
      body: await new Response(file).text(),
    });
    setReport(JSON.stringify(await res.json().catch(() => ({})), null, 1));
  };
  const reason = file === null ? i.t('m24.uploadCsv') : null;
  return (
    <Section title={i.t('m24.uploadCsv')}>
      <label className="font-semibold" htmlFor="csv">
        {i.t('m24.uploadCsv')}
      </label>
      <input
        id="csv"
        type="file"
        accept=".csv,text/csv"
        onChange={(e) => {
          setFile(e.target.files?.[0] ?? null);
        }}
      />
      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" onClick={() => void upload(true)} disabledReason={reason}>
          {i.t('m24.dryRun')}
        </Button>
        <Button onClick={() => void upload(false)} disabledReason={reason}>
          {i.t('m24.commit')}
        </Button>
      </div>
      {report === null ? null : (
        <pre className="overflow-x-auto rounded bg-surface-2 p-3 text-sm">{report}</pre>
      )}
    </Section>
  );
}

function DealersMaster(): ReactNode {
  const i = useI18n();
  const act = useAction();
  const dealers = useRows(
    'dealer?select=id,code,name,mobile_e164,city,distributor_id,status&order=code',
  );
  return (
    <Section title={i.t('nav.dealers')}>
      <RowsView
        query={dealers}
        caption={i.t('nav.dealers')}
        csvName="dealers"
        columns={cols(i.t, ['code', 'name', 'mobile_e164', 'distributor_id', 'status'])}
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

const ROLES = [
  'DEALER_OWNER',
  'DEALER_STAFF',
  'DISTRIBUTOR',
  'M24_ADMIN',
  'M24_FINANCE',
  'M24_VIEWER',
] as const;

/** Calls an admin Edge Function and reports the outcome (with a WhatsApp link when there is one). */
function useAdminCall(onDone: () => void): {
  msg: { text: string; url: string | null } | null;
  call: (fn: string, body: unknown) => Promise<void>;
} {
  const i = useI18n();
  const { callFunction } = useServices();
  const [msg, setMsg] = useState<{ text: string; url: string | null } | null>(null);
  return {
    msg,
    call: async (fn, body) => {
      const r = await callFunction(fn, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = (await r.json().catch(() => ({}))) as Row;
      const error = typeof json['error'] === 'string' ? json['error'] : i.t('common.error');
      setMsg({
        text: r.ok ? i.t('common.done') : error,
        url: typeof json['whatsapp_url'] === 'string' ? json['whatsapp_url'] : null,
      });
      onDone();
    },
  };
}

export function UsersPage(): ReactNode {
  const i = useI18n();
  const users = useRows(
    'app_user?select=id,name,mobile_e164,email,role,dealer_id,distributor_id,status&order=id',
  );
  const { msg, call } = useAdminCall(() => void users.refetch());
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">{i.t('nav.users')}</h1>
      {msg === null ? null : (
        <p role="status">
          {msg.text}{' '}
          {msg.url === null ? null : (
            <a className="underline" href={msg.url} target="_blank" rel="noreferrer">
              {i.t('dist.openWhatsApp')}
            </a>
          )}
        </p>
      )}
      <RowsView
        query={users}
        caption={i.t('nav.users')}
        csvName="users"
        columns={[
          ...cols(i.t, ['id', 'name', 'role', 'status']),
          {
            key: 'actions',
            label: i.t('col.actions'),
            render: (r) => <UserActions row={r} call={call} />,
          },
        ]}
      />
      <Section title={i.t('dist.addUser')}>
        <CreateUserForm call={call} />
      </Section>
    </div>
  );
}

function UserActions({
  row,
  call,
}: {
  readonly row: Row;
  readonly call: (fn: string, body: unknown) => Promise<void>;
}): ReactNode {
  const i = useI18n();
  const active = str(row, 'status') === 'ACTIVE';
  return (
    <span className="flex gap-1">
      {str(row, 'role').startsWith('M24_') ? null : (
        <Button
          variant="secondary"
          onClick={() => void call('admin-login-link', { user_id: num(row, 'id') })}
        >
          {i.t('dist.sendLink')}
        </Button>
      )}
      <Button
        variant={active ? 'danger' : 'secondary'}
        onClick={() =>
          void call('admin-user-status', {
            user_id: num(row, 'id'),
            status: active ? 'INACTIVE' : 'ACTIVE',
            reason: 'Changed by 24M admin',
          })
        }
      >
        {active ? i.t('staff.remove') : i.t('dist.approve')}
      </Button>
    </span>
  );
}

function CreateUserForm({
  call,
}: {
  readonly call: (fn: string, body: unknown) => Promise<void>;
}): ReactNode {
  const i = useI18n();
  return (
    <ActionForm
      submitLabel={i.t('dist.addUser')}
      fields={[
        { name: 'role', label: 'col.role', options: ROLES.map((r) => ({ value: r, label: r })) },
        { name: 'name', label: 'col.name' },
        { name: 'mobile', label: 'col.mobile', type: 'tel', required: false },
        { name: 'email', label: 'login.email', type: 'email', required: false },
        { name: 'dealer_id', label: 'col.dealer', type: 'number', required: false },
        { name: 'distributor_id', label: 'col.distributor', type: 'number', required: false },
      ]}
      onSubmit={(vals) => {
        const optional = {
          mobile: nullIfEmpty(vals['mobile']),
          email: nullIfEmpty(vals['email']),
          dealer_id: intOrNull(vals['dealer_id']),
          distributor_id: intOrNull(vals['distributor_id']),
        };
        const body = Object.fromEntries(Object.entries(optional).filter(([, val]) => val !== null));
        return call('admin-create-user', { name: vals['name'], role: vals['role'], ...body });
      }}
    />
  );
}

export function M24ClaimsPage(): ReactNode {
  const i = useI18n();
  const q = useRows(
    'dist_claim?select=id,status,distributor_id,created_at,total_paise,validated_by,cn_no&order=id.desc&limit=100',
  );
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">{i.t('nav.m24claims')}</h1>
      <RowsView
        query={q}
        caption={i.t('nav.m24claims')}
        csvName="distributor-claims"
        columns={[
          {
            key: 'id',
            label: i.t('col.id'),
            render: (r) => (
              <Link
                className="underline"
                to={`/m/claim/${num(r, 'id')}`}
              >{`#${num(r, 'id')}`}</Link>
            ),
            value: (r) => num(r, 'id'),
          },
          ...cols(i.t, ['status', 'distributor_id']),
          {
            key: 'total_paise',
            label: i.t('col.total'),
            render: (r) => <Money paise={num(r, 'total_paise')} />,
            value: (r) => num(r, 'total_paise'),
          },
          { key: 'cn_no', label: i.t('col.cn') },
        ]}
      />
    </div>
  );
}

const DistDetail = v.object({
  claim: v.record(v.string(), v.unknown()),
  lines: v.array(v.record(v.string(), v.unknown())),
});

/** 24M maker (validate) and checker (settle with CN), different people (R3-06). */
export function M24ClaimDetailPage({ role }: { readonly role: string }): ReactNode {
  const { id = '0' } = useParams();
  const claimId = Number(id);
  const i = useI18n();
  const act = useAction();
  const q = useRpcData('dist_claim_detail', { p_claim_id: claimId }, DistDetail);
  const [reason, setReason] = useState('');
  if (q.isLoading) return <Skeleton />;
  if (q.data === undefined) return <ErrorState onRetry={() => void q.refetch()} />;
  const status = str(q.data.claim, 'status');
  const maker = role === 'M24_ADMIN' && status === 'SUBMITTED';
  const decide = (ids: number[] | null, decision: 'APPROVE' | 'REJECT' | 'HOLD'): void => {
    void act.run('m24_decide', {
      p_claim_id: claimId,
      p_coupon_ids: ids,
      p_decision: decision,
      p_reason: decision === 'APPROVE' ? null : reason,
    });
  };
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">
        {i.t('dist.claim', {
          id: claimId,
          dealer: str((q.data.claim['distributor'] ?? {}) as Row, 'name'),
        })}
      </h1>
      <StatusPill tone={status === 'SETTLED' ? 'good' : 'neutral'}>
        {i.t(`status.${status}` as Key)}
      </StatusPill>
      <Status message={act.message} error={act.error} />
      {maker ? (
        <div className="grid gap-2 sm:grid-cols-3">
          <Button
            onClick={() => {
              decide(null, 'APPROVE');
            }}
          >
            {i.t('dist.approveAll')}
          </Button>
          <Field
            label={i.t('common.reason')}
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
            }}
          />
          <Button
            variant="secondary"
            onClick={() => void act.run('m24_validate_claim', { p_claim_id: claimId })}
          >
            {i.t('m24.validate')}
          </Button>
        </div>
      ) : null}
      <RowsView
        query={{ data: q.data.lines, error: null, isLoading: false, refetch: () => q.refetch() }}
        caption={i.t('nav.m24claims')}
        onRowKey={(key, row) => {
          if (!maker) return;
          if (key === 'a') decide([num(row, 'coupon_id')], 'APPROVE');
          if (key === 'r') decide([num(row, 'coupon_id')], 'REJECT');
        }}
        columns={m24LineColumns(i, maker, decide)}
      />
      <ClaimFooter claimId={claimId} role={role} status={status} run={act.run} />
    </div>
  );
}

function m24LineColumns(
  i: ReturnType<typeof useI18n>,
  maker: boolean,
  decide: (ids: number[] | null, d: 'APPROVE' | 'REJECT' | 'HOLD') => void,
): Column<Row>[] {
  return [
    ...cols(i.t, ['serial', 'dealer', 'dealer_cn_no']),
    {
      key: 'value_paise',
      label: i.t('col.value'),
      render: (r) => <Money paise={num(r, 'value_paise')} />,
      value: (r) => num(r, 'value_paise'),
    },
    {
      key: 'painter_status',
      label: i.t('col.painter'),
      render: (r) => (
        <StatusPill tone={painterTone(str(r, 'painter_status'))}>
          {i.t(`pstatus.${str(r, 'painter_status')}` as Key)}
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
        maker && ['PENDING', 'HELD'].includes(str(r, 'line_status')) ? (
          <LineActions id={num(r, 'coupon_id')} decide={decide} />
        ) : null,
    },
  ];
}

function ClaimFooter({
  claimId,
  role,
  status,
  run,
}: {
  readonly claimId: number;
  readonly role: string;
  readonly status: string;
  readonly run: ReturnType<typeof useAction>['run'];
}): ReactNode {
  const i = useI18n();
  const { api } = useServices();
  const exportCsv = async (): Promise<void> => {
    const r = await api.select(
      `rpc/m24_settlement_export?p_claim_id=${String(claimId)}`,
      v.array(v.record(v.string(), v.unknown())),
    );
    if (!r.ok) return;
    const header = Object.keys(r.data[0] ?? {});
    downloadBlob(
      `settlement-${String(claimId)}.csv`,
      new Blob(
        [
          toCsv(
            header.map((h) => ({ key: h, label: h })),
            r.data,
          ),
        ],
        { type: 'text/csv' },
      ),
    );
  };
  return (
    <>
      {role === 'M24_ADMIN' && (status === 'SUBMITTED' || status === 'VALIDATED') ? (
        <Section title={i.t('m24.return')}>
          <ActionForm
            submitLabel={i.t('m24.return')}
            fields={[{ name: 'reason', label: 'common.reason' }]}
            onSubmit={(vals) =>
              run('m24_return_claim', { p_claim_id: claimId, p_reason: vals['reason'] })
            }
          />
        </Section>
      ) : null}
      {role === 'M24_FINANCE' && status === 'VALIDATED' ? (
        <Section title={i.t('m24.settle')}>
          <ActionForm
            submitLabel={i.t('m24.settle')}
            fields={[
              { name: 'cn', label: 'dist.cnNo' },
              {
                name: 'date',
                label: 'dist.cnDate',
                type: 'date',
                initial: new Date().toISOString().slice(0, 10),
              },
            ]}
            onSubmit={(vals) =>
              run('m24_settle', {
                p_claim_id: claimId,
                p_cn_no: vals['cn'],
                p_cn_date: vals['date'],
              })
            }
          />
        </Section>
      ) : null}
      {status === 'SETTLED' ? (
        <Button variant="secondary" onClick={() => void exportCsv()}>
          {i.t('common.downloadCsv')}
        </Button>
      ) : null}
    </>
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
        <CouponCard result={result} coupon={coupon as Row} admin={role === 'M24_ADMIN'} />
      ) : null}
    </div>
  );
}

function CouponCard({
  result,
  coupon,
  admin,
}: {
  readonly result: Row;
  readonly coupon: Row;
  readonly admin: boolean;
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
      <PainterLine painter={result['painter']} admin={admin} />
      <RowsView
        query={{ data: events, error: null, isLoading: false, refetch: () => undefined }}
        caption={i.t('nav.lookup')}
        columns={cols(i.t, ['event', 'from', 'to', 'by', 'ref', 'at'])}
      />
      {admin ? <AdminCouponActions couponId={num(coupon, 'id')} /> : null}
    </Section>
  );
}

/** Masked for everyone; the full number (§6.9) only for 24M admins, on request. */
function PainterLine({
  painter,
  admin,
}: {
  readonly painter: unknown;
  readonly admin: boolean;
}): ReactNode {
  const i = useI18n();
  const [show, setShow] = useState(false);
  if (typeof painter !== 'object' || painter === null) return null;
  const p = painter as Row;
  return (
    <p>
      <StatusPill tone={painterTone(str(p, 'status'))}>
        {i.t(`pstatus.${str(p, 'status')}` as Key)}
      </StatusPill>{' '}
      {show ? str(p, 'painter') : null}
      {admin && !show ? (
        <Button
          variant="ghost"
          onClick={() => {
            setShow(true);
          }}
        >
          {i.t('m24.painterNumber')}
        </Button>
      ) : null}
    </p>
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
    title: 'col.rate',
    path: 'v_dealer_confirmation_rate?select=dealer_id,dealer_name,coupons,confirmed_coupons,rate_pct,below_threshold&order=rate_pct.asc',
    cols: ['dealer_name', 'coupons', 'confirmed_coupons', 'rate_pct', 'below_threshold'],
    csv: 'confirmation-rate',
  },
  {
    title: 'col.flags',
    path: 'v_painter_flags?select=painter_id,painter,painter_status,flag,occurrences,last_seen',
    cols: ['painter', 'flag', 'occurrences', 'painter_status'],
    csv: 'painter-flags',
  },
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
  {
    title: 'col.age',
    path: 'v_claim_ageing?select=kind,claim_id,status,distributor_id,since',
    cols: ['kind', 'claim_id', 'status', 'since'],
  },
  {
    title: 'claims.markReceived',
    path: 'v_unacked_cn?select=claim_id,dealer_name,cn_no,cn_date,cn_total_paise',
    cols: ['claim_id', 'dealer_name', 'cn_no', 'cn_date'],
  },
  {
    title: 'col.wa',
    path: 'v_wa_health?select=*',
    cols: [
      'last_inbound_at',
      'webhook_errors_24h',
      'outbox_failed_1h',
      'outbox_pending',
      'batches_24h',
    ],
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

function DisputesSection({ admin }: { readonly admin: boolean }): ReactNode {
  const i = useI18n();
  const act = useAction();
  const disputes = useRows(
    'v_disputes?select=batch_id,status,flags,dealer_name,coupon_count,value_paise,painter,disputed_at',
  );
  const resolve = (batchId: number, decision: 'RELEASE' | 'REJECT'): void => {
    void act.run('resolve_dispute', {
      p_batch_id: batchId,
      p_decision: decision,
      p_note: `Resolved in weekly review: ${decision.toLowerCase()}`,
    });
  };
  return (
    <Section title={i.t('m24.disputes')}>
      <Status message={act.message} error={act.error} />
      <RowsView
        query={disputes}
        caption={i.t('m24.disputes')}
        columns={[
          ...cols(i.t, ['batch_id', 'status', 'dealer_name', 'coupon_count', 'painter']),
          {
            key: 'actions',
            label: i.t('col.actions'),
            render: (r) =>
              admin ? (
                <span className="flex gap-1">
                  <Button
                    variant="secondary"
                    onClick={() => {
                      resolve(num(r, 'batch_id'), 'RELEASE');
                    }}
                  >
                    {i.t('m24.release')}
                  </Button>
                  <Button
                    variant="danger"
                    onClick={() => {
                      resolve(num(r, 'batch_id'), 'REJECT');
                    }}
                  >
                    {i.t('m24.rejectDispute')}
                  </Button>
                </span>
              ) : null,
          },
        ]}
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
      <DisputesSection admin={role === 'M24_ADMIN'} />
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

export function ReportsPage(): ReactNode {
  const i = useI18n();
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const summary = useRows(`rpc/recon_summary?p_month=${month}-01`);
  const issues = useRows(
    'recon_issue?select=id,run_date,check_name,ref,details&order=id.desc&limit=200',
  );
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">{i.t('nav.reports')}</h1>
      <Field
        label={i.t('m24.reportMonth')}
        type="month"
        value={month}
        onChange={(e) => {
          setMonth(e.target.value);
        }}
      />
      <RowsView
        query={summary}
        caption={i.t('nav.reports')}
        csvName={`reconciliation-${month}`}
        columns={cols(i.t, [
          'distributor_id',
          'redeemed',
          'dist_approved',
          'dist_rejected',
          'dist_pending',
          'claimed_to_24m',
          'settled',
          'm24_rejected',
          'on_hold',
        ])}
      />
      <Section title={i.t('col.check')}>
        <RowsView
          query={issues}
          caption={i.t('col.check')}
          csvName="recon-issues"
          columns={cols(i.t, ['run_date', 'check_name', 'ref'])}
        />
      </Section>
    </div>
  );
}
