import { type Env, readEnv } from './env.ts';
import { type Logger, makeLogger } from './log.ts';
import { makeSupa, type Supa } from './supabase.ts';

export interface Deps {
  readonly env: Env;
  readonly fetch: typeof fetch;
  readonly supa: Supa;
  readonly now: () => Date;
  readonly log: Logger;
  readonly waitUntil: (p: Promise<unknown>) => void;
}

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

export function realDeps(fn: string, req: Request): Deps {
  const env = readEnv();
  const requestId = req.headers.get('x-request-id') ?? crypto.randomUUID();
  return {
    env,
    fetch: globalThis.fetch.bind(globalThis),
    supa: makeSupa(env, globalThis.fetch.bind(globalThis)),
    now: () => new Date(),
    log: makeLogger(fn, requestId),
    waitUntil: (p) => {
      const safe = p.catch(() => undefined);
      if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(safe);
    },
  };
}
