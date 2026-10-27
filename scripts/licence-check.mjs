// Fails when a production dependency's licence is outside the allow-list (§20.9 security job).
// An SPDX "A OR B" expression passes when any alternative is allowed.
import { execFileSync } from 'node:child_process';

const ALLOWED = new Set([
  'MIT',
  'ISC',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  '0BSD',
  'Unlicense',
  'CC0-1.0',
  'BlueOak-1.0.0',
  'MPL-2.0',
]);

const allowed = (expr) =>
  expr
    .replace(/[()]/g, '')
    .split(/\s+OR\s+/)
    .some((alt) => alt.split(/\s+AND\s+/).every((part) => ALLOWED.has(part.trim())));

const report = JSON.parse(
  execFileSync('pnpm', ['licenses', 'list', '--prod', '--json'], { encoding: 'utf8' }),
);
const denied = Object.entries(report).filter(([licence]) => !allowed(licence));

for (const [licence, pkgs] of denied) {
  console.error(`${licence}: ${pkgs.map((p) => p.name).join(', ')}`);
}
if (denied.length > 0) process.exit(1);
console.log(`licences OK (${Object.keys(report).join(', ')})`);
