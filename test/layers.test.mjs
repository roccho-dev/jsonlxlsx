import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as core from '../src/core/index.mjs';
import * as nodeApi from '../src/adapters/node/index.mjs';
import * as browserApi from '../src/adapters/browser/index.mjs';

const design = [
  { op: 'schema.declare', layer: 'design', schema: 'jsonl-xlsx', mode: 'design' },
  { op: 'workbook.init', title: 'layers', created: '1980-01-01T00:00:00Z' },
  { op: 'sheet.upsert', sheet_id: 's', name: 'S' },
  { op: 'style.upsert', style_id: 'header', fill: '#EEEEEE', font: { bold: true } },
  { op: 'cell.style', sheet: 's', cell: 'A1', style: 'header' },
  { op: 'cell.style', sheet: 's', cell: 'B1', style: 'header' },
  { op: 'range.merge', sheet: 's', range: 'A3:B3' }
];
const values = [
  { op: 'schema.declare', layer: 'values', schema: 'jsonl-xlsx', mode: 'values' },
  { op: 'row.values', sheet: 's', row: 1, values: ['Name', 'Amount'] },
  { op: 'row.values', sheet: 's', row: 2, values: ['A', 100] },
  { op: 'cell.value.set', sheet: 's', cell: 'A3', value: 'Merged' }
];
const drawingElement = '<xdr:twoCellAnchor xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><xdr:from><xdr:col>0</xdr:col><xdr:row>4</xdr:row></xdr:from><xdr:to><xdr:col>2</xdr:col><xdr:row>7</xdr:row></xdr:to><xdr:sp><xdr:nvSpPr><xdr:cNvPr id="2" name="Text Box 1"/><xdr:cNvSpPr txBox="1"/></xdr:nvSpPr><xdr:txBody><a:bodyPr/><a:p><a:r><a:t>Text Box</a:t></a:r></a:p></xdr:txBody></xdr:sp><xdr:clientData/></xdr:twoCellAnchor>';
const assets = [
  { op: 'schema.declare', layer: 'assets', schema: 'jsonl-xlsx', mode: 'assets' },
  { op: 'asset.drawing.element', layer: 'assets', sheet: 's', asset_id: 'shape_1', raw_xml_b64: core.base64Encode(core.utf8Encode(drawingElement)) }
];

async function writeJsonl(file, events) {
  await writeFile(file, events.map(e => JSON.stringify(e)).join('\n') + '\n', 'utf8');
}

test('mixed semantic cell.set splits into design style and value body', () => {
  const split = core.splitEventsByLayer([
    { op: 'workbook.init', title: 'x' },
    { op: 'sheet.upsert', sheet_id: 's', name: 'S' },
    { op: 'cell.set', sheet: 's', cell: 'A1', value: 'Hello', style: 'header' }
  ]);
  assert.equal(split.assets.length, 1);
  assert.ok(split.design.some(ev => ev.op === 'cell.style' && ev.cell === 'A1'));
  assert.ok(split.values.some(ev => ev.op === 'cell.value.set' && ev.cell === 'A1' && ev.value === 'Hello'));
  assert.equal(core.validateSeparatedLayers(split).length, 0);
});

test('strict layer validation rejects design/value/asset contamination', () => {
  assert.throws(() => core.assertSeparatedLayers({ design: [{ op: 'cell.set', sheet: 's', cell: 'A1', value: 'x' }], values: [], assets: [] }), /design.*value\/formula payload/s);
  assert.throws(() => core.assertSeparatedLayers({ design: [], values: [{ op: 'cell.value.set', sheet: 's', cell: 'A1', value: 'x', style: 's1' }], assets: [] }), /values.*style/s);
  assert.throws(() => core.assertSeparatedLayers({ design: [], values: [], assets: [{ op: 'drawing.raw', sheet: 's', data_b64: 'PHg+PC94Pg==' }] }), /not an assets op/s);
  assert.throws(() => core.assertSeparatedLayers({ design: [], values: [], assets: [{ op: 'asset.drawing.raw', sheet: 's', asset_id: 'raw', data_b64: 'PHg+PC94Pg==' }] }), /not an assets op/s);
});

test('separated layers compile through node port', async () => {
  const bytes = await core.compileSeparatedJsonlToBytes({ design, values }, { now: '1980-01-01T00:00:00Z' }, nodeApi.nodePort);
  assert.deepEqual(await core.validateXlsxBytes(bytes, nodeApi.nodePort), []);
  const xml = Object.fromEntries((await core.readZip(bytes, {}, nodeApi.nodePort)).map(e => [e.path, core.utf8Decode(e.data)]));
  const extracted = await core.extractXlsxToEvents(bytes, { ts: '1980-01-01T00:00:00Z' }, nodeApi.nodePort);
  assert.ok(extracted.some(e => e.op === 'cell.set' && e.cell === 'A1' && e.value === 'Name'));
  assert.match(xml['xl/worksheets/sheet1.xml'], /mergeCell ref="A3:B3"/);
});

