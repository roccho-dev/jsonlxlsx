import { parseJsonlText, stringifyJsonl } from './jsonl.mjs';
import { assertValidEventShapes } from './schema.mjs';
import { colToIndex, cellRef, splitCellRef, parseRange } from './a1.mjs';
import { reduceEvents } from './compiler.mjs';

const META_OPS = new Set(['schema.declare', 'layer.declare', 'manifest.layer']);

const DESIGN_OPS = new Set([
  'workbook.init', 'workbook.patch', 'defined_name.set', 'defined_name.upsert',
  'sheet.upsert', 'sheet.delete', 'sheet.view', 'sheet.freeze', 'pane.freeze', 'sheet.page',
  'sheet_format.set', 'sheet.protection', 'sheet_protection.set', 'style.upsert', 'row_pattern.upsert',
  'column.set', 'row.set', 'cell.style', 'range.style', 'range.merge', 'range.unmerge',
  'auto_filter.set', 'autofilter.set', 'sheet.auto_filter', 'table.add', 'data_validation.add', 'conditional_format.add',
  'conditional_format.raw', 'hyperlink.set'
]);

const VALUE_OPS = new Set(['cell.value.set', 'cell.formula.set', 'cell.value.clear', 'row.values']);
const ASSET_OPS = new Set(['asset.drawing.element', 'asset.drawing.rels', 'asset.media.part']);
const VALUE_FIELDS = new Set(['value', 'v', 'formula', 'f', 'cached_value', 'cached', 'cached_type', 'type', 'cell_type', 't', 'formula_attrs']);
const DESIGN_FIELDS = new Set(['style', 'hyperlink', 'extra_attrs', 'fill', 'font', 'border', 'alignment', 'number_format']);
const DESIGN_VALUE_FIELD_ALLOWLIST = {
  'data_validation.add': new Set(['type']),
  'conditional_format.add': new Set(['type', 'formula', 'formula1', 'formula2'])
};

function cleanEvent(ev) {
  const out = {};
  for (const [k, v] of Object.entries(ev || {})) if (v !== undefined && k !== '_line') out[k] = v;
  return out;
}

function withoutKeys(ev, keys) {
  const drop = new Set(keys);
  const out = {};
  for (const [k, v] of Object.entries(ev || {})) if (!drop.has(k) && v !== undefined) out[k] = v;
  return out;
}

function pickKeys(ev, keys) {
  const out = {};
  for (const k of keys) if (ev && ev[k] !== undefined) out[k] = ev[k];
  return out;
}

function hasAny(ev, keys) {
  return [...keys].some(k => ev && ev[k] !== undefined);
}

function hasCellValuePayload(ev) {
  if (!ev) return false;
  if (ev.formula !== undefined || ev.f !== undefined || ev.cached_value !== undefined || ev.cached !== undefined) return true;
  if (ev.value !== undefined) return ev.value !== null;
  if (ev.v !== undefined) return ev.v !== null;
  return false;
}


function hasMeaningfulValuePayload(ev) {
  if (!ev) return false;
  for (const key of ['formula', 'f', 'cached_value', 'cached', 'cached_type', 'formula_attrs']) if (ev[key] !== undefined && ev[key] !== null) return true;
  for (const key of ['value', 'v']) if (ev[key] !== undefined && ev[key] !== null) return true;
  return false;
}

function rowEmitHasDesign(ev) {
  return ev.pattern !== undefined || ev.pattern_id !== undefined || ev.row_attrs !== undefined || ev.style !== undefined || ev.merges !== undefined || ev.cells !== undefined;
}

function rowEmitHasValues(ev) {
  return Array.isArray(ev.values);
}

function splitCellSet(ev) {
  const design = [];
  const values = [];
  if (ev.style !== undefined) design.push({ op: 'cell.style', seq: ev.seq, ts: ev.ts, source: ev.source, sheet: ev.sheet, cell: ev.cell || ev.ref, style: ev.style });
  if (ev.hyperlink !== undefined) design.push({ op: 'hyperlink.set', seq: ev.seq, ts: ev.ts, source: ev.source, sheet: ev.sheet, ref: ev.cell || ev.ref, ...cleanEvent(ev.hyperlink) });
  const payload = pickKeys(ev, ['seq', 'ts', 'source', 'sheet', 'cell', 'ref', 'value', 'v', 'formula', 'f', 'cached_value', 'cached', 'cached_type', 'type', 'cell_type', 't', 'formula_attrs']);
  if (hasMeaningfulValuePayload(payload)) {
    payload.op = payload.formula !== undefined || payload.f !== undefined ? 'cell.formula.set' : 'cell.value.set';
    values.push(payload);
  }
  return { design, values, assets: [], ignored: [] };
}

