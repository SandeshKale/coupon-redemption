#!/usr/bin/env node
// Enforces §20.2 thresholds on an lcov file: node scripts/coverage-gate.mjs <lcov> <lines> <branches> <functions> [exclude-regex]
import { readFileSync } from 'node:fs';

const [file, lines, branches, functions, exclude] = process.argv.slice(2);
const skip = exclude ? new RegExp(exclude) : null;
const t = { LF: 0, LH: 0, BRF: 0, BRH: 0, FNF: 0, FNH: 0 };
let include = true;
for (const line of readFileSync(file, 'utf8').split('\n')) {
  if (line.startsWith('SF:')) include = !(skip?.test(line.slice(3)) ?? false);
  const m = /^(LF|LH|BRF|BRH|FNF|FNH):(\d+)$/.exec(line);
  if (m && include) t[m[1]] += Number(m[2]);
}
const pct = (h, f) => (f === 0 ? 100 : (100 * h) / f);
const got = { lines: pct(t.LH, t.LF), branches: pct(t.BRH, t.BRF), functions: pct(t.FNH, t.FNF) };
const want = { lines: Number(lines), branches: Number(branches), functions: Number(functions) };
let ok = true;
for (const k of Object.keys(want)) {
  const pass = got[k] >= want[k];
  ok &&= pass;
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${k.padEnd(9)} ${got[k].toFixed(1)}% (≥ ${want[k]}%)`);
}
process.exit(ok ? 0 : 1);