test('separated layers compile through browser adapter', async () => {
  const bytes = await browserApi.compileSeparatedJsonl({ design: core.stringifyJsonl(design), values: core.stringifyJsonl(values) }, { now: '1980-01-01T00:00:00Z', zipMethod: 8 });
  assert.deepEqual(await browserApi.validateXlsxBytes(bytes), []);
});

test('asset layer is optional and hucre-authored drawing is added only when supplied', async () => {
  const withoutAssets = await core.compileSeparatedJsonlToBytes({ design, values }, { now: '1980-01-01T00:00:00Z' }, nodeApi.nodePort);
  const withAssets = await core.compileSeparatedJsonlToBytes({ design, values, assets }, { now: '1980-01-01T00:00:00Z' }, nodeApi.nodePort);
  const p1 = (await core.readZip(withoutAssets, {}, nodeApi.nodePort)).map(e => e.path);
  const p2 = (await core.readZip(withAssets, {}, nodeApi.nodePort)).map(e => e.path);
  assert.equal(p1.some(p => p.startsWith('xl/drawings/')), false);
  assert.equal(p2.includes('xl/drawings/drawing1.xml'), true);
});


test('CR and CRLF cell text are normalized before XLSX shared string emission', async () => {
  const bytes = await core.compileSeparatedJsonlToBytes({
    design: [
      { op: 'workbook.init', title: 'crlf normalization', created: '1980-01-01T00:00:00Z' },
      { op: 'sheet.upsert', sheet_id: 's', name: 'S' }
    ],
    values: [
      { op: 'cell.value.set', sheet: 's', cell: 'A1', value: 'alpha\r\nbravo\rcharlie' }
    ]
  }, { now: '1980-01-01T00:00:00Z' }, nodeApi.nodePort);
  assert.deepEqual(await core.validateXlsxBytes(bytes, nodeApi.nodePort), []);
  const xml = (await core.readZip(bytes, {}, nodeApi.nodePort)).filter(e => e.path.endsWith('.xml')).map(e => core.utf8Decode(e.data)).join('\n');
  assert.equal(xml.includes('_x000D_'), false);
  const extracted = await core.extractXlsxToEvents(bytes, { ts: '1980-01-01T00:00:00Z' }, nodeApi.nodePort);
  assert.ok(extracted.some(e => e.op === 'cell.set' && e.cell === 'A1' && e.value === 'alpha\nbravo\ncharlie'));
});


test('legacy decimal numeric cell XML lexemes are preserved by the node writer path', async () => {
  const bytes = await core.compileSeparatedJsonlToBytes({
    design: [
      { op: 'workbook.init', title: 'legacy number lexemes', created: '1980-01-01T00:00:00Z' },
      { op: 'sheet.upsert', sheet_id: 's', name: 'S' }
    ],
    values: [
      { op: 'cell.value.set', sheet: 's', cell: 'A1', value: 1.2 },
      { op: 'cell.value.set', sheet: 's', cell: 'A2', value: 0.8 },
      { op: 'cell.value.set', sheet: 's', cell: 'A3', value: 2 }
    ]
  }, { now: '1980-01-01T00:00:00Z' }, nodeApi.nodePort);
  assert.deepEqual(await core.validateXlsxBytes(bytes, nodeApi.nodePort), []);
  const parts = Object.fromEntries((await core.readZip(bytes, {}, nodeApi.nodePort)).map(e => [e.path, core.utf8Decode(e.data)]));
  assert.match(parts['xl/worksheets/sheet1.xml'], /<c r="A1"><v>1\.20000000000000<\/v><\/c>/);
  assert.match(parts['xl/worksheets/sheet1.xml'], /<c r="A2"><v>0\.800000000000000<\/v><\/c>/);
  assert.match(parts['xl/worksheets/sheet1.xml'], /<c r="A3"><v>2<\/v><\/c>/);
});

