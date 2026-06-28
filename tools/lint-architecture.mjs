#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const cToken = 'cl' + 'ass';
const checkedRoots = ['src', 'test', 'tools', 'package.json'];
const externalHints = ['excel' + 'js', 'js' + 'zip', 'xlsx-populate', 'libre' + 'office', 'open' + 'pyxl', 'py' + 'thon'];
const nodeImport = /from ['"]node:/;
const nodeGlobals = /\bBuffer\b|\bprocess\b|\b__dirname\b|\b__filename\b/;
const browserGlobals = /\bwindow\s*\.|\bdocument\s*\.|\bBlob\b|\bFile\b|\bURL\.createObjectURL\b/;

function filesOf(target, out = []) {
  const p = join(root, target);
  const st = statSync(p);
  if (st.isFile()) {
    if (/\.(mjs|js|json)$/.test(p)) out.push(p);
    return out;
  }
  for (const name of readdirSync(p)) {
    const next = join(p, name);
    const ns = statSync(next);
    if (ns.isDirectory()) filesOf(relative(root, next), out);
    else if (/\.(mjs|js|json)$/.test(next)) out.push(next);
  }
  return out;
}

const errors = [];
const files = checkedRoots.flatMap(x => filesOf(x));
for (const file of files) {
  const rel = relative(root, file);
  const text = readFileSync(file, 'utf8');
  const compact = text.replace(/cl\s*\+\s*['"]ass['"]/g, 'split-token');
  if (new RegExp(`\\b${cToken}\\b`).test(compact)) errors.push(`${rel}: forbidden token ${cToken}`);
  if (/require\s*\(/.test(text)) errors.push(`${rel}: CommonJS require is forbidden`);
  if (/module\.exports|exports\./.test(text)) errors.push(`${rel}: CommonJS export is forbidden`);
  if (!rel.startsWith('tools/')) {
    for (const hint of externalHints) {
      const re = new RegExp(hint, 'i');
      if (re.test(text)) errors.push(`${rel}: forbidden dependency hint ${hint}`);
    }
  }

  const isCore = rel.startsWith('src/core/');
  const isPortContract = rel.startsWith('src/ports/');
  const isNodeAdapter = rel.startsWith('src/adapters/node/') || rel.startsWith('src/adapters/cli/');
  const isBrowserAdapter = rel.startsWith('src/adapters/browser/');
  const isAdapter = rel.startsWith('src/adapters/');

  if ((isCore || isPortContract) && nodeImport.test(text)) errors.push(`${rel}: node import inside core/port contract`);
  if ((isCore || isPortContract) && nodeGlobals.test(text)) errors.push(`${rel}: node global inside core/port contract`);
  if ((isCore || isPortContract) && browserGlobals.test(text)) errors.push(`${rel}: browser global inside core/port contract`);
  if ((isCore || isPortContract) && /from ['"]\.\.\/adapters\//.test(text)) errors.push(`${rel}: core/port must not import adapters`);
  if (isCore && /from ['"]\.\.\/ports\//.test(text)) errors.push(`${rel}: core must not import port contracts`);
  if (isCore && /\bDate\.now\b|\bMath\.random\b|new Date\s*\(\s*\)/.test(text)) errors.push(`${rel}: ambient runtime access in core`);

  if (isBrowserAdapter && nodeImport.test(text)) errors.push(`${rel}: node import inside browser adapter`);
  if (isBrowserAdapter && /\bBuffer\b/.test(text)) errors.push(`${rel}: Buffer usage inside browser adapter`);
  if (isBrowserAdapter && /\bfs\b|\bpath\b|\bzlib\b|\bos\b/.test(text) && !/globalThis\.crypto/.test(text)) errors.push(`${rel}: browser adapter may not depend on node names`);

  if (rel.startsWith('src/') && !isNodeAdapter && nodeImport.test(text)) errors.push(`${rel}: node import must stay in node/cli adapter`);
  if (rel.startsWith('src/') && !isAdapter && /from ['"]\.\.?\/adapters\//.test(text)) errors.push(`${rel}: adapter import must stay outside core/ports`);
}

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const deps = Object.keys(pkg.dependencies || {});
const devDeps = Object.keys(pkg.devDependencies || {});
if (devDeps.length) errors.push('package.json: devDependencies must be empty');
if (deps.length !== 1 || deps[0] !== 'hucre') errors.push('package.json: dependencies must contain hucre only');
if (pkg.main !== './src/core/index.mjs') errors.push('package.json: main must be pure core');
if (pkg.bin && Object.values(pkg.bin).some(v => !String(v).startsWith('./src/adapters/cli/'))) errors.push('package.json: CLI bin must live under src/adapters/cli');
if (pkg.exports && (pkg.exports['./node'] || pkg.exports['./browser'])) errors.push('package.json: use explicit ./adapters/node and ./adapters/browser exports');

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`architecture lint OK: ${files.length} files, no forbidden token, lib core is adapter-free, cli is an adapter, hucre is the sole runtime backend dependency`);