function splitRowValueItem(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return { valueItem: item, styles: [], hyperlinks: [] };
  const valueItem = withoutKeys(item, [...DESIGN_FIELDS]);
  const col = item.col || item.column;
  const styles = item.style !== undefined ? [{ col, style: item.style }] : [];
  const hyperlinks = item.hyperlink !== undefined ? [{ col, hyperlink: item.hyperlink }] : [];
  return { valueItem, styles, hyperlinks };
}

function splitRowEmit(ev) {
  const design = [];
  const values = [];
  if (rowEmitHasDesign(ev)) design.push({ ...withoutKeys(cleanEvent(ev), ['values', 'start_col']), op: 'row.emit' });
  if (rowEmitHasValues(ev)) {
    const valueEvent = pickKeys(ev, ['seq', 'ts', 'source', 'sheet', 'row', 'start_col', 'from_col', 'col', 'values']);
    valueEvent.op = 'row.values';
    const cellStyles = [];
    const cellLinks = [];
    valueEvent.values = ev.values.map((item, index) => {
      const split = splitRowValueItem(item);
      for (const st of split.styles) cellStyles.push({ ...st, index });
      for (const hl of split.hyperlinks) cellLinks.push({ ...hl, index });
      return split.valueItem;
    });
    values.push(valueEvent);
    const baseCol = ev.start_col || ev.from_col || ev.col || 1;
    const baseIndex = typeof baseCol === 'number' ? baseCol : colToIndex(baseCol);
    for (const item of cellStyles) {
      const colIndex = item.col ? colToIndex(item.col) : baseIndex + item.index;
      design.push({ op: 'cell.style', seq: ev.seq, ts: ev.ts, source: ev.source, sheet: ev.sheet, cell: cellRef(Number(ev.row), colIndex), style: item.style });
    }
    for (const item of cellLinks) {
      const colIndex = item.col ? colToIndex(item.col) : baseIndex + item.index;
      design.push({ op: 'hyperlink.set', seq: ev.seq, ts: ev.ts, source: ev.source, sheet: ev.sheet, ref: cellRef(Number(ev.row), colIndex), ...cleanEvent(item.hyperlink) });
    }
  }
  return { design, values, assets: [], ignored: [] };
}

function splitEventByLayer(ev) {
  if (!ev || typeof ev !== 'object' || Array.isArray(ev)) return { design: [], values: [], assets: [], ignored: [] };
  if (META_OPS.has(ev.op)) return { design: [], values: [], assets: [], ignored: [cleanEvent(ev)] };
  if (ev.op === 'cell.set') return splitCellSet(ev);
  if (ev.op === 'row.emit') return splitRowEmit(ev);
  if (DESIGN_OPS.has(ev.op)) return { design: [cleanEvent(ev)], values: [], assets: [], ignored: [] };
  if (VALUE_OPS.has(ev.op)) return { design: [], values: [cleanEvent(ev)], assets: [], ignored: [] };
  if (ASSET_OPS.has(ev.op)) return { design: [], values: [], assets: [cleanEvent(ev)], ignored: [] };
  return { design: [cleanEvent(ev)], values: [], assets: [], ignored: [] };
}

function renumber(events, start = 1) {
  return events.map((ev, i) => ({ ...withoutKeys(ev, ['_line']), seq: start + i }));
}

function withLayerHeader(layer, events, options = {}) {
  const header = { op: 'layer.declare', layer, schema: 'jsonl-xlsx-separated', version: '1.0' };
  if (options.source) header.source = options.source;
  if (options.ts) header.ts = options.ts;
  return [header, ...events.map(ev => ({ ...ev, layer }))];
}