test('raw drawing anchors, offsets, and empty shapes are preserved exactly', async () => {
  const rawAnchor = '<xdr:twoCellAnchor editAs="oneCell"><xdr:from><xdr:col>0</xdr:col><xdr:colOff>12345</xdr:colOff><xdr:row>1</xdr:row><xdr:rowOff>67890</xdr:rowOff></xdr:from><xdr:to><xdr:col>2</xdr:col><xdr:colOff>11111</xdr:colOff><xdr:row>4</xdr:row><xdr:rowOff>22222</xdr:rowOff></xdr:to><xdr:sp><xdr:nvSpPr><xdr:cNvPr id="2" name="Empty Rect"/><xdr:cNvSpPr/></xdr:nvSpPr><xdr:spPr><a:solidFill><a:srgbClr val="F2F2F2"/></a:solidFill><a:ln><a:solidFill><a:srgbClr val="999999"/></a:solidFill></a:ln></xdr:spPr></xdr:sp><xdr:clientData/></xdr:twoCellAnchor>';
  const bytes = await core.compileSeparatedJsonlToBytes({
    design: [
      { op: 'workbook.init', title: 'raw drawing preserve', created: '1980-01-01T00:00:00Z' },
      { op: 'sheet.upsert', sheet_id: 's', name: 'S', source_part: 'xl/worksheets/sheet1.xml' }
    ],
    values: [{ op: 'cell.value.set', sheet: 's', cell: 'A1', value: 'has drawing' }],
    assets: [
      { op: 'asset.drawing.element', sheet: 's', asset_id: 'empty_rect', drawing_part: 'xl/drawings/drawing1.xml', anchor_index: 0, raw_xml_b64: core.base64Encode(core.utf8Encode(rawAnchor)) }
    ]
  }, { now: '1980-01-01T00:00:00Z' }, nodeApi.nodePort);
  assert.deepEqual(await core.validateXlsxBytes(bytes, nodeApi.nodePort), []);
  const parts = Object.fromEntries((await core.readZip(bytes, {}, nodeApi.nodePort)).map(e => [e.path, core.utf8Decode(e.data)]));
  const expected = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' + rawAnchor + '</xdr:wsDr>';
  assert.equal(parts['xl/drawings/drawing1.xml'], expected);
  assert.match(parts['xl/worksheets/sheet1.xml'], /<drawing r:id="rId1"\/>/);
  assert.match(parts['xl/worksheets/_rels/sheet1.xml.rels'], /Target="\.\.\/drawings\/drawing1\.xml"/);
});

test('extractSeparated writes design and values files that recompile', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'separated-test-'));
  const designFile = join(dir, 'design.jsonl');
  const valuesFile = join(dir, 'values.jsonl');
  const xlsx = join(dir, 'out.xlsx');
  const splitDesign = join(dir, 'split.design.jsonl');
  const splitValues = join(dir, 'split.values.jsonl');
  await writeJsonl(designFile, design);
  await writeJsonl(valuesFile, values);
  await nodeApi.compileSeparatedFiles({ design: designFile, values: valuesFile }, xlsx, { now: '1980-01-01T00:00:00Z' });
  await nodeApi.extractSeparated(xlsx, { design: splitDesign, values: splitValues }, { ts: '1980-01-01T00:00:00Z' });
  const d = await readFile(splitDesign, 'utf8');
  const v = await readFile(splitValues, 'utf8');
  assert.equal(d.includes('Merged'), false);
  assert.match(v, /cell\.value\.set/);
  const recompiled = join(dir, 'recompiled.xlsx');
  await nodeApi.compileSeparatedFiles({ design: splitDesign, values: splitValues }, recompiled, { now: '1980-01-01T00:00:00Z' });
  assert.deepEqual(await nodeApi.validateXlsx(recompiled), []);
});


test('separated design hyperlink attrs are preserved by hucre renderer', async () => {
  const bytes = await core.compileSeparatedJsonlToBytes({
    design: [
      { op: 'workbook.init', title: 'hyperlink attrs', created: '1980-01-01T00:00:00Z' },
      { op: 'sheet.upsert', sheet_id: 's', name: 'Index' },
      { op: 'sheet.upsert', sheet_id: 's2', name: 'Target' },
      { op: 'hyperlink.set', sheet: 's', ref: 'A1', attrs: { ref: 'A1', location: "'Target'!A1", display: 'Target sheet' } }
    ],
    values: [
      { op: 'cell.value.set', sheet: 's', cell: 'A1', value: 'Target sheet' },
      { op: 'cell.value.set', sheet: 's2', cell: 'A1', value: 'OK' }
    ]
  }, { now: '1980-01-01T00:00:00Z' }, nodeApi.nodePort);
  assert.deepEqual(await core.validateXlsxBytes(bytes, nodeApi.nodePort), []);
  const xml = Object.fromEntries((await core.readZip(bytes, {}, nodeApi.nodePort)).map(e => [e.path, core.utf8Decode(e.data)]));
  assert.match(xml['xl/worksheets/sheet1.xml'], /<hyperlink[^>]*ref="A1"[^>]*location="&apos;Target&apos;!A1"[^>]*display="Target sheet"/);
});


