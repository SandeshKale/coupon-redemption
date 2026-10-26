import * as v from 'valibot';

import { browserFunction } from '../_shared/browser.ts';
import { parseCsv } from '../_shared/csv.ts';
import { json, readLimited } from '../_shared/http.ts';
import { normaliseE164 } from '../_shared/lib/phone.ts';
import { DealerCsvRow } from '../_shared/schemas.ts';

const COLUMNS = ['code', 'name', 'mobile', 'city', 'distributor_code'] as const;
const MAX_BYTES = 2 * 1024 * 1024;

/** §14 bulk-upload: CSV → validation report (dry run) → commit in one transaction (EC-130). */
export const handler = browserFunction(async (req, deps, jwt) => {
  if (req.method !== 'POST') return json(405, { error: 'method' });
  const dryRun = new URL(req.url).searchParams.get('dry_run') !== 'false';
  const raw = await readLimited(req, MAX_BYTES);
  if (raw === null) return json(413, { error: 'TOO_LARGE' });
  const rows = parseCsv(new TextDecoder().decode(raw));
  const header = rows.shift()?.map((h) => h.trim().toLowerCase()) ?? [];
  if (COLUMNS.some((c, i) => header[i] !== c) || header.length !== COLUMNS.length) {
    return json(400, { error: 'BAD_HEADER', expected: COLUMNS });
  }
  const errors: { row: number; error: string }[] = [];
  const clean: Record<string, string | null>[] = [];
  rows.forEach((cells, i) => {
    const obj = Object.fromEntries(COLUMNS.map((c, j) => [c, cells[j] ?? '']));
    if (obj['city'] === '') delete obj['city'];
    const parsed = v.safeParse(DealerCsvRow, obj);
    const mobile = parsed.success ? normaliseE164(parsed.output.mobile) : null;
    if (!parsed.success) errors.push({ row: i + 1, error: 'BAD_ROW' });
    else if (mobile === null) errors.push({ row: i + 1, error: 'BAD_MOBILE' });
    else {
      clean.push({
        code: parsed.output.code.toUpperCase(),
        name: parsed.output.name,
        mobile_e164: mobile,
        city: parsed.output.city ?? null,
        distributor_code: parsed.output.distributor_code.toUpperCase(),
      });
    }
  });
  if (rows.length === 0) return json(400, { error: 'EMPTY' });
  if (errors.length > 0) return json(200, { ok: false, rows: rows.length, errors, committed: false });
  const report = await deps.supa.asUser<unknown>(jwt, 'bulk_upsert_dealers', {
    p_rows: clean,
    p_dry_run: dryRun,
  });
  deps.log.log('info', 'bulk', { rows: rows.length, dry_run: dryRun });
  return json(200, report);
});