function splitEventsByLayer(events, options = {}) {
  assertValidEventShapes(events);
  const split = { design: [], values: [], assets: [], ignored: [] };
  for (const ev of events) {
    const part = splitEventByLayer(ev);
    split.design.push(...part.design);
    split.values.push(...part.values);
    split.assets.push(...part.assets);
    split.ignored.push(...(part.ignored || []));
  }
  const result = options.headers === false
    ? split
    : { design: withLayerHeader('design', split.design, options), values: withLayerHeader('values', split.values, options), assets: withLayerHeader('assets', split.assets, options), ignored: split.ignored };
  if (options.renumber === false) return result;
  return { design: renumber(result.design, 1), values: renumber(result.values, 1), assets: renumber(result.assets, 1), ignored: split.ignored };
}

function asEvents(input, jsonlOptions = {}) {
  if (!input) return [];
  return Array.isArray(input) ? input : parseJsonlText(String(input), jsonlOptions);
}

function opIsMeta(ev) {
  return META_OPS.has(ev.op);
}

function ensureNoKeys(errors, ev, keys, layer) {
  for (const key of keys) if (ev[key] !== undefined) errors.push(`${layer} layer op=${ev.op} must not contain ${key}`);
}

function forbiddenDesignValuePayloadKeys(ev) {
  const allow = DESIGN_VALUE_FIELD_ALLOWLIST[ev.op] || new Set();
  return [...VALUE_FIELDS].filter(key => ev && ev[key] !== undefined && !allow.has(key));
}

