// 50 inbound WhatsApp webhooks/second for 2 minutes, 10% duplicates → every message processed
// exactly once (§20.7). After the run, verify with load/verify.sql.
import { check } from 'k6';
import { hmac } from 'k6/crypto';
import exec from 'k6/execution';
import http from 'k6/http';

import { API } from './lib.js';

const APP_SECRET = __ENV.K6_WA_APP_SECRET;
const RUN = __ENV.K6_RUN_ID ?? String(Date.now());

export const options = {
  scenarios: {
    burst: {
      executor: 'constant-arrival-rate',
      rate: 50,
      timeUnit: '1s',
      duration: __ENV.K6_DURATION ?? '2m',
      preAllocatedVUs: 50,
      maxVUs: 150,
    },
  },
  thresholds: {
    'http_req_duration{name:wa-webhook}': ['p(95)<1000'],
    http_req_failed: ['rate==0'],
    checks: ['rate==1'],
  },
};

function payload(n) {
  const from = `9198${String(n % 100000).padStart(8, '0')}`;
  return JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [
      {
        changes: [
          {
            field: 'messages',
            value: {
              messages: [
                {
                  id: `wamid.k6.${RUN}.${n}`,
                  from,
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  type: 'text',
                  text: { body: 'HELP' },
                },
              ],
            },
          },
        ],
      },
    ],
  });
}

export default function burst() {
  const i = exec.scenario.iterationInTest;
  // Every 10th request replays the previous message id (Meta retries deliver duplicates).
  const n = i % 10 === 9 ? i - 1 : i;
  const body = payload(n);
  const res = http.post(`${API}/functions/v1/wa-webhook`, body, {
    headers: {
      'content-type': 'application/json',
      'x-hub-signature-256': `sha256=${hmac('sha256', APP_SECRET, body, 'hex')}`,
    },
    tags: { name: 'wa-webhook' },
  });
  check(res, { 'acknowledged 200': (r) => r.status === 200 });
}
