// Shared helpers for the k6 suite (§20.7). Runs against STAGING only, never production.
import http from 'k6/http';

const required = (name) => {
  const value = __ENV[name];
  if (value === undefined || value === '') throw new Error(`missing env ${name}`);
  return value;
};

export const API = required('K6_API_URL').replace(/\/$/, '');
const ANON_KEY = required('K6_ANON_KEY');

/** Dealer access tokens, one JWT per line (see load/README.md for how to mint them). */
export const tokens = () =>
  open(required('K6_DEALER_TOKENS'))
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');

/** Valid ACTIVE codes from the staging lot, one per line. */
export const codes = () =>
  open(required('K6_CODES'))
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');

export function rpc(name, body, token, tags) {
  return http.post(`${API}/rest/v1/rpc/${name}`, JSON.stringify(body), {
    headers: {
      apikey: ANON_KEY,
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    tags: { rpc: name, ...tags },
    timeout: '20s',
  });
}

/** RFC 4122 v4 from k6's crypto RNG. */
export function uuid(randomBytes) {
  const b = new Uint8Array(randomBytes(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
