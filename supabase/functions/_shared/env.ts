/** Typed, validated environment. Secrets come from Supabase Edge Function secrets only. */
export interface Env {
  readonly supabaseUrl: string;
  readonly serviceRoleKey: string;
  readonly anonKey: string;
  readonly metaAppSecret: string;
  readonly metaVerifyToken: string;
  readonly metaAccessToken: string;
  readonly metaPhoneNumberId: string;
  readonly metaGraphVersion: string;
  readonly waSenderSecret: string;
  readonly appUrl: string;
  readonly couponHost: string;
}

export function readEnv(get: (k: string) => string | undefined = (k) => Deno.env.get(k)): Env {
  const req = (k: string): string => {
    const v = get(k);
    if (v === undefined || v === '') throw new Error(`missing env ${k}`);
    return v;
  };
  const opt = (k: string, d: string): string => get(k) ?? d;
  return {
    supabaseUrl: req('SUPABASE_URL'),
    serviceRoleKey: req('SUPABASE_SERVICE_ROLE_KEY'),
    anonKey: req('SUPABASE_ANON_KEY'),
    metaAppSecret: opt('META_APP_SECRET', ''),
    metaVerifyToken: opt('META_VERIFY_TOKEN', ''),
    metaAccessToken: opt('META_ACCESS_TOKEN', ''),
    metaPhoneNumberId: opt('META_PHONE_NUMBER_ID', ''),
    metaGraphVersion: opt('META_GRAPH_VERSION', 'v21.0'),
    waSenderSecret: opt('WA_SENDER_SECRET', ''),
    appUrl: opt('APP_URL', 'https://c.example.in'),
    couponHost: opt('COUPON_HOST', 'c.example.in'),
  };
}
