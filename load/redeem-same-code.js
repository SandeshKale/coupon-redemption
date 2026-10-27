// 100 virtual users redeem THE SAME code at the same moment → exactly one REDEEMED (§20.7).
import { check } from 'k6';
import { randomBytes } from 'k6/crypto';
import { Counter } from 'k6/metrics';

import { codes, rpc, tokens, uuid } from './lib.js';

const redeemed = new Counter('redeemed_lines');
const duplicate = new Counter('already_redeemed_lines');
const allTokens = tokens();
const target = codes()[0];

export const options = {
  scenarios: {
    race: { executor: 'per-vu-iterations', vus: 100, iterations: 1, maxDuration: '1m' },
  },
  thresholds: {
    redeemed_lines: ['count==1'],
    http_req_failed: ['rate==0'],
    checks: ['rate==1'],
  },
};

export default function race() {
  const token = allTokens[(__VU - 1) % allTokens.length];
  const res = rpc('redeem', { p_codes: [target], p_idem: uuid(randomBytes) }, token);
  check(res, { 'status 200': (r) => r.status === 200 });
  const lines = res.json('lines') ?? [];
  for (const line of lines) {
    if (line.result === 'REDEEMED') redeemed.add(1);
    else duplicate.add(1);
  }
}
