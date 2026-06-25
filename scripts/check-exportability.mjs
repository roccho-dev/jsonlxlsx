#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const root = new URL('..', import.meta.url).pathname;
const denyhashes = JSON.parse(await readFile(join(root, 'scripts', 'denyhashes.json'), 'utf8'));
const denyLengths = [...new Set(denyhashes.map((entry) => entry.length))].sort((a, b) => a - b);
const denyByHash = new Map(denyhashes.map((entry) => [entry.sha256, entry.id]));

const tracked = spawnSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' });
if (tracked.status !== 0) {
  console.error(tracked.stderr || tracked.stdout);
  process.exit(tracked.status || 1);
}

const textExtensions = new Set([
  '.js', '.mjs', '.json', '.jsonl', '.md', '.txt', '.yml', '.yaml', '.lock'
]);
const textNames = new Set(['package.json', 'package-lock.json', '.gitignore']);

const files = tracked.stdout
  .split(/\r?\n/)
  .filter(Boolean)
  .filter((file) => textNames.has(file) || textExtensions.has(file.slice(file.lastIndexOf('.'))));

const hits = [];
const secretLike = /\b(?:api[_-]?key|access[_-]?key|secret|token|password|credential)s?\b\s*[:=]\s*["'][^"']{8,}["']/i;
const envPathLike = /(?:\/mnt\/|\/home\/|C:\\Users\\|[A-Za-z]:\\Users\\)/;
function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

for (const file of files) {
  if (!existsSync(join(root, file))) continue;
  const text = await readFile(join(root, file), 'utf8');
  for (const length of denyLengths) {
    for (let i = 0; i <= text.length - length; i++) {
      const id = denyByHash.get(sha256(text.slice(i, i + length)));
      if (id) hits.push(`${file}: contains denylisted token hash ${id}`);
    }
  }
  if (secretLike.test(text)) hits.push(`${file}: contains secret-like assignment`);
  if (envPathLike.test(text)) hits.push(`${file}: contains environment path`);
}

if (hits.length) {
  console.error(hits.join('\n'));
  process.exit(1);
}

console.log(`exportability OK: ${files.length} tracked text files scanned, ${denyhashes.length} deny hashes`);
