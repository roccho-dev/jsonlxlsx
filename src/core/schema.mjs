import { splitCellRef, parseRange, parseSqref, colToIndex } from './a1.mjs';

export const KNOWN_OPS = new Set([
  'schema.declare', 'layer.declare', 'manifest.layer',
  'workbook.init', 'workbook.patch', 'defined_name.set', 'defined_name.upsert',
  'sheet.upsert', 'sheet.delete', 'sheet.view', 'sheet.freeze', 'pane.freeze', 'sheet.page', 'sheet_format.set', 'sheet.protection', 'sheet_protection.set',
  'style.upsert', 'row_pattern.upsert', 'row.emit', 'row.values', 'column.set', 'row.set',
  'cell.set', 'cell.style', 'cell.clear', 'cell.value.set', 'cell.formula.set', 'cell.value.clear',
  'range.style', 'range.merge', 'range.unmerge', 'auto_filter.set', 'autofilter.set', 'sheet.auto_filter', 'table.add', 'data_validation.add',
  'conditional_format.add', 'conditional_format.raw', 'hyperlink.set',
  'asset.drawing.element', 'asset.drawing.rels', 'asset.media.part'
]);

function hasAny(ev, keys) {
  return keys.some(k => ev[k] !== undefined && ev[k] !== null && ev[k] !== '');
}

function req(errors, ev, keys, message) {
  if (!hasAny(ev, Array.isArray(keys) ? keys : [keys])) errors.push(`${where(ev)} ${message || `requires ${keys}`}`);
}

function where(ev) {
  return `line ${ev._line || '?'} op=${ev.op || '?'}`;
}

function tryA1(errors, ev, value, kind) {
  if (value == null) return;
  try {
    if (kind === 'cell') splitCellRef(value);
    else parseRange(value);
  } catch (err) {
    errors.push(`${where(ev)} invalid ${kind}: ${err.message}`);
  }
}

function trySqref(errors, ev, value, kind = 'sqref') {
  if (value == null) return;
  try { parseSqref(value); } catch (err) { errors.push(`${where(ev)} invalid ${kind}: ${err.message}`); }
}

function tryCol(errors, ev, value) {
  if (value == null) return;
  try { colToIndex(value); } catch (err) { errors.push(`${where(ev)} invalid column: ${err.message}`); }
}

function tryMediaPath(errors, ev, value) {
  if (value == null) return;
  const path = String(value);
  if (!path.startsWith('xl/media/')) errors.push(`${where(ev)} asset.media.part path must be under xl/media/`);
  if (path.includes('..') || path.includes('\\')) errors.push(`${where(ev)} asset.media.part path must be a normalized ZIP path`);
  const name = path.slice('xl/media/'.length);
  if (!name || name.includes('/')) errors.push(`${where(ev)} asset.media.part path must name one media file directly under xl/media/`);
}

function validateEventShapes(events) {
  const errors = [];
  let lastSeq = -Infinity;
  for (const ev of events) {
    if (!ev || typeof ev !== 'object' || Array.isArray(ev)) { errors.push('event must be an object'); continue; }
    if (!ev.op) errors.push(`${where(ev)} requires op`);
    else if (!KNOWN_OPS.has(ev.op)) errors.push(`${where(ev)} unknown op`);
    if (ev.seq != null) {
      const seq = Number(ev.seq);
      if (!Number.isFinite(seq)) errors.push(`${where(ev)} seq must be numeric`);
      else if (seq < lastSeq) errors.push(`${where(ev)} seq must be nondecreasing`);
      else lastSeq = seq;
    }
    switch (ev.op) {
      case 'schema.declare': {
        const declaredMode = String(ev.mode || '').toLowerCase();
        if (declaredMode === 'package' || declaredMode === 'hybrid') errors.push(`${where(ev)} package mode has been removed`);
        if (ev.package_mode !== undefined && ev.package_mode !== false) errors.push(`${where(ev)} package_mode must be false or omitted`);
        break;
      }
      case 'layer.declare': req(errors, ev, 'layer'); break;
      case 'manifest.layer': req(errors, ev, 'layer'); req(errors, ev, 'file'); break;
      case 'sheet.upsert': req(errors, ev, ['sheet_id', 'sheet', 'id', 'name'], 'requires sheet_id/sheet/name'); break;
      case 'sheet.delete': req(errors, ev, ['sheet', 'sheet_id'], 'requires sheet'); break;
      case 'style.upsert': req(errors, ev, 'style_id'); break;
      case 'row_pattern.upsert': req(errors, ev, 'pattern_id'); break;
      case 'row.emit': req(errors, ev, 'sheet'); req(errors, ev, 'row'); break;
      case 'row.values': req(errors, ev, 'sheet'); req(errors, ev, 'row'); req(errors, ev, 'values'); break;
      case 'column.set': req(errors, ev, 'sheet'); req(errors, ev, ['col', 'from_col', 'from', 'min']); tryCol(errors, ev, ev.col || ev.from_col || ev.from || ev.min); tryCol(errors, ev, ev.to_col || ev.to || ev.max); break;
      case 'row.set': req(errors, ev, 'sheet'); req(errors, ev, 'row'); break;
      case 'cell.set': case 'cell.style': case 'cell.clear': case 'cell.value.set': case 'cell.formula.set': case 'cell.value.clear': req(errors, ev, 'sheet'); req(errors, ev, ['cell', 'ref']); tryA1(errors, ev, ev.cell || ev.ref, 'cell'); break;
      case 'range.style': case 'range.merge': case 'range.unmerge': req(errors, ev, 'sheet'); req(errors, ev, ['range', 'ref']); tryA1(errors, ev, ev.range || ev.ref, 'range'); break;
      case 'auto_filter.set': case 'autofilter.set': case 'sheet.auto_filter': req(errors, ev, 'sheet'); req(errors, ev, ['range', 'ref']); tryA1(errors, ev, ev.range || ev.ref, 'range'); break;
      case 'table.add': req(errors, ev, 'sheet'); req(errors, ev, ['range', 'ref']); req(errors, ev, 'name'); tryA1(errors, ev, ev.range || ev.ref, 'range'); break;
      case 'data_validation.add': req(errors, ev, 'sheet'); req(errors, ev, ['range', 'sqref', 'ref']); trySqref(errors, ev, ev.range || ev.sqref || ev.ref); break;
      case 'conditional_format.add': req(errors, ev, 'sheet'); req(errors, ev, ['range', 'sqref', 'ref']); trySqref(errors, ev, ev.range || ev.sqref || ev.ref); break;
      case 'hyperlink.set': req(errors, ev, 'sheet'); req(errors, ev, ['cell', 'ref']); tryA1(errors, ev, ev.cell || ev.ref, 'range'); break;
      case 'asset.drawing.element': req(errors, ev, 'sheet'); req(errors, ev, 'asset_id'); req(errors, ev, ['raw_xml_b64', 'raw_xml']); break;
      case 'asset.drawing.rels': req(errors, ev, 'sheet'); req(errors, ev, 'rels_b64'); break;
      case 'asset.media.part': req(errors, ev, 'path'); req(errors, ev, 'data_b64'); tryMediaPath(errors, ev, ev.path); break;
      default: break;
    }
  }
  return errors;
}

function assertValidEventShapes(events) {
  const errors = validateEventShapes(events);
  if (errors.length) throw new Error(`JSONL event shape validation failed:\n${errors.join('\n')}`);
  return true;
}

export { validateEventShapes, assertValidEventShapes };
