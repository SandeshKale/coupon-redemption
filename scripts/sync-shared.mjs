#!/usr/bin/env node
// Copies packages/shared/src (minus tests) into supabase/functions/_shared/lib so Edge Functions
// deploy self-contained. CI runs this and fails on `git diff` — the copy can never drift.
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const src = new URL('../packages/shared/src/', import.meta.url).pathname;
const dest = new URL('../supabase/functions/_shared/lib/', import.meta.url).pathname;
rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
for (const file of readdirSync(src)) {
  if (!file.endsWith('.ts') || file.endsWith('.test.ts')) continue;
  const header = '// GENERATED from packages/shared/src by scripts/sync-shared.mjs. Do not edit.\n';
  writeFileSync(join(dest, file), header + readFileSync(join(src, file), 'utf8'));
}
