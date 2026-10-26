import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

export const API = 'http://api.test';

export const server = setupServer();

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
type Responder = Json | Response | ((args: Record<string, unknown>) => Json | Response);

/** Registers RPC responses by function name: value, function of args, or a Response (errors). */
export function rpc(map: Record<string, Responder>): void {
  server.use(
    http.post(`${API}/rest/v1/rpc/:fn`, async ({ params, request }) => {
      const fn = String(params['fn']);
      const r = map[fn];
      if (r === undefined) return HttpResponse.json({ message: `unmocked ${fn}` }, { status: 404 });
      const args = (await request.json().catch(() => ({}))) as Record<string, unknown>;
      const out: Json | Response = typeof r === 'function' ? r(args) : r;
      return out instanceof Response ? out.clone() : HttpResponse.json(out);
    }),
  );
}

export function rest(map: Record<string, Json>): void {
  server.use(
    http.get(`${API}/rest/v1/*`, ({ request }) => {
      const url = new URL(request.url);
      const key = Object.keys(map).find((k) => url.pathname === `/rest/v1/${k}`);
      return key === undefined ? HttpResponse.json([]) : HttpResponse.json(map[key] ?? []);
    }),
  );
}

export function fn(name: string, handler: (req: Request) => Response | Promise<Response>): void {
  server.use(http.all(`${API}/functions/v1/${name}`, ({ request }) => handler(request)));
}

export const err = (status: number, message: string): Response =>
  HttpResponse.json({ message, code: 'PT' + String(status) }, { status });
