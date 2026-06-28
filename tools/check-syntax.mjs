#!/usr/bin/env node
import { readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(new URL('..', import.meta.url).pathname);
const targets = ['src', 'test', 'tools'];

function filesOf(target, out = []) {
  const p = join(root, target);
  const st = statSync(p);
  if (st.isFile()) {
    if (/\.mjs$/.test(p)) out.push(p);
    return out;
  }
  for (const name of readdirSync(p)) {
    const next = join(p, name);
    const ns = statSync(next);
    if (ns.isDirectory()) filesOf(relative(root, next), out);
    else if (/\.mjs$/.test(next)) out.push(next);
  }
  return out;
}

const files = targets.flatMap(x => filesOf(x));
const errors = [];
for (const file of files) {
  const checked = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (checked.status !== 0) errors.push(`${relative(root, file)}\n${checked.stderr || checked.stdout}`.trim());
}
if (errors.length) {
  console.error(errors.join('\n\n'));
  process.exit(1);
}
console.log(`syntax OK: ${files.length} module files`);
