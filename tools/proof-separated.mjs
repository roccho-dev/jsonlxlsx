#!/usr/bin/env node
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import * as api from '../src/adapters/node/index.mjs';
import * as browserApi from '../src/adapters/browser/index.mjs';
import {
  assertSeparatedLayers,
  base64Encode,
  cellRef,
  colToIndex,
  composeSeparatedLayers,
  splitEventsToLayeredEvents,
  stringifyJsonl,
  utf8Decode,
  utf8Encode,
  validateSeparatedLayers
} from '../src/core/index.mjs';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const OUT = join(ROOT, 'proof_outputs', 'complete-separation');
await mkdir(OUT, { recursive: true });

function designBase() {
  return [
    { seq: 1, op: 'layer.declare', layer: 'design', schema: 'jsonl-xlsx-separated', version: '1.0' },
    { seq: 2, op: 'workbook.init', title: 'separation proof', created: '1980-01-01T00:00:00Z' },
    { seq: 3, op: 'sheet.upsert', sheet_id: 's', name: 'S' },
    { seq: 4, op: 'style.upsert', style_id: 'head', font: { bold: true, color: '#FFFFFF' }, fill: '#1F4E79' },
    { seq: 5, op: 'column.set', sheet: 's', from_col: 'A', to_col: 'C', width: 16 },
    { seq: 6, op: 'cell.style', sheet: 's', cell: 'A1', style: 'head' },
    { seq: 7, op: 'cell.style', sheet: 's', cell: 'B1', style: 'head' },
    { seq: 8, op: 'range.merge', sheet: 's', range: 'A4:B4' }
  ];
}

function valueBase() {
  return [
    { seq: 1, op: 'layer.declare', layer: 'values', schema: 'jsonl-xlsx-separated', version: '1.0' },
    { seq: 2, op: 'row.values', sheet: 's', row: 1, values: ['Name', 'Amount'] },
    { seq: 3, op: 'row.values', sheet: 's', row: 2, values: ['A', 100] },
    { seq: 4, op: 'cell.value.set', sheet: 's', cell: 'A4', value: 'Merged' }
  ];
}

function assetBase() {
  const textBoxXml = [
    '<xdr:twoCellAnchor xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" editAs="oneCell">',
    '<xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>5</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>',
    '<xdr:to><xdr:col>1</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>8</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>',
    '<xdr:sp><xdr:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>shape proof</a:t></a:r></a:p></xdr:txBody></xdr:sp>',
    '<xdr:clientData/>',
    '</xdr:twoCellAnchor>'
  ].join('');
  return [
    { seq: 1, op: 'layer.declare', layer: 'assets', schema: 'jsonl-xlsx-separated', version: '1.0' },
    { seq: 2, op: 'asset.drawing.element', layer: 'assets', sheet: 's', asset_id: 'shape_1', raw_xml_b64: base64Encode(utf8Encode(textBoxXml)) }
  ];
}

function asJsonl(events) {
  return stringifyJsonl(events || []);
}

async function writeJsonl(path, events) {
  await writeFile(path, asJsonl(events), 'utf8');
}

async function compileSeparated(design, values, assets, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'separated-proof-'));
  const d = join(dir, 'design.jsonl');
  const v = join(dir, 'values.jsonl');
  const a = join(dir, 'assets.jsonl');
  const out = join(dir, 'out.xlsx');
  try {
    await writeJsonl(d, design || []);
    await writeJsonl(v, values || []);
    if (assets) await writeJsonl(a, assets);
    const result = await api.compileSeparatedFiles({ design: d, values: v, assets: assets ? a : undefined }, out, { now: '1980-01-01T00:00:00Z', ...options });
    const errors = await api.validateXlsx(out);
    if (errors.length) throw new Error(errors.join('; '));
    const entries = await api.readZip(await readFile(out));
    return { out, result, entries };
  } finally {
    if (!options.keepTmp) await rm(dir, { recursive: true, force: true });
  }
}

async function expectReject(name, fn, pattern) {
  try {
    await fn();
    return [name, 'reject', 'FAIL', 'unexpected pass'];
  } catch (err) {
    const message = err.message || String(err);
    return [name, 'reject', !pattern || pattern.test(message) ? 'PASS' : 'FAIL', message];
  }
}

async function expectPass(name, fn, check = () => true) {
  try {
    const result = await fn();
    const ok = await check(result);
    return [name, 'pass', ok ? 'PASS' : 'FAIL', ok ? 'OK' : 'post check failed'];
  } catch (err) {
    return [name, 'pass', 'FAIL', err.message || String(err)];
  }
}

