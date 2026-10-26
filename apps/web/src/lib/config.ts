/** Public runtime configuration (baked in at build time; contains no secrets). */
export interface AppConfig {
  readonly supabaseUrl: string;
  readonly anonKey: string;
  readonly couponHost: string;
  readonly sentryDsn: string | undefined;
  readonly helpline: string | null;
}

export function readConfig(env: Partial<ImportMetaEnv> = import.meta.env): AppConfig {
  return {
    supabaseUrl: (env.VITE_SUPABASE_URL ?? '').replace(/\/$/, ''),
    anonKey: env.VITE_SUPABASE_ANON_KEY ?? '',
    couponHost: env.VITE_COUPON_HOST ?? 'c.example.in',
    sentryDsn: env.VITE_SENTRY_DSN === '' ? undefined : env.VITE_SENTRY_DSN,
    helpline:
      env.VITE_HELPLINE === undefined || env.VITE_HELPLINE === '' ? null : env.VITE_HELPLINE,
  };
}

export const config: AppConfig = readConfig();
