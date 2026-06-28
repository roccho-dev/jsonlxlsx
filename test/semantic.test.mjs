import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compileJsonlFile, extractSemantic, validateXlsx } from '../src/adapters/node/index.mjs';

async function writeJsonl(file, events) {
  await writeFile(file, events.map(e => JSON.stringify(e)).join('\n') + '\n', 'utf8');
}

test('semantic compile and decompile are runnable with styles/merge/table/validation', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'semantic-'));
  const jsonl = join(dir, 'design.jsonl');
  const xlsx = join(dir, 'out.xlsx');
  const extracted = join(dir, 'extracted.jsonl');
  const events = [
    { op: 'workbook.init', title: 'demo', created: '1980-01-01T00:00:00Z' },
    { op: 'sheet.upsert', sheet_id: 's', name: 'S' },
    { op: 'style.upsert', style_id: 'header', font: { bold: true, color: '#FFFFFF' }, fill: '#1F4E79' },
    { op: 'row.emit', sheet: 's', row: 1, values: [{ v: 'Name', style: 'header' }, { v: 'Amount', style: 'header' }] },
    { op: 'row.emit', sheet: 's', row: 2, values: ['A', 100] },
    { op: 'table.add', sheet: 's', name: 'T', range: 'A1:B2' },
    { op: 'data_validation.add', sheet: 's', range: 'A2:A10', type: 'list', values: ['A', 'B'] },
    { op: 'cell.set', sheet: 's', cell: 'D1', value: 'Merged' },
    { op: 'range.merge', sheet: 's', range: 'D1:E1' }
  ];
  await writeJsonl(jsonl, events);
  await compileJsonlFile(jsonl, xlsx, { now: '1980-01-01T00:00:00Z' });
  assert.deepEqual(await validateXlsx(xlsx), []);
  await extractSemantic(xlsx, extracted, { ts: '1980-01-01T00:00:00Z' });
  const text = await readFile(extracted, 'utf8');
  assert.match(text, /"op":"cell.set"/);
  assert.match(text, /"op":"style.upsert"/);
});

import { fileURLToPath } from 'node:url';
import { entriesToMap, parseSharedStrings, readZip, utf8Decode } from '../src/adapters/node/index.mjs';

const phoneticFixturePath = fileURLToPath(new URL('./fixtures/phonetic_rph_fixture.xlsx', import.meta.url));
const phoneticReadings = ['ALPHA_READING', 'BETA_READING', 'GAMMA_READING'];
const phoneticExpected = {
  A1: 'Synthetic Alpha Record',
  A2: 'Synthetic Beta List',
  A3: 'Synthetic Gamma Flow'
};

function jsonlEvents(text) {
  return text.trim().split(/\n+/).filter(Boolean).map(line => JSON.parse(line));
}

test('semantic extractor excludes rPh phonetic text from shared and inline string cell values', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'phonetic-js-'));
  const extracted = join(dir, 'phonetic.jsonl');
  const roundtrip = join(dir, 'phonetic.xlsx');

  const fixtureParts = entriesToMap(await readZip(await readFile(phoneticFixturePath)));
  assert.deepEqual(parseSharedStrings(fixtureParts), [phoneticExpected.A1, phoneticExpected.A2]);

  await extractSemantic(phoneticFixturePath, extracted, { ts: '1980-01-01T00:00:00Z' });
  const text = await readFile(extracted, 'utf8');
  for (const reading of phoneticReadings) assert.equal(text.includes(reading), false, `${reading} leaked into semantic JSONL`);

  const cells = Object.fromEntries(jsonlEvents(text).filter(e => e.op === 'cell.set').map(e => [e.cell, e.value]));
  assert.deepEqual(cells, phoneticExpected);

  await compileJsonlFile(extracted, roundtrip, { now: '1980-01-01T00:00:00Z' });
  assert.deepEqual(await validateXlsx(roundtrip), []);
  const roundtripParts = entriesToMap(await readZip(await readFile(roundtrip)));
  const xml = [...roundtripParts.entries()].filter(([path]) => path.endsWith('.xml')).map(([, data]) => utf8Decode(data)).join('\n');
  for (const reading of phoneticReadings) assert.equal(xml.includes(reading), false, `${reading} leaked into recompiled XLSX XML`);
  assert.equal(xml.includes('<rPh'), false, 'semantic recompile unexpectedly preserved phonetic runs');
});


