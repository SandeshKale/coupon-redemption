import type { Deps } from './deps.ts';
import type { Env } from './env.ts';
import type { AuthSession, Supa } from './supabase.ts';

export const TEST_ENV: Env = {
  supabaseUrl: 'https://proj.supabase.co',
  serviceRoleKey: 'service-key-test',
  anonKey: 'anon-key-test',
  metaAppSecret: 'app-secret-test',
  metaVerifyToken: 'verify-token-test',
  metaAccessToken: 'access-token-test',
  metaPhoneNumberId: '106540352242922',
  metaGraphVersion: 'v21.0',
  waSenderSecret: 'sender-secret-test',
  appUrl: 'https://c.example.in',
  couponHost: 'c.example.in',
};

export interface Call {
  kind: 'service' | 'user' | 'auth' | 'verify' | 'fetch';
  name: string;
  args: unknown;
  jwt?: string;
}

type Responder = (args: unknown) => unknown;

export interface TestDeps extends Deps {
  calls: Call[];
  logs: string[];
  background: Promise<unknown>[];
}

/** Fake deps: RPC/auth responses by name (value, function, or thrown error); fetch by URL substring. */
export function testDeps(opts: {
  rpc?: Record<string, unknown>;
  auth?: Record<string, unknown>;
  fetch?: Record<string, (req: Request) => Response | Promise<Response>>;
  env?: Partial<Env>;
} = {}): TestDeps {
  const calls: Call[] = [];
  const logs: string[] = [];
  const background: Promise<unknown>[] = [];
  const respond = (
    table: Record<string, unknown> | undefined,
    name: string,
    args: unknown,
  ): Promise<never> | Promise<unknown> => {
    const r = table?.[name];
    if (r instanceof Error) return Promise.reject(r);
    if (typeof r === 'function') {
      try {
        return Promise.resolve((r as Responder)(args));
      } catch (e) {
        return Promise.reject(e);
      }
    }
    return Promise.resolve(r ?? null);
  };
  const supa: Supa = {
    service: <T>(fn: string, args: Record<string, unknown>) => {
      calls.push({ kind: 'service', name: fn, args });
      return respond(opts.rpc, fn, args) as Promise<T>;
    },
    asUser: <T>(jwt: string, fn: string, args: Record<string, unknown>) => {
      calls.push({ kind: 'user', name: fn, args, jwt });
      return respond(opts.rpc, fn, args) as Promise<T>;
    },
    authAdmin: <T>(method: string, path: string, body?: unknown) => {
      const key = `${method} ${path.replace(/\/[0-9a-f-]{36}$/, '/:id')}`;
      calls.push({ kind: 'auth', name: key, args: body });
      return respond(opts.auth, key, body) as Promise<T>;
    },
    authVerify: (tokenHash: string) => {
      calls.push({ kind: 'verify', name: 'verify', args: tokenHash });
      return respond(opts.auth, 'VERIFY', tokenHash) as Promise<AuthSession>;
    },
  };
  const fakeFetch = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const req = new Request(input, init);
    calls.push({ kind: 'fetch', name: req.url, args: init?.body });
    for (const [frag, fn] of Object.entries(opts.fetch ?? {})) {
      if (req.url.includes(frag)) return Promise.resolve(fn(req));
    }
    return Promise.reject(new TypeError('network'));
  };
  return {
    env: { ...TEST_ENV, ...opts.env },
    fetch: fakeFetch as typeof fetch,
    supa,
    now: () => new Date('2026-10-26T10:00:00Z'),
    log: { log: (level, outcome, fields) => logs.push(JSON.stringify({ level, outcome, ...fields })) },
    waitUntil: (p) => background.push(p),
    calls,
    logs,
    background,
  };
}

export async function sign(body: string, secret = TEST_ENV.metaAppSecret): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    [
      'sign',
    ],
  );
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)));
  return 'sha256=' + Array.from(mac, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function fixture(name: string): string {
  return Deno.readTextFileSync(new URL(`./fixtures/${name}`, import.meta.url));
}

export function post(url: string, body: string, headers: Record<string, string> = {}): Request {
  return new Request(url, {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/json', ...headers },
  });
}
