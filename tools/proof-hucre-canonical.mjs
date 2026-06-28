#!/usr/bin/env node
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nodePort } from '../src/adapters/node/port.mjs';
import {
  compileLayeredJsonlToBytes,
  composeSeparatedLayers,
  entriesToMap,
  parseJsonlText,
  readZip,
  reduceEvents,
  stringifyJsonl,
  validateSeparatedLayers,
  validateXlsxBytes
} from '../src/core/index.mjs';
import { attr, children, firstChild, parseXml, textOf } from '../src/core/xml.mjs';
import { findWorkbookPart, joinPartPath, parseSharedStrings, readRels, relsPathForPart, spreadsheetStringText, spreadsheetTextDecode } from '../src/core/semantic-extract.mjs';

const HERE = resolve(fileURLToPath(new URL('..', import.meta.url)));
const BUNDLE_ARG = process.argv[2] || process.env.CANONICAL_BUNDLE;
if (!BUNDLE_ARG) {
  console.error('usage: node --expose-gc tools/proof-hucre-canonical.mjs /path/to/canonical_basic_detail_semantic_bundle');
  process.exit(2);
}
const BUNDLE = resolve(BUNDLE_ARG);
const OUT = join(HERE, 'proof_outputs', 'hucre-canonical');
await mkdir(OUT, { recursive: true });

function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function sameLogicalValue(a, b) { return same(a, b); }
function normalizeNumeric(raw) { const n = Number(raw); return raw !== '' && Number.isFinite(n) ? n : raw; }

function expectedLogicalMap(state) {
  const map = new Map();
  for (const sheetId of state.sheetOrder) {
    const sheet = state.sheets.get(sheetId);
    if (!sheet) continue;
    for (const [ref, cell] of sheet.cells.entries()) {
      const hasFormula = Object.prototype.hasOwnProperty.call(cell, 'formula');
      if (!hasFormula && (!Object.prototype.hasOwnProperty.call(cell, 'value') || cell.value === null || cell.value === undefined)) continue;
      map.set(`${sheetId}!${ref}`, {
        value: hasFormula ? cell.cached_value : cell.value,
        formula: cell.formula || undefined
      });
    }
  }
  return map;
}

function parseCellValue(c, sharedStrings) {
  const t = attr(c, 't');
  const vNode = firstChild(c, 'v');
  const raw = vNode ? textOf(vNode) : '';
  if (t === 's') return sharedStrings[Number(raw)] ?? '';
  if (t === 'inlineStr') return spreadsheetStringText(c);
  if (t === 'b') return raw === '1' || raw === 'true';
  if (t === 'e') return raw;
  if (t === 'str') return spreadsheetTextDecode(raw);
  if (t === 'd') return raw;
  if (vNode) return normalizeNumeric(raw);
  return null;
}

async function xlsxLogicalMap(bytes) {
  const entries = await readZip(bytes, {}, nodePort);
  const parts = entriesToMap(entries);
  const workbookPart = findWorkbookPart(parts);
  const workbookRoot = parseXml(parts.get(workbookPart));
  const workbookRels = readRels(parts, relsPathForPart(workbookPart));
  let sharedPath = 'xl/sharedStrings.xml';
  for (const rel of workbookRels.values()) if (rel.Type && rel.Type.endsWith('/sharedStrings')) sharedPath = joinPartPath(workbookPart, rel.Target || sharedPath);
  const sharedStrings = parseSharedStrings(parts, sharedPath);
  const sheetEls = children(firstChild(workbookRoot, 'sheets'), 'sheet');
  const map = new Map();
  sheetEls.forEach((sheetEl, sheetIndex) => {
    const sheetId = `s${sheetIndex + 1}`;
    const rid = attr(sheetEl, 'id');
    const rel = rid ? workbookRels.get(rid) : null;
    const sheetPart = rel ? joinPartPath(workbookPart, rel.Target || '') : `xl/worksheets/sheet${sheetIndex + 1}.xml`;
    if (!parts.has(sheetPart)) return;
    const root = parseXml(parts.get(sheetPart));
    const sd = firstChild(root, 'sheetData');
    if (!sd) return;
    for (const rowEl of children(sd, 'row')) {
      for (const c of children(rowEl, 'c')) {
        const ref = attr(c, 'r');
        if (!ref) continue;
        const fNode = firstChild(c, 'f');
        const value = parseCellValue(c, sharedStrings);
        if (!fNode && (value === null || value === undefined)) continue;
        map.set(`${sheetId}!${ref}`, { value, formula: fNode ? (textOf(fNode) || undefined) : undefined });
      }
    }
  });
  return { map, entries };
}

