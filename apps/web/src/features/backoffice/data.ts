import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import * as v from 'valibot';

import type { ApiFailure } from '../../lib/api/client.ts';
import { type Row, JsonArray } from '../../lib/api/schemas.ts';
import { useI18n } from '../../lib/i18n/index.ts';
import { useServices } from '../../lib/services.ts';

export class QueryError extends Error {
  constructor(readonly failure: ApiFailure) {
    super(failure.kind);
  }
}

/** Table data via PostgREST (RLS decides rows). Paths always name explicit columns. */
export function useRows(
  path: string,
  enabled = true,
): ReturnType<typeof useQuery<Row[], QueryError>> {
  const { api } = useServices();
  return useQuery<Row[], QueryError>({
    queryKey: ['select', path],
    enabled,
    queryFn: async () => {
      const r = await api.select(path, JsonArray);
      if (!r.ok) throw new QueryError(r.error);
      return r.data;
    },
  });
}

export function useRpcData<T>(
  fn: string,
  args: Record<string, unknown>,
  schema: v.GenericSchema<unknown, T>,
  enabled = true,
): ReturnType<typeof useQuery<T, QueryError>> {
  const { api } = useServices();
  return useQuery<T, QueryError>({
    queryKey: ['rpc', fn, args],
    enabled,
    queryFn: async () => {
      const r = await api.rpc(fn, args, schema);
      if (!r.ok) throw new QueryError(r.error);
      return r.data;
    },
  });
}

/** Runs a write RPC, exposes a status message, and refreshes all back-office queries. */
export function useAction(): {
  run: (fn: string, args: Record<string, unknown>) => Promise<unknown>;
  message: string | null;
  error: boolean;
  pending: boolean;
} {
  const { api } = useServices();
  const { t } = useI18n();
  const qc = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const m = useMutation({
    mutationFn: async ({ fn, args }: { fn: string; args: Record<string, unknown> }) => {
      const r = await api.rpc(fn, args, v.unknown());
      if (!r.ok) throw new QueryError(r.error);
      return r.data;
    },
  });
  return {
    message,
    error,
    pending: m.isPending,
    run: async (fn, args) => {
      try {
        const data = await m.mutateAsync({ fn, args });
        setError(false);
        setMessage(t('m24.result', { summary: summarise(data) }));
        await qc.invalidateQueries();
        return data;
      } catch (e) {
        setError(true);
        setMessage(e instanceof QueryError ? failureText(e.failure, t) : t('common.error'));
        return null;
      }
    },
  };
}

export function summarise(data: unknown): string {
  if (data === null || data === undefined) return '✓';
  if (typeof data === 'string' || typeof data === 'number' || typeof data === 'boolean')
    return String(data);
  if (typeof data !== 'object') return '✓';
  return Object.entries(data as Record<string, unknown>)
    .filter(
      (e): e is [string, string | number | boolean | null] =>
        e[1] === null || ['string', 'number', 'boolean'].includes(typeof e[1]),
    )
    .map(([k, val]) => `${k}: ${val === null ? '–' : String(val)}`)
    .join(', ');
}

export function failureText(f: ApiFailure, t: ReturnType<typeof useI18n>['t']): string {
  if (f.kind === 'business') return f.code;
  if (f.kind === 'forbidden')
    return f.code === 'MFA_REQUIRED' ? t('m24.mfaRequired') : t('common.forbidden');
  if (f.kind === 'offline' || f.kind === 'captive') return t('state.offline');
  return t('common.error');
}

export function str(row: Row, key: string): string {
  const val = row[key];
  return typeof val === 'string'
    ? val
    : typeof val === 'number'
      ? String(val)
      : val === null || val === undefined
        ? ''
        : JSON.stringify(val);
}

export function num(row: Row, key: string): number {
  const val = row[key];
  return typeof val === 'number' ? val : Number(val ?? 0);
}
