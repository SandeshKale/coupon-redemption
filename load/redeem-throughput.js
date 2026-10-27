// 300 redemptions/minute for 15 minutes across 200 dealers → p95 ≤ 300 ms, 0 errors (§20.7).
import { check } from 'k6';
import { randomBytes } from 'k6/crypto';
import exec from 'k6/execution';

import { codes, rpc, tokens, uuid } from './lib.js';

const allTokens = tokens();
const allCodes = codes();

export const options = {
  scenarios: {
    steady: {
      executor: 'constant-arrival-rate',
      rate: 300,
      timeUnit: '1m',
      duration: __ENV.K6_DURATION ?? '15m',
      preAllocatedVUs: 50,
      maxVUs: 200,
    },
  },
  thresholds: {
    'http_req_duration{rpc:redeem}': ['p(95)<300'],
    'http_req_duration{rpc:check_coupon}': ['p(95)<300'],
    http_req_failed: ['rate==0'],
    checks: ['rate==1'],
  },
};

export default function steady() {
  const i = exec.scenario.iterationInTest;
  if (i >= allCodes.length) exec.test.abort('ran out of seeded codes');
  const token = allTokens[i % allTokens.length];
  const code = allCodes[i];
  const checked = rpc('check_coupon', { p_code: code }, token);
  check(checked, { 'check 200': (r) => r.status === 200 });
  const res = rpc('redeem', { p_codes: [code], p_idem: uuid(randomBytes) }, token);
  check(res, {
    'redeem 200': (r) => r.status === 200,
    'redeemed once': (r) => (r.json('lines') ?? [])[0]?.result === 'REDEEMED',
  });
}