function diffMaps(expected, actual) {
  const diffs = [];
  const keys = Array.from(new Set([...expected.keys(), ...actual.keys()])).sort();
  for (const key of keys) {
    const a = expected.get(key) || {};
    const b = actual.get(key) || {};
    if (!sameLogicalValue(a.value, b.value)) { diffs.push({ key, field: 'value', expected: a.value, actual: b.value }); continue; }
    if (a.formula && !sameLogicalValue(a.formula, b.formula)) { diffs.push({ key, field: 'formula', expected: a.formula, actual: b.formula }); continue; }
  }
  return diffs;
}

function valueDiffs(before, after) {
  const out = [];
  const keys = Array.from(new Set([...before.keys(), ...after.keys()])).sort();
  for (const key of keys) if (!same(before.get(key), after.get(key))) out.push({ key, before: before.get(key), after: after.get(key) });
  return out;
}

function valueOnlyMap(logicalMap) {
  const out = new Map();
  for (const [k, v] of logicalMap.entries()) out.set(k, v.value);
  return out;
}

function countState(state) {
  const counts = { sheets: state.sheetOrder.length, logical_cells: 0, formulas: 0, styled_cells: 0, merges: 0, validations: 0, hyperlinks: 0, tables: 0 };
  for (const sheet of state.sheets.values()) {
    for (const cell of sheet.cells.values()) {
      const hasFormula = Object.prototype.hasOwnProperty.call(cell, 'formula');
      if (hasFormula || (Object.prototype.hasOwnProperty.call(cell, 'value') && cell.value !== null && cell.value !== undefined)) counts.logical_cells++;
      if (hasFormula) counts.formulas++;
      if (cell.style) counts.styled_cells++;
    }
    counts.merges += sheet.merges.length;
    counts.validations += sheet.validations.length;
    counts.hyperlinks += sheet.hyperlinks.length;
    counts.tables += sheet.tables.length;
  }
  return counts;
}

function findEditableValue(valuesEvents) {
  for (const ev of valuesEvents) if (ev.op === 'cell.value.set' && ev.sheet && ev.cell && typeof ev.value === 'string' && ev.value.length) return ev;
  for (const ev of valuesEvents) if (ev.op === 'cell.value.set' && ev.sheet && ev.cell) return ev;
  throw new Error('no editable cell.value.set found');
}

async function readLayers(dir) {
  const designText = await readFile(join(dir, 'design.jsonl'), 'utf8');
  const valuesText = await readFile(join(dir, 'values.jsonl'), 'utf8');
  const assetsText = await readFile(join(dir, 'assets.jsonl'), 'utf8').catch(() => '');
  return { designText, valuesText, assetsText, design: parseJsonlText(designText), values: parseJsonlText(valuesText), assets: parseJsonlText(assetsText || '') };
}

async function compileLayers(layers, name, suffix = '') {
  const bytes = await compileLayeredJsonlToBytes({ design: layers.designText, values: layers.valuesText, assets: layers.assetsText }, { now: '1980-01-01T00:00:00Z' }, nodePort);
  const xlsxPath = join(OUT, `${name}${suffix}.xlsx`);
  await writeFile(xlsxPath, bytes);
  const xlsxErrors = await validateXlsxBytes(bytes, nodePort);
  if (xlsxErrors.length) throw new Error(`xlsx validation failed: ${xlsxErrors.join('; ')}`);
  const readback = await xlsxLogicalMap(bytes);
  return { bytes, xlsxPath, logicalMap: readback.map, entries: readback.entries };
}

