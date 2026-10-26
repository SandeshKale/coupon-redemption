import { maskPhone } from './lib/phone.ts';

export type Level = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  log(level: Level, outcome: string, fields?: Record<string, unknown>): void;
}

const PHONE = /\+?\d{10,15}/g;

/** Masks anything that looks like a phone number so logs never hold personal data (§14). */
export function scrub(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.replace(PHONE, (m) => maskPhone(m.startsWith('+') ? m : `+${m}`));
  }
  if (Array.isArray(value)) return value.map(scrub);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrub(v)]));
  }
  return value;
}

/** Structured JSON logs: level, fn, request_id, outcome, ms and scrubbed fields. */
export function makeLogger(
  fn: string,
  requestId: string,
  sink: (line: string) => void = defaultSink,
): Logger {
  const started = Date.now();
  return {
    log(level, outcome, fields = {}): void {
      sink(
        JSON.stringify({
          level,
          fn,
          request_id: requestId,
          outcome,
          ms: Date.now() - started,
          ...(scrub(fields) as object),
        }),
      );
    },
  };
}

function defaultSink(line: string): void {
  // deno-lint-ignore no-console
  console.log(line);
}