test('semantic compiler accepts legacy semantic aliases and multi-range sqref', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'semantic-legacy-alias-'));
  const jsonl = join(dir, 'legacy-alias.jsonl');
  const out = join(dir, 'legacy-alias.xlsx');
  const events = [
    { op: 'workbook.init', title: 'legacy aliases' },
    { op: 'sheet.upsert', sheet_id: 's', name: 'Aliases' },
    { op: 'cell.set', sheet: 's', cell: 'A1', value: 'Name' },
    { op: 'cell.set', sheet: 's', cell: 'B1', value: 'Value' },
    { op: 'cell.set', sheet: 's', cell: 'A2', value: 'A' },
    { op: 'cell.set', sheet: 's', cell: 'B2', formula: '1+1', cached: 2, cached_type: 'number' },
    { op: 'sheet.auto_filter', sheet: 's', ref: 'A1:B2' },
    { op: 'data_validation.add', sheet: 's', sqref: 'A1:A2 C1:C2', rule: { type: 'list', formula1: '"A,B"' } },
    { op: 'conditional_format.add', sheet: 's', sqref: 'B2:B4 D2:D4', type: 'expression', formula: 'B2>0' }
  ];
  await writeJsonl(jsonl, events);
  await compileJsonlFile(jsonl, out, { now: '1980-01-01T00:00:00Z' });
  assert.deepEqual(await validateXlsx(out), []);

  const parts = entriesToMap(await readZip(await readFile(out)));
  const sheetXml = utf8Decode(parts.get('xl/worksheets/sheet1.xml'));
  assert.match(sheetXml, /<autoFilter ref="A1:B2"\/>/);
  assert.match(sheetXml, /<dataValidation[^>]*type="list"[^>]*sqref="A1:A2 C1:C2"|<dataValidation[^>]*sqref="A1:A2 C1:C2"[^>]*type="list"/);
  assert.match(sheetXml, /<conditionalFormatting sqref="B2:B4 D2:D4">/);
  assert.match(sheetXml, /<c r="B2"><f>1\+1<\/f><v>2<\/v><\/c>/);
});

test('semantic formula cells preserve cached result type, shared formula attrs, and extractor output', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'semantic-formula-'));
  const jsonl = join(dir, 'formula.jsonl');
  const out = join(dir, 'formula.xlsx');
  const extracted = join(dir, 'formula.extracted.jsonl');
  const events = [
    { op: 'workbook.init', title: 'formula cached values' },
    { op: 'sheet.upsert', sheet_id: 's', name: 'Formula' },
    { op: 'cell.set', sheet: 's', cell: 'A1', formula: 'CONCAT("a","b")', formula_attrs: { t: 'shared', ref: 'A1:A2', si: '0' }, cached_value: 'ab', cached_type: 'string' },
    { op: 'cell.set', sheet: 's', cell: 'A2', formula: '', formula_attrs: { t: 'shared', si: '0' }, cached_value: 'ac', cached_type: 'string' },
    { op: 'cell.set', sheet: 's', cell: 'B1', formula: '1=1', cached_value: true, cached_type: 'boolean' },
    { op: 'cell.set', sheet: 's', cell: 'C1', formula: 'NA()', cached_value: '#N/A', cached_type: 'error' }
  ];
  await writeJsonl(jsonl, events);
  await compileJsonlFile(jsonl, out, { now: '1980-01-01T00:00:00Z' });
  assert.deepEqual(await validateXlsx(out), []);

  const parts = entriesToMap(await readZip(await readFile(out)));
  const sheetXml = utf8Decode(parts.get('xl/worksheets/sheet1.xml'));
  assert.match(sheetXml, /<c r="A1" t="str"><f[^>]*t="shared"[^>]*si="0"[^>]*ref="A1:A2"[^>]*>CONCAT\("a","b"\)<\/f><v>ab<\/v><\/c>/);
  assert.match(sheetXml, /<c r="A2" t="str"><f[^>]*t="shared"[^>]*si="0"[^>]*\/><v>ac<\/v><\/c>/);
  assert.match(sheetXml, /<c r="B1" t="b"><f>1=1<\/f><v>1<\/v><\/c>/);
  assert.match(sheetXml, /<c r="C1" t="str"><f>NA\(\)<\/f><v>#N\/A<\/v><\/c>/);

  await extractSemantic(out, extracted, { ts: '1980-01-01T00:00:00Z' });
  const cells = Object.fromEntries(jsonlEvents(await readFile(extracted, 'utf8')).filter(e => e.op === 'cell.set').map(e => [e.cell, e]));
  assert.equal(cells.A1.formula, 'CONCAT("a","b")');
  assert.deepEqual(cells.A1.formula_attrs, { t: 'shared', ref: 'A1:A2', si: '0' });
  assert.equal(cells.A1.cached_value, 'ab');
  assert.equal(cells.A1.cached_type, 'string');
  assert.deepEqual(cells.A2.formula_attrs, { t: 'shared', si: '0' });
  assert.equal(cells.B1.cached_value, true);
  assert.equal(cells.B1.cached_type, 'bool');
  assert.equal(cells.C1.cached_value, '#N/A');
  assert.equal(cells.C1.cached_type, 'string');
});