function validateDesignEvent(ev, errors) {
  if (opIsMeta(ev)) return;
  if (!DESIGN_OPS.has(ev.op)) errors.push(ASSET_OPS.has(ev.op) ? `design layer contains asset op=${ev.op}; move it to assets layer` : `design layer op=${ev.op} is not a design op`);
  const leaked = forbiddenDesignValuePayloadKeys(ev);
  if (leaked.length) errors.push(`design layer op=${ev.op} must not contain value/formula payload: ${leaked.join(',')}`);
  if (ev.op === 'row_pattern.upsert' && /\"(value|v|formula|f|cached)\"/.test(JSON.stringify(ev))) errors.push('row_pattern contains value payload');
}

function validateValueEvent(ev, errors) {
  if (opIsMeta(ev)) return;
  if (!VALUE_OPS.has(ev.op)) errors.push(`values layer op=${ev.op} is not a values op`);
  ensureNoKeys(errors, ev, DESIGN_FIELDS, 'values');
  if (ev.op === 'row.values') {
    for (const key of ['pattern', 'pattern_id', 'style', 'cells', 'merges', 'row_attrs']) if (ev[key] !== undefined) errors.push(`values layer op=row.values must not contain pattern/style/cells/merges`);
    if (Array.isArray(ev.values)) {
      for (const item of ev.values) if (item && typeof item === 'object' && !Array.isArray(item)) ensureNoKeys(errors, item, DESIGN_FIELDS, 'values row item');
    }
  }
}

function validateAssetEvent(ev, errors) {
  if (opIsMeta(ev)) return;
  if (!ASSET_OPS.has(ev.op)) errors.push(`assets layer op=${ev.op} is not an assets op`);
  if (hasAny(ev, VALUE_FIELDS)) errors.push(`assets layer op=${ev.op} must not contain value/formula payload`);
}


function removeLayerMeta(events) {
  return events.filter(ev => !opIsMeta(ev)).map(ev => withoutKeys(ev, ['layer', '_line']));
}

function sheetIdOf(state, sheetRef) {
  if (state.sheets.has(sheetRef)) return sheetRef;
  for (const [id, sheet] of state.sheets.entries()) if (sheet.name === sheetRef) return id;
  return null;
}

function valueCells(values) {
  const refs = [];
  for (const ev of values) {
    if (opIsMeta(ev)) continue;
    if (ev.op === 'cell.value.set' || ev.op === 'cell.formula.set' || ev.op === 'cell.value.clear') refs.push({ sheet: ev.sheet, cell: ev.cell || ev.ref, op: ev.op });
    if (ev.op === 'row.values') {
      const row = Number(ev.row);
      const start = colToIndex(ev.start_col || ev.from_col || ev.col || 1);
      (ev.values || []).forEach((item, index) => {
        const col = item && typeof item === 'object' && !Array.isArray(item) && (item.col || item.column) ? colToIndex(item.col || item.column) : start + index;
        refs.push({ sheet: ev.sheet, cell: cellRef(row, col), op: ev.op });
      });
    }
  }
  return refs.filter(x => x.sheet && x.cell);
}

function validateValueCellsAgainstDesignMerges(design, values, errors) {
  if (errors.length) return;
  let state;
  try { state = reduceEvents(removeLayerMeta(design)); } catch (err) { errors.push(`design layer cannot be reduced: ${err.message}`); return; }
  for (const ref of valueCells(values)) {
    const id = sheetIdOf(state, ref.sheet);
    if (!id) { errors.push(`values layer references unknown sheet: ${ref.sheet}`); continue; }
    const sheet = state.sheets.get(id);
    const rc = splitCellRef(ref.cell);
    for (const merge of sheet.merges || []) {
      const rect = merge.rect || parseRange(merge.range);
      const inside = rc.row >= rect.r1 && rc.row <= rect.r2 && rc.col >= rect.c1 && rc.col <= rect.c2;
      const topLeft = rc.row === rect.r1 && rc.col === rect.c1;
      if (inside && !topLeft) errors.push(`values layer writes covered merged cell ${ref.cell} in ${merge.range}; write ${cellRef(rect.r1, rect.c1)} only`);
    }
  }
}

function validateSeparatedLayers(layers, options = {}) {
  const errors = [];
  const design = asEvents(layers.design, options.jsonl || {});
  const values = asEvents(layers.values, options.jsonl || {});
  const assets = asEvents(layers.assets, options.jsonl || {});
  for (const [name, events] of [['design', design], ['values', values], ['assets', assets]]) {
    try { assertValidEventShapes(events); } catch (err) { errors.push(`${name}: ${err.message}`); }
  }
  for (const ev of design) validateDesignEvent(ev, errors);
  for (const ev of values) validateValueEvent(ev, errors);
  for (const ev of assets) validateAssetEvent(ev, errors);
  validateValueCellsAgainstDesignMerges(design, values, errors);
  return errors;
}

function assertSeparatedLayers(layers, options = {}) {
  const errors = validateSeparatedLayers(layers, options);
  if (errors.length) throw new Error(`separated JSONL validation failed:\n${errors.join('\n')}`);
  return true;
}

function composeSeparatedEvents(layers, options = {}) {
  assertSeparatedLayers(layers, options);
  const design = asEvents(layers.design, options.jsonl || {}).filter(ev => !opIsMeta(ev));
  const values = asEvents(layers.values, options.jsonl || {}).filter(ev => !opIsMeta(ev));
  const assets = asEvents(layers.assets, options.jsonl || {}).filter(ev => !opIsMeta(ev));
  const ordered = [...design, ...values, ...assets].map(ev => withoutKeys(ev, ['_line', 'layer']));
  if (options.renumber === false) return ordered;
  return renumber(ordered, Number.isInteger(options.startSeq) ? options.startSeq : 1);
}

function composeSeparatedLayers(layers, options = {}) {
  return composeSeparatedEvents(layers, options);
}

function manifestEvents() {
  return [
    { op: 'manifest.layer', layer: 'design', file: 'design.jsonl', required: true },
    { op: 'manifest.layer', layer: 'values', file: 'values.jsonl', required: true },
    { op: 'manifest.layer', layer: 'assets', file: 'assets.jsonl', required: false }
  ];
}

function stringifyLayeredJsonl(layers) {
  return {
    manifest: stringifyJsonl(manifestEvents()),
    design: stringifyJsonl(layers.design || []),
    values: stringifyJsonl(layers.values || []),
    assets: stringifyJsonl(layers.assets || [])
  };
}

function splitJsonlToLayeredJsonl(jsonlText, options = {}) {
  return stringifyLayeredJsonl(splitEventsByLayer(parseJsonlText(jsonlText, options.jsonl || {}), options));
}

function stringifySeparated(layers) {
  return stringifyLayeredJsonl(layers);
}

function composeLayeredJsonl(layers, options = {}) {
  return stringifyJsonl(composeSeparatedEvents(layers, options));
}

const splitSemanticEvents = splitEventsByLayer;
const splitEventsToLayeredEvents = splitEventsByLayer;

export {
  DESIGN_OPS,
  VALUE_OPS,
  ASSET_OPS,
  splitEventByLayer,
  splitEventsByLayer,
  splitSemanticEvents,
  splitEventsToLayeredEvents,
  splitJsonlToLayeredJsonl,
  stringifyLayeredJsonl,
  stringifySeparated,
  composeSeparatedEvents,
  composeSeparatedLayers,
  composeLayeredJsonl,
  validateSeparatedLayers,
  assertSeparatedLayers
};
