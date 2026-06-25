#!/usr/bin/env node
import { mkdir, mkdtemp, writeFile, readFile, copyFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import * as api from '../src/adapters/node/index.mjs';
import * as browserApi from '../src/adapters/browser/index.mjs';
import { utf8Decode, parseJsonlText } from '../src/core/index.mjs';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const OUT = join(ROOT, 'proof_outputs');
await mkdir(OUT, { recursive: true });

async function writeJsonl(file, events) {
  await writeFile(file, events.map(e => JSON.stringify(e)).join('\n') + '\n', 'utf8');
}

function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return h;
}

async function tryCompile(events, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'proof-'));
  const input = join(dir, 'input.jsonl');
  const output = join(dir, 'output.xlsx');
  await writeJsonl(input, events);
  try {
    const result = await api.compileJsonl(input, output, { now: '1980-01-01T00:00:00Z', ...options });
    const errors = await api.validateXlsx(output);
    if (errors.length) return { ok: false, message: errors.join('; ') };
    const keep = join(OUT, `proof_${Math.abs(hash(JSON.stringify(events))) % 10000000}.xlsx`);
    await copyFile(output, keep);
    return { ok: true, message: 'OK', output: keep, result };
  } catch (err) {
    return { ok: false, message: err.message };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const BASE = [
  { op: 'workbook.init', title: 'proof', created: '1980-01-01T00:00:00Z' },
  { op: 'sheet.upsert', sheet_id: 's', name: 'S' }
];
const longValues = Array.from({ length: 10 }, () => 'x'.repeat(50));

async function demoEvents() {
  return parseJsonlText(await readFile(join(ROOT, 'examples', 'demo_design.jsonl'), 'utf8'));
}

const cases = [
  ['duplicate sheet names are rejected', false, [{ op: 'sheet.upsert', sheet_id: 'a', name: 'S' }, { op: 'sheet.upsert', sheet_id: 'b', name: 'S' }], {}, /duplicate sheet name/i],
  ['duplicate sheet name rebuild: stable ID + new name', true, [{ op: 'sheet.upsert', sheet_id: 'a', name: 'S' }, { op: 'sheet.upsert', sheet_id: 'b', name: 'S2' }]],
  ['invalid sheet name rejected', false, [{ op: 'sheet.upsert', sheet_id: 'a', name: 'A/B' }], {}, /invalid sheet name/i],
  ['invalid sheet name rebuild: sanitize=true', true, [{ op: 'sheet.upsert', sheet_id: 'a', name: 'A/B', sanitize: true }]],
  ['unknown sheet reference rejected', false, [{ op: 'sheet.upsert', sheet_id: 's', name: 'S' }, { op: 'row.emit', sheet: 'missing', row: 1, values: ['x'] }], {}, /unknown sheet/i],
  ['unknown style rejected at save', false, [...BASE, { op: 'row.emit', sheet: 's', row: 1, values: [{ v: 'x', style: 'missing' }] }], {}, /unknown style_id/i],
  ['unknown style rebuild: append style.upsert before usage', true, [...BASE, { op: 'style.upsert', style_id: 'missing', fill: '#FFFFFF' }, { op: 'row.emit', sheet: 's', row: 1, values: [{ v: 'x', style: 'missing' }] }]],
  ['invalid color rejected', false, [...BASE, { op: 'style.upsert', style_id: 'bad', fill: '#GGGGGG' }, { op: 'row.emit', sheet: 's', row: 1, values: [{ v: 'x', style: 'bad' }] }], {}, /invalid RGB\/ARGB color/i],
  ['invalid color rebuild: legal RGB', true, [...BASE, { op: 'style.upsert', style_id: 'ok', fill: '#00FF00' }, { op: 'row.emit', sheet: 's', row: 1, values: [{ v: 'x', style: 'ok' }] }]],
  ['cyclic style inheritance rejected', false, [...BASE, { op: 'style.upsert', style_id: 'a', based_on: 'b' }, { op: 'style.upsert', style_id: 'b', based_on: 'a' }, { op: 'row.emit', sheet: 's', row: 1, values: [{ v: 'x', style: 'a' }] }], {}, /cyclic style/i],
  ['cyclic style rebuild: append non-cyclic style definition', true, [...BASE, { op: 'style.upsert', style_id: 'a', based_on: 'b' }, { op: 'style.upsert', style_id: 'b', based_on: 'a' }, { op: 'style.upsert', style_id: 'a', mode: 'replace', fill: '#FFFFFF' }, { op: 'row.emit', sheet: 's', row: 1, values: [{ v: 'x', style: 'a' }] }]],
  ['overlapping merge rejected', false, [...BASE, { op: 'range.merge', sheet: 's', range: 'A1:B1' }, { op: 'range.merge', sheet: 's', range: 'B1:C1' }], {}, /overlaps existing merge/i],
  ['overlapping merge rebuild: unmerge then merge', true, [...BASE, { op: 'range.merge', sheet: 's', range: 'A1:B1' }, { op: 'range.unmerge', sheet: 's', range: 'A1:B1' }, { op: 'range.merge', sheet: 's', range: 'B1:C1' }]],
  ['merge covering non-empty cell rejected', false, [...BASE, { op: 'row.emit', sheet: 's', row: 1, values: ['a', 'b'] }, { op: 'range.merge', sheet: 's', range: 'A1:B1' }], {}, /cover non-empty/i],
  ['covered merge rebuild: clear covered cell then merge', true, [...BASE, { op: 'row.emit', sheet: 's', row: 1, values: ['a', 'b'] }, { op: 'cell.clear', sheet: 's', cell: 'B1', keep_style: false }, { op: 'range.merge', sheet: 's', range: 'A1:B1' }]],
  ['A1 reference beyond XFD rejected', false, [...BASE, { op: 'cell.set', sheet: 's', cell: 'XFE1', value: 'bad' }], {}, /column out of Excel bounds/i],
  ['row beyond Excel max rejected', false, [...BASE, { op: 'row.emit', sheet: 's', row: 1048577, values: ['bad'] }], {}, /row out of Excel bounds/i],
  ['data validation literal >255 rejected', false, [...BASE, { op: 'data_validation.add', sheet: 's', range: 'A1:A2', type: 'list', values: longValues }], {}, /255/],
  ['data validation rebuild: use formula range', true, [...BASE, { op: 'data_validation.add', sheet: 's', range: 'A1:A2', type: 'list', formula1: 'Lists!$A$1:$A$20' }]],
  ['huge range style guard trips', false, [...BASE, { op: 'style.upsert', style_id: 'x', fill: '#FFFFFF' }, { op: 'range.style', sheet: 's', range: 'A1:XFD1000', style: 'x' }], {}, /would materialize/i],
  ['huge range rebuild: column default style', true, [...BASE, { op: 'style.upsert', style_id: 'x', fill: '#FFFFFF' }, { op: 'column.set', sheet: 's', col: 'A', to_col: 'XFD', style: 'x' }]],
  ['duplicate table names rejected', false, [...BASE, { op: 'row.emit', sheet: 's', row: 1, values: ['h'] }, { op: 'row.emit', sheet: 's', row: 2, values: [1] }, { op: 'table.add', sheet: 's', name: 'T', range: 'A1:A2' }, { op: 'sheet.upsert', sheet_id: 's2', name: 'S2' }, { op: 'row.emit', sheet: 's2', row: 1, values: ['h'] }, { op: 'row.emit', sheet: 's2', row: 2, values: [1] }, { op: 'table.add', sheet: 's2', name: 'T', range: 'A1:A2' }], {}, /duplicate table name/i],
  ['duplicate table rebuild: unique names', true, [...BASE, { op: 'row.emit', sheet: 's', row: 1, values: ['h'] }, { op: 'row.emit', sheet: 's', row: 2, values: [1] }, { op: 'table.add', sheet: 's', name: 'T1', range: 'A1:A2' }, { op: 'sheet.upsert', sheet_id: 's2', name: 'S2' }, { op: 'row.emit', sheet: 's2', row: 1, values: ['h'] }, { op: 'row.emit', sheet: 's2', row: 2, values: [1] }, { op: 'table.add', sheet: 's2', name: 'T2', range: 'A1:A2' }]],
  ['one-row table rejected', false, [...BASE, { op: 'row.emit', sheet: 's', row: 1, values: ['h'] }, { op: 'table.add', sheet: 's', name: 'T', range: 'A1:A1' }], {}, /at least one data row/i],
  ['literal string beginning = is not formula', true, [...BASE, { op: 'row.emit', sheet: 's', row: 1, values: ['=literal', { f: '1+1' }] }]],
  ['raw OOXML part escape hatch rejected', false, [...BASE, { op: 'raw_part.upsert', part: 'xl/custom.xml', content: '<x/>' }], {}, /unknown op|shape validation/],
  ['package mode compile option rejected', false, [...BASE, { op: 'row.emit', sheet: 's', row: 1, values: ['x'] }], { mode: 'package' }, /package mode has been removed/],
  ['semantic zip method 8 through node port', true, [...BASE, { op: 'row.emit', sheet: 's', row: 1, values: ['deflate'] }], { zipMethod: 8 }],
  ['final demo semantic XML/ZIP validation', true, await demoEvents(), { historySheet: '_jsonl_history' }]
];

async function postChecks(name, output) {
  if (!output) return true;
  const entries = await api.readZip(await readFile(output));
  const map = Object.fromEntries(entries.map(e => [e.path, utf8Decode(e.data)]));
  if (name === 'literal string beginning = is not formula') {
    const dir = await mkdtemp(join(tmpdir(), 'literal-proof-'));
    const extracted = join(dir, 'literal.jsonl');
    await api.extractXlsx(output, extracted, { mode: 'semantic', ts: '1980-01-01T00:00:00Z' });
    const events = parseJsonlText(await readFile(extracted, 'utf8'));
    return events.some(e => e.cell === 'A1' && e.value === '=literal' && e.formula === undefined) && events.some(e => e.cell === 'B1' && e.formula === '1+1');
  }
  if (name === 'final demo semantic XML/ZIP validation') return map['xl/workbook.xml'].includes('_jsonl_history') && map['xl/workbook.xml'].includes('state="hidden"') && Object.keys(map).some(k => k.startsWith('xl/tables/table'));
  return true;
}

const rows = [];
let okAll = true;
for (let i = 0; i < cases.length; i++) {
  const [name, expectOk, events, options = {}, contains] = cases[i];
  const r = await tryCompile(events, options);
  let passed = expectOk ? r.ok : !r.ok;
  if (contains && !contains.test(r.message)) passed = false;
  if (passed && expectOk && !(await postChecks(name, r.output))) { passed = false; r.message = 'post check failed'; }
  rows.push([i + 1, name, expectOk ? 'OK' : 'FAIL', passed ? 'PASS' : 'FAIL', r.message]);
  okAll = okAll && passed;
}

try {
  const sourceXlsx = join(OUT, 'demo_semantic.xlsx');
  const extracted = join(OUT, 'demo_semantic_extracted.jsonl');
  const roundtrip = join(OUT, 'demo_semantic_roundtrip.xlsx');
  await api.compileJsonl(join(ROOT, 'examples', 'demo_design.jsonl'), sourceXlsx, { mode: 'semantic', historySheet: '_jsonl_history', now: '1980-01-01T00:00:00Z' });
  await api.extractXlsx(sourceXlsx, extracted, { mode: 'semantic', ts: '1980-01-01T00:00:00Z' });
  const extractedText = await readFile(extracted, 'utf8');
  if (extractedText.includes('package.')) throw new Error('semantic extract emitted package event');
  await api.compileJsonl(extracted, roundtrip, { mode: 'semantic', now: '1980-01-01T00:00:00Z' });
  const errors = await api.validateXlsx(roundtrip);
  rows.push([rows.length + 1, 'semantic extract -> compile produces valid editable xlsx', 'OK', errors.length ? 'FAIL' : 'PASS', errors.length ? errors.join('; ') : 'OK']);
  okAll = okAll && errors.length === 0;
} catch (err) {
  rows.push([rows.length + 1, 'semantic extract -> compile produces valid editable xlsx', 'OK', 'FAIL', err.message]);
  okAll = false;
}

try {
  const sourceXlsx = join(OUT, 'demo_semantic.xlsx');
  const rejected = join(OUT, 'demo_rejected_package.jsonl');
  await api.extractXlsx(sourceXlsx, rejected, { mode: 'package', ts: '1980-01-01T00:00:00Z' });
  rows.push([rows.length + 1, 'package extract mode is unavailable', 'FAIL', 'FAIL', 'unexpected success']);
  okAll = false;
} catch (err) {
  const passed = /package mode has been removed/.test(err.message);
  rows.push([rows.length + 1, 'package extract mode is unavailable', 'FAIL', passed ? 'PASS' : 'FAIL', err.message]);
  okAll = okAll && passed;
}

try {
  const jsonl = [
    { op: 'workbook.init', title: 'browser proof', created: '1980-01-01T00:00:00Z' },
    { op: 'sheet.upsert', sheet_id: 's', name: 'Browser' },
    { op: 'row.emit', sheet: 's', row: 1, values: ['browser', 1] }
  ].map(e => JSON.stringify(e)).join('\n') + '\n';
  const bytes = await browserApi.compileJsonlText(jsonl, { now: '1980-01-01T00:00:00Z', zipMethod: 8 });
  const errors = await browserApi.validateXlsxBytes(bytes);
  const semantic = await browserApi.extractXlsxJsonl(bytes, { mode: 'semantic', ts: '1980-01-01T00:00:00Z' });
  if (semantic.includes('package.')) throw new Error('browser semantic extract emitted package event');
  const rt = await browserApi.compileJsonlText(semantic, { mode: 'semantic', now: '1980-01-01T00:00:00Z' });
  const rtErrors = await browserApi.validateXlsxBytes(rt);
  const passed = errors.length === 0 && rtErrors.length === 0;
  rows.push([rows.length + 1, 'browser adapter semantic extract/compile validation', 'OK', passed ? 'PASS' : 'FAIL', passed ? 'OK' : `${errors.concat(rtErrors).join('; ')}`]);
  okAll = okAll && passed;
} catch (err) {
  rows.push([rows.length + 1, 'browser adapter semantic extract/compile validation', 'OK', 'FAIL', err.message]);
  okAll = false;
}

const lines = [
  '# Portable JS JSONL ⇄ XLSX proof report',
  '',
  `総合結果: **${okAll ? 'PASS' : 'FAIL'}**`,
  '',
  'Core is environment-independent. Node and browser adapters are tested through the same public operations.',
  '',
  '| # | ケース | 期待 | 結果 | メッセージ |',
  '|---:|---|---|---|---|'
];
for (const [no, name, expect, result, msg] of rows) lines.push(`| ${no} | ${name} | ${expect} | ${result} | ${String(msg).replace(/\|/g, '\\|').replace(/\n/g, ' ')} |`);
await writeFile(join(OUT, 'proof_report.md'), lines.join('\n') + '\n', 'utf8');
console.log(join(OUT, 'proof_report.md'));
console.log(okAll ? 'PASS' : 'FAIL');
process.exit(okAll ? 0 : 1);