function entriesAsText(entries) {
  return Object.fromEntries(entries.map(e => [e.path, utf8Decode(e.data)]));
}

const rows = [];
rows.push(await expectReject('design rejects value-bearing cell.set', () => compileSeparated([...designBase(), { op: 'cell.set', sheet: 's', cell: 'C1', value: 'leak' }], valueBase()), /not a design op|value\/formula payload/s));
rows.push(await expectReject('design rejects row pattern value payload', () => compileSeparated([...designBase(), { op: 'row_pattern.upsert', pattern_id: 'p', cells: [{ col: 'A', value: 'leak' }] }], valueBase()), /row_pattern.*value/s));
rows.push(await expectReject('design rejects row.emit mixed shorthand', () => compileSeparated([...designBase(), { op: 'row.emit', sheet: 's', row: 9, values: ['mixed'] }], valueBase()), /not a design op|value payload/s));
rows.push(await expectReject('design rejects asset op', () => { assertSeparatedLayers({ design: [...designBase(), { op: 'asset.drawing.element', sheet: 's', asset_id: 'x', raw_xml_b64: 'PHg+PC94Pg==' }], values: valueBase(), assets: [] }); }, /asset op|design layer/s));
rows.push(await expectReject('design rejects package part escape hatch', () => compileSeparated([...designBase(), { op: 'package.part', path: 'xl/custom.xml', data_b64: 'AA==' }], valueBase()), /not a design op|shape validation/s));
rows.push(await expectReject('values rejects style definition', () => compileSeparated(designBase(), [...valueBase(), { op: 'style.upsert', style_id: 'bad', fill: '#FFFFFF' }]), /not a values op/s));
rows.push(await expectReject('values rejects style-bearing cell.set', () => compileSeparated(designBase(), [...valueBase(), { op: 'cell.set', sheet: 's', cell: 'C1', value: 'x', style: 'head' }]), /must not contain style|not a values op/s));
rows.push(await expectReject('values rejects pattern on row.values', () => compileSeparated(designBase(), [...valueBase(), { op: 'row.values', sheet: 's', row: 3, pattern: 'p', values: ['x'] }]), /pattern\/style\/cells/s));
rows.push(await expectReject('values rejects row item hyperlink', () => { assertSeparatedLayers({ design: designBase(), values: [{ op: 'row.values', sheet: 's', row: 1, values: [{ v: 'x', hyperlink: { target: 'https://example.invalid' } }] }], assets: [] }); }, /hyperlink/s));
rows.push(await expectReject('values rejects merge operation', () => compileSeparated(designBase(), [...valueBase(), { op: 'range.merge', sheet: 's', range: 'A7:B7' }]), /not a values op/s));
rows.push(await expectReject('values rejects covered merged cell writes', () => { const errors = validateSeparatedLayers({ design: designBase(), values: [...valueBase(), { op: 'cell.value.set', sheet: 's', cell: 'B4', value: 'covered' }], assets: [] }); if (errors.length) throw new Error(errors.join('; ')); }, /covered merged cell|merge/s));
rows.push(await expectReject('assets rejects style operation', () => compileSeparated(designBase(), valueBase(), [...assetBase(), { op: 'style.upsert', style_id: 'bad', fill: '#FFFFFF' }]), /not an assets op/s));
rows.push(await expectReject('assets rejects value payload', () => { assertSeparatedLayers({ design: designBase(), values: valueBase(), assets: [{ op: 'asset.drawing.element', sheet: 's', asset_id: 'x', raw_xml_b64: 'PHg+PC94Pg==', value: 'leak' }] }); }, /value\/formula payload|value/s));
rows.push(await expectReject('assets rejects legacy drawing.raw', () => compileSeparated(designBase(), valueBase(), [{ op: 'drawing.raw', sheet: 's', raw_xml_b64: assetBase()[1].raw_xml_b64 }]), /not an assets op|legacy drawing/s));
rows.push(await expectReject('assets rejects drawing without asset_id', () => compileSeparated(designBase(), valueBase(), [{ op: 'asset.drawing.element', sheet: 's', raw_xml_b64: assetBase()[1].raw_xml_b64 }]), /requires asset_id|shape validation/s));
rows.push(await expectReject('assets rejects raw part escape hatch', () => compileSeparated(designBase(), valueBase(), [{ op: 'raw_part.upsert', part: 'xl/custom.xml', content: '<x/>' }]), /not an assets op|shape validation/s));
rows.push(await expectReject('assets rejects media path outside xl/media', () => compileSeparated(designBase(), valueBase(), [{ op: 'asset.media.part', path: 'xl/theme/theme1.xml', data_b64: 'AA==' }]), /xl\/media|media path|shape validation/s));
rows.push(await expectPass('independent append-only seq streams are renumbered safely', () => compileSeparated(designBase(), valueBase()), r => r.result.design_events === designBase().length && r.result.value_events === valueBase().length));
rows.push(await expectPass('design plus values generate valid workbook', () => compileSeparated(designBase(), valueBase())));
rows.push(await expectReject('values-only stream cannot rebuild workbook body', () => compileSeparated([], valueBase()), /unknown sheet|no sheet/s));
rows.push(await expectPass('design-only stream is valid empty-body template', () => compileSeparated(designBase(), [])));
rows.push(await expectPass('no assets means no drawing part', () => compileSeparated(designBase(), valueBase()), r => !r.entries.some(e => e.path.startsWith('xl/drawings/'))));
rows.push(await expectPass('asset layer adds drawing part only when supplied', () => compileSeparated(designBase(), valueBase(), assetBase()), r => r.entries.some(e => e.path === 'xl/drawings/drawing1.xml')));
rows.push(await expectPass('cell.value.clear removes value but preserves style', () => compileSeparated([...designBase(), { op: 'cell.style', sheet: 's', cell: 'C1', style: 'head' }], [...valueBase(), { op: 'cell.value.set', sheet: 's', cell: 'C1', value: 'delete me' }, { op: 'cell.value.clear', sheet: 's', cell: 'C1' }]), r => { const xml = entriesAsText(r.entries)['xl/worksheets/sheet1.xml']; return /<c r="C1" s="\d+"\/>/.test(xml) && !xml.includes('delete me'); }));
rows.push(await expectPass('formula values are allowed in values layer', () => compileSeparated(designBase(), [...valueBase(), { op: 'cell.formula.set', sheet: 's', cell: 'C2', formula: 'B2*2', cached_value: 200 }]), r => entriesAsText(r.entries)['xl/worksheets/sheet1.xml'].includes('<f>B2*2</f>')));
rows.push(await expectReject('unknown design style still fails at workbook render', () => compileSeparated([...designBase(), { op: 'cell.style', sheet: 's', cell: 'C1', style: 'missing' }], valueBase()), /unknown style_id/s));
rows.push(await expectPass('split mixed event into design style and value body', async () => { const split = api.splitEventsByLayer([{ op: 'workbook.init', title: 'x' }, { op: 'sheet.upsert', sheet_id: 's', name: 'S' }, { op: 'cell.set', sheet: 's', cell: 'A1', style: 'head', value: 'body' }]); if (!split.design.some(e => e.op === 'cell.style') || !split.values.some(e => e.op === 'cell.value.set')) throw new Error('split missing expected events'); return split; }));
rows.push(await expectPass('split mixed row.emit into design row and row.values', () => { const split = splitEventsToLayeredEvents([...designBase(), { op: 'row.emit', sheet: 's', row: 10, pattern: 'p', values: ['x'] }]); return split.design.some(e => e.op === 'row.emit' && e.values === undefined) && split.values.some(e => e.op === 'row.values'); }));
rows.push(await expectPass('compose renumbers independent streams', () => composeSeparatedLayers({ design: [{ ...designBase()[1], seq: 10 }, { ...designBase()[2], seq: 20 }], values: [{ ...valueBase()[1], seq: 1 }], assets: [] }).every((e, i) => e.seq === i + 1)));
rows.push(await expectPass('browser adapter compiles separated streams', async () => { const bytes = await browserApi.compileSeparatedJsonl({ design: asJsonl(designBase()), values: asJsonl(valueBase()) }, { now: '1980-01-01T00:00:00Z', zipMethod: 8 }); const errors = await browserApi.validateXlsxBytes(bytes); if (errors.length) throw new Error(errors.join('; ')); return { bytes }; }));
rows.push(await expectPass('CLI style split then compile layer APIs', async () => { const dir = await mkdtemp(join(tmpdir(), 'separation-cli-')); try { const combined = join(dir, 'combined.jsonl'); const layerDir = join(dir, 'layers'); const out = join(dir, 'out.xlsx'); await mkdir(layerDir, { recursive: true }); await writeFile(combined, asJsonl([{ op: 'workbook.init', title: 'x' }, { op: 'sheet.upsert', sheet_id: 's', name: 'S' }, { op: 'style.upsert', style_id: 'head', fill: '#FFFFFF' }, { op: 'cell.set', sheet: 's', cell: 'A1', value: 'x', style: 'head' }]), 'utf8'); await api.splitJsonlLayers(combined, layerDir); await api.compileJsonlLayers(join(layerDir, 'design.jsonl'), join(layerDir, 'values.jsonl'), out, { assets: join(layerDir, 'assets.jsonl'), now: '1980-01-01T00:00:00Z' }); const errors = await api.validateXlsx(out); return errors.length === 0; } finally { await rm(dir, { recursive: true, force: true }); } }));
rows.push(await expectPass('semantic extraction writes separate files and recompiles', async () => { const compiled = await compileSeparated(designBase(), valueBase(), null, { keepTmp: true }); const dir = await mkdtemp(join(tmpdir(), 'split-proof-')); const d = join(dir, 'design.jsonl'); const v = join(dir, 'values.jsonl'); await api.extractSeparated(compiled.out, { design: d, values: v }, { ts: '1980-01-01T00:00:00Z' }); const dText = await readFile(d, 'utf8'); const vText = await readFile(v, 'utf8'); if (dText.includes('Merged') || dText.includes('Name')) throw new Error('value leaked into design split'); if (!vText.includes('cell.value.set') && !vText.includes('row.values')) throw new Error('value layer missing values'); const out2 = join(dir, 'roundtrip.xlsx'); await api.compileSeparatedFiles({ design: d, values: v }, out2, { now: '1980-01-01T00:00:00Z' }); return { out: out2 }; }));
rows.push(await expectPass('formula cached alias and multi-range sqref survive separated compile', async () => {
  const compiled = await compileSeparated(
    [
      ...designBase(),
      { op: 'sheet.auto_filter', sheet: 's', ref: 'A1:B2' },
      { op: 'data_validation.add', sheet: 's', sqref: 'A1:A2 C1:C2', rule: { type: 'list', formula1: '"A,B"' } }
    ],
    [
      ...valueBase(),
      { op: 'cell.formula.set', sheet: 's', cell: 'C2', formula: 'CONCAT("a","b")', cached: 'ab', cached_type: 'string' },
      { op: 'cell.formula.set', sheet: 's', cell: 'C3', formula: '1=1', cached_value: true, cached_type: 'boolean' }
    ]
  );
  const xml = entriesAsText(compiled.entries)['xl/worksheets/sheet1.xml'];
  return xml.includes('<dataValidation sqref="A1:A2 C1:C2"') && xml.includes('<c r="C2" t="str"><f>CONCAT(&quot;a&quot;,&quot;b&quot;)</f><v>ab</v></c>') && xml.includes('<c r="C3" t="b"><f>1=1</f><v>1</v></c>');
}));
rows.push(await expectPass('phonetic readings do not leak after split', async () => { const fixture = join(ROOT, 'test', 'fixtures', 'phonetic_rph_fixture.xlsx'); const dir = await mkdtemp(join(tmpdir(), 'phonetic-split-')); const d = join(dir, 'design.jsonl'); const v = join(dir, 'values.jsonl'); await api.extractSeparated(fixture, { design: d, values: v }, { ts: '1980-01-01T00:00:00Z' }); const all = `${await readFile(d, 'utf8')}\n${await readFile(v, 'utf8')}`; for (const word of ['ALPHA_READING', 'BETA_READING', 'GAMMA_READING']) if (all.includes(word)) throw new Error(`${word} leaked`); return { d, v }; }));

const okAll = rows.every(r => r[2] === 'PASS');
const report = [
  '# Complete design / values / assets separation proof',
  '',
  `総合結果: **${okAll ? 'PASS' : 'FAIL'}**`,
  '',
  'Design / values / assets are validated as separate append-only streams before composition.',
  '',
  '## 破綻・破壊ケースと実行結果',
  '',
  '| # | 破壊ケース / 実証 | 期待 | 結果 | メッセージ |',
  '|---:|---|---|---|---|',
  ...rows.map((r, i) => `| ${i + 1} | ${r[0]} | ${r[1]} | ${r[2]} | ${String(r[3]).replace(/\|/g, '\\|').replace(/\n/g, ' ')} |`)
];
await writeFile(join(OUT, 'complete_separation_proof_report.md'), report.join('\n') + '\n', 'utf8');
console.log(join(OUT, 'complete_separation_proof_report.md'));
console.log(okAll ? 'PASS' : 'FAIL');
process.exit(okAll ? 0 : 1);