async function proveOne(category, name) {
  const dir = join(BUNDLE, 'jsonl', category, name);
  const layers = await readLayers(dir);
  const layerErrors = validateSeparatedLayers({ design: layers.designText, values: layers.valuesText, assets: layers.assetsText });
  if (layerErrors.length) throw new Error(`layer validation failed: ${layerErrors.join('; ')}`);
  const expectedState = reduceEvents(composeSeparatedLayers({ design: layers.design, values: layers.values, assets: layers.assets }), { now: '1980-01-01T00:00:00Z' });
  const compiled = await compileLayers(layers, name);
  const logicalDiffs = diffMaps(expectedLogicalMap(expectedState), compiled.logicalMap);
  if (logicalDiffs.length) throw new Error(`logical readback diffs=${logicalDiffs.length}: ${JSON.stringify(logicalDiffs.slice(0, 10))}`);

  const changedValues = layers.values.map(e => ({ ...e }));
  const target = findEditableValue(changedValues);
  const sentinel = `__HUCRE_ONE_CELL_SMOKE__${name}__${target.sheet}_${target.cell}__`;
  target.value = sentinel;
  target.cell_type = 'string';
  const changedLayers = { ...layers, values: changedValues, valuesText: stringifyJsonl(changedValues) };
  const changed = await compileLayers(changedLayers, name, '.one_cell');
  const diffs = valueDiffs(valueOnlyMap(compiled.logicalMap), valueOnlyMap(changed.logicalMap));
  if (!(diffs.length === 1 && diffs[0].key === `${target.sheet}!${target.cell}` && diffs[0].after === sentinel)) throw new Error(`one-cell smoke failed: target=${target.sheet}!${target.cell} diffs=${JSON.stringify(diffs.slice(0, 10))}`);

  const media = compiled.entries.filter(e => e.path.startsWith('xl/media/')).length;
  const drawings = compiled.entries.filter(e => /^xl\/drawings\/drawing\d+\.xml$/.test(e.path)).length;
  const counts = countState(expectedState);
  return { category, name, bytes: compiled.bytes.length, layer_events: { design: layers.design.length, values: layers.values.length, assets: layers.assets.length }, counts, logical_readback_diffs: logicalDiffs.length, one_cell_target: `${target.sheet}!${target.cell}`, one_cell_diffs: diffs.length, media_parts: media, drawing_parts: drawings, output: compiled.xlsxPath };
}

async function main() {
  const rows = [];
  for (const category of ['basic_design', 'detail_design']) {
    const names = (await readdir(join(BUNDLE, 'jsonl', category))).filter(n => !n.startsWith('_ref_')).sort();
    for (const name of names) {
      try { const row = await proveOne(category, name); rows.push({ status: 'PASS', ...row }); console.log(`PASS ${name}`); }
      catch (err) { rows.push({ status: 'FAIL', category, name, error: err.message || String(err) }); console.log(`FAIL ${name}: ${err.message || err}`); }
      if (globalThis.gc) globalThis.gc();
    }
  }
  const ok = rows.every(r => r.status === 'PASS');
  const totals = rows.reduce((acc, r) => { if (r.status !== 'PASS') return acc; acc.books++; acc.design_events += r.layer_events.design; acc.value_events += r.layer_events.values; acc.asset_events += r.layer_events.assets; acc.logical_cells += r.counts.logical_cells; acc.formulas += r.counts.formulas; acc.styled_cells += r.counts.styled_cells; acc.media_parts += r.media_parts; acc.drawing_parts += r.drawing_parts; return acc; }, { books: 0, design_events: 0, value_events: 0, asset_events: 0, logical_cells: 0, formulas: 0, styled_cells: 0, media_parts: 0, drawing_parts: 0 });
  await writeFile(join(OUT, 'hucre_canonical_proof.json'), JSON.stringify({ bundle: BUNDLE, ok, totals, rows }, null, 2), 'utf8');
  const md = ['# hucre backend canonical migration proof', '', `総合結果: **${ok ? 'PASS' : 'FAIL'}**`, '', `bundle: \`${BUNDLE}\``, '', '## totals', '', '```json', JSON.stringify(totals, null, 2), '```', '', '## books', '', '| # | status | category | name | logical cells | formulas | styled cells | media | drawings | one-cell target |', '|---:|---|---|---|---:|---:|---:|---:|---:|---|', ...rows.map((r, i) => r.status === 'PASS' ? `| ${i + 1} | ${r.status} | ${r.category} | ${r.name.replace(/\|/g, '\\|')} | ${r.counts.logical_cells} | ${r.counts.formulas} | ${r.counts.styled_cells} | ${r.media_parts} | ${r.drawing_parts} | ${r.one_cell_target} |` : `| ${i + 1} | ${r.status} | ${r.category} | ${r.name.replace(/\|/g, '\\|')} |  |  |  |  |  | ${String(r.error).replace(/\|/g, '\\|')} |`), ''];
  await writeFile(join(OUT, 'hucre_canonical_proof.md'), md.join('\n'), 'utf8');
  console.log(join(OUT, 'hucre_canonical_proof.md'));
  console.log(ok ? 'PASS' : 'FAIL');
  process.exit(ok ? 0 : 1);
}

await main();
