import { config } from './config.ts';

/** Errors and timings → Sentry (lazy-loaded chunk, only when a DSN is configured). No PII. */
type SentryModule = typeof import('@sentry/browser');
let sentry: Promise<SentryModule | null> | null = null;

function load(): Promise<SentryModule | null> {
  if (config.sentryDsn === undefined) return Promise.resolve(null);
  sentry ??= import('@sentry/browser').then((S) => {
    S.init({
      dsn: config.sentryDsn,
      tracesSampleRate: 0.1,
      sendDefaultPii: false,
      integrations: [S.browserTracingIntegration()],
    });
    return S;
  });
  return sentry;
}

export function reportError(error: unknown, context: Record<string, string | number> = {}): void {
  void load().then((S) => S?.captureException(error, { extra: context }));
}

/** Records a client timing (e.g. scan → receipt) as a Sentry measurement. */
export function reportTiming(name: string, ms: number): void {
  void load().then((S) => S?.setMeasurement(name, ms, 'millisecond'));
}

export function initTelemetryWhenIdle(): void {
  if (config.sentryDsn === undefined) return;
  window.setTimeout(() => void load(), 3000);
}
