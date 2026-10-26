import { browserFunction } from '../_shared/browser.ts';
import { csvCell } from '../_shared/csv.ts';
import { json } from '../_shared/http.ts';
import { couponQrUrl } from '../_shared/lib/code.ts';

interface PageRow {
  serial_no: number;
  serial: string;
  code13: string;
  display_code: string;
}

const PAGE = 5000;

/**
 * §5.1 step 2: streams the print CSV (serial, code13, qr_url, display_code). The export is
 * marked finished — with its SHA-256 and row count — only after the last byte is produced.
 */
export const handler = browserFunction(async (req, deps, jwt) => {
  if (req.method !== 'GET') return json(405, { error: 'method' });
  const url = new URL(req.url);
  const lotId = Number(url.searchParams.get('lot_id'));
  if (!Number.isInteger(lotId) || lotId < 1) return json(400, { error: 'BAD_REQUEST' });
  const reason = url.searchParams.get('reason');
  const exportId = await deps.supa.asUser<number>(jwt, 'begin_lot_export', {
    p_lot_id: lotId,
    p_reason: reason,
  });

  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  let after = 0;
  let rows = 0;
  let headerSent = false;

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller): Promise<void> {
      if (!headerSent) {
        headerSent = true;
        const h = encoder.encode('serial,code13,qr_url,display_code\r\n');
        parts.push(h);
        controller.enqueue(h);
        return;
      }
      const page = await deps.supa.service<PageRow[]>('export_lot_page', {
        p_export_id: exportId,
        p_after_serial: after,
        p_limit: PAGE,
      });
      if (page.length === 0) {
        const sha = await sha256Hex(parts);
        await deps.supa.service('finish_lot_export', { p_export_id: exportId, p_rows: rows, p_sha256: sha });
        deps.log.log('info', 'exported', { lot_id: lotId, rows, sha256: sha });
        controller.close();
        return;
      }
      const text = page
        .map((r) =>
          [r.serial, r.code13, couponQrUrl(deps.env.couponHost, r.code13), r.display_code].map(csvCell).join(
            ',',
          )
        )
        .join('\r\n') + '\r\n';
      const chunk = encoder.encode(text);
      parts.push(chunk);
      controller.enqueue(chunk);
      rows += page.length;
      after = page[page.length - 1]?.serial_no ?? after;
    },
  });
  return new Response(stream, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="lot-${lotId}-export-${exportId}.csv"`,
      'cache-control': 'no-store',
    },
  });
});

export async function sha256Hex(parts: Uint8Array[]): Promise<string> {
  const total = parts.reduce((n, p) => n + p.byteLength, 0);
  const all = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    all.set(p, o);
    o += p.byteLength;
  }
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', all));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}
