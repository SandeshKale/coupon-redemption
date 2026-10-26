/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_COUPON_HOST: string;
  readonly VITE_SENTRY_DSN?: string;
  readonly VITE_HELPLINE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
