// Mints short-lived HS256 access tokens for the k6 dealers (staging JWT secret, never production).
//   K6_JWT_SECRET=... node load/mint-tokens.mjs load/.out/users.txt > load/.out/tokens.txt
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';

const secret = process.env.K6_JWT_SECRET;
const file = process.argv[2];
if (secret === undefined || secret === '' || file === undefined) {
  console.error('usage: K6_JWT_SECRET=... node load/mint-tokens.mjs <users.txt>');
  process.exit(2);
}

const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const header = b64({ alg: 'HS256', typ: 'JWT' });

for (const sub of readFileSync(file, 'utf8')
  .split('\n')
  .filter((line) => line.trim() !== '')) {
  const body = b64({
    sub: sub.trim(),
    role: 'authenticated',
    aud: 'authenticated',
    iat: now,
    exp: now + 7200,
  });
  const sig = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  console.log(`${header}.${body}.${sig}`);
}