test('separated external hyperlinks preserve source rIds and relationship targets', async () => {
  const bytes = await core.compileSeparatedJsonlToBytes({
    design: [
      { op: 'workbook.init', title: 'external hyperlink rids', created: '1980-01-01T00:00:00Z' },
      { op: 'sheet.upsert', sheet_id: 's', name: 'Index', source_part: 'xl/worksheets/sheet1.xml' },
      { op: 'hyperlink.set', sheet: 's', ref: 'B2', attrs: { ref: 'B2', id: 'rId1' }, target: 'https://example.com/first', targetMode: 'External', relType: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink' },
      { op: 'hyperlink.set', sheet: 's', ref: 'B1', attrs: { ref: 'B1', id: 'rId2' }, target: 'https://example.com/second', targetMode: 'External', relType: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink' }
    ],
    values: [
      { op: 'cell.value.set', sheet: 's', cell: 'B1', value: 'second' },
      { op: 'cell.value.set', sheet: 's', cell: 'B2', value: 'first' }
    ]
  }, { now: '1980-01-01T00:00:00Z' }, nodeApi.nodePort);
  assert.deepEqual(await core.validateXlsxBytes(bytes, nodeApi.nodePort), []);
  const parts = Object.fromEntries((await core.readZip(bytes, {}, nodeApi.nodePort)).map(e => [e.path, core.utf8Decode(e.data)]));
  assert.match(parts['xl/worksheets/sheet1.xml'], /<hyperlink ref="B2" id="rId1" r:id="rId1"\/><hyperlink ref="B1" id="rId2" r:id="rId2"\/>/);
  assert.match(parts['xl/worksheets/_rels/sheet1.xml.rels'], /Id="rId1"[^>]*Target="https:\/\/example\.com\/first"/);
  assert.match(parts['xl/worksheets/_rels/sheet1.xml.rels'], /Id="rId2"[^>]*Target="https:\/\/example\.com\/second"/);
});

test('separated values preserve formula cached alias without leaking design payload', async () => {
  const split = core.splitEventsByLayer([
    { op: 'workbook.init', title: 'formula split' },
    { op: 'sheet.upsert', sheet_id: 's', name: 'S' },
    { op: 'cell.set', sheet: 's', cell: 'A1', style: 'header', formula: '1+1', cached: 2, cached_type: 'number' }
  ]);
  assert.equal(core.validateSeparatedLayers(split).length, 0);
  const formulaEvent = split.values.find(ev => ev.op === 'cell.formula.set');
  assert.equal(formulaEvent.cached, 2);
  assert.equal(formulaEvent.style, undefined);
});

test('separated values layer preserves formula cached alias and result type', async () => {
  const bytes = await core.compileSeparatedJsonlToBytes({
    design: [
      { op: 'workbook.init', title: 'formula layers', created: '1980-01-01T00:00:00Z' },
      { op: 'sheet.upsert', sheet_id: 's', name: 'Formula' },
      { op: 'sheet.auto_filter', sheet: 's', ref: 'A1:B2' },
      { op: 'data_validation.add', sheet: 's', sqref: 'A1:A2 C1:C2', type: 'list', formula1: '"A,B"' }
    ],
    values: [
      { op: 'cell.formula.set', sheet: 's', cell: 'A1', formula: 'CONCAT("a","b")', cached: 'ab', cached_type: 'string' },
      { op: 'cell.formula.set', sheet: 's', cell: 'B1', formula: '1=1', cached_value: true, cached_type: 'boolean' }
    ]
  }, { now: '1980-01-01T00:00:00Z' }, nodeApi.nodePort);
  assert.deepEqual(await core.validateXlsxBytes(bytes, nodeApi.nodePort), []);
  const xml = Object.fromEntries((await core.readZip(bytes, {}, nodeApi.nodePort)).map(e => [e.path, core.utf8Decode(e.data)]));
  assert.match(xml['xl/worksheets/sheet1.xml'], /<autoFilter ref="A1:B2"\/>/);
  assert.match(xml['xl/worksheets/sheet1.xml'], /<dataValidation[^>]*type="list"[^>]*sqref="A1:A2 C1:C2"|<dataValidation[^>]*sqref="A1:A2 C1:C2"[^>]*type="list"/);
  assert.match(xml['xl/worksheets/sheet1.xml'], /<c r="A1" t="str"><f>CONCAT\("a","b"\)<\/f><v>ab<\/v><\/c>/);
  assert.match(xml['xl/worksheets/sheet1.xml'], /<c r="B1" t="b"><f>1=1<\/f><v>1<\/v><\/c>/);
});
