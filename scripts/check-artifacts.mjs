#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const paths = ['README.md','LICENSE','SECURITY.md','PROVENANCE.md','package.json'];
const before = new Map(paths.map((p) => [p, readFileSync(p, 'utf8')]));
const result = spawnSync(process.execPath, ['scripts/generate-artifacts.mjs'], { stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status ?? 1);
let ok = true;
for (const [path, content] of before) {
  if (readFileSync(path, 'utf8') !== content) { console.error(`artifact drift: ${path}`); ok = false; }
}
if (!ok) process.exit(1);
