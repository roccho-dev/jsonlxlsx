import { assert } from './errors.mjs';
import { EXCEL_MAX_ROW } from './constants.mjs';
import { colToIndex, indexToCol, splitCellRef, cellRef, parseRange, normalizeRange, normalizeSqref, rangeSize, rangesOverlap, sheetNameIsValid, makeSafeSheetName, tableDisplayName } from './a1.mjs';
import { parseJsonlText } from './jsonl.mjs';
import { assertValidEventShapes } from './schema.mjs';
import { deepClone, deepMerge } from './style-catalog.mjs';
import { renderStateToXlsxBytes } from './hucre-renderer.mjs';

function emptySheet(id, name, order = 0) {
  return {
    id,
    name,
    order,
    hidden: false,
    state: null,
    source_part: null,
    cells: new Map(),
    rows: new Map(),
    columns: [],
    merges: [],
    validations: [],
    conditionalFormats: [],
    hyperlinks: [],
    tables: [],
    autoFilter: null,
    view: {},
    freeze: null,
    page: {},
    sheetFormat: {},
    protection: null,
    rawDrawingB64: null,
    rawDrawingRelB64: null,
    rawDrawingElements: [],
    rawDrawingRelsB64: null
  };
}

function createState() {
  return {
    title: 'JSONL workbook',
    creator: 'jsonl-xlsx-shiftleft-js',
    created: null,
    attrs: {},
    sheets: new Map(),
    sheetOrder: [],
    styles: {},
    rowPatterns: new Map(),
    definedNames: [],
    rawParts: new Map(),
    assets: new Map(),
    history: [],
    warnings: [],
    tableNames: new Set()
  };
}

function sheetKey(state, ref) {
  if (state.sheets.has(ref)) return ref;
  for (const [id, sh] of state.sheets.entries()) if (sh.name === ref) return id;
  throw new Error(`unknown sheet: ${ref}`);
}

function ensureSheet(state, ref) {
  return state.sheets.get(sheetKey(state, ref));
}

function cellHasContent(cell) {
  return !!cell && (cell.formula !== undefined || cell.cached_value !== undefined || (cell.value !== undefined && cell.value !== null && cell.value !== ''));
}

function setCell(sheet, ref, patch) {
  const rc = splitCellRef(ref);
  const norm = cellRef(rc.row, rc.col);
  const prev = sheet.cells.get(norm) || {};
  const next = { ...prev, ...deepClone(patch) };
  for (const key of ['v', 'f']) delete next[key];
  if (!cellHasContent(next) && next.style == null && Object.keys(next.extra_attrs || {}).length === 0) sheet.cells.delete(norm);
  else sheet.cells.set(norm, next);
}

function clearCell(sheet, ref, keepStyle) {
  const prev = sheet.cells.get(normalizeRange(ref));
  if (!prev) return;
  if (keepStyle && prev.style) sheet.cells.set(normalizeRange(ref), { style: prev.style });
  else sheet.cells.delete(normalizeRange(ref));
}

function clearCellValue(sheet, ref) {
  const norm = normalizeRange(ref);
  const prev = sheet.cells.get(norm);
  if (!prev) return;
  const next = { ...deepClone(prev) };
  for (const key of ['value', 'v', 'formula', 'f', 'cached_value', 'cached', 'cached_type', 'type', 'cell_type', 'formula_attrs']) delete next[key];
  if (!cellHasContent(next) && next.style == null && Object.keys(next.extra_attrs || {}).length === 0) sheet.cells.delete(norm);
  else sheet.cells.set(norm, next);
}

function assertNoMergeOverlap(sheet, range) {
  const rect = parseRange(range);
  const normalized = normalizeRange(range);
  for (const m of sheet.merges) {
    if (m.range === normalized) return;
    assert(!rangesOverlap(m.rect, rect), `merge overlaps existing merge: ${normalized} overlaps ${m.range}`);
  }
}

function assertMergeDoesNotCoverNonEmpty(sheet, range) {
  const rect = parseRange(range);
  const topLeft = cellRef(rect.r1, rect.c1);
  for (let r = rect.r1; r <= rect.r2; r++) {
    for (let c = rect.c1; c <= rect.c2; c++) {
      const ref = cellRef(r, c);
      if (ref === topLeft) continue;
      if (cellHasContent(sheet.cells.get(ref))) throw new Error(`merge would cover non-empty cells: ${range} covers ${ref}`);
    }
  }
}

function addMerge(sheet, range) {
  const rect = parseRange(range);
  const normalized = normalizeRange(range);
  assertNoMergeOverlap(sheet, normalized);
  assertMergeDoesNotCoverNonEmpty(sheet, normalized);
  if (!sheet.merges.some(m => m.range === normalized)) sheet.merges.push({ range: normalized, rect });
}

function removeMerge(sheet, range) {
  const normalized = normalizeRange(range);
  sheet.merges = sheet.merges.filter(m => m.range !== normalized);
}

function normalizeCellPatch(obj) {
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    const patch = {};
    if (obj.value !== undefined || obj.v !== undefined) patch.value = obj.value !== undefined ? obj.value : obj.v;
    if (obj.formula !== undefined || obj.f !== undefined) patch.formula = obj.formula !== undefined ? obj.formula : obj.f;
    if (obj.cached_value !== undefined || obj.cached !== undefined) patch.cached_value = obj.cached_value !== undefined ? obj.cached_value : obj.cached;
    if (obj.cached_type !== undefined) patch.cached_type = obj.cached_type;
    if (obj.type !== undefined || obj.cell_type !== undefined || obj.t !== undefined) patch.type = obj.type !== undefined ? obj.type : (obj.cell_type !== undefined ? obj.cell_type : obj.t);
    if (obj.style !== undefined) patch.style = obj.style;
    if (obj.formula_attrs !== undefined) patch.formula_attrs = obj.formula_attrs;
    if (obj.extra_attrs !== undefined) patch.extra_attrs = obj.extra_attrs;
    if (obj.hyperlink !== undefined) patch.hyperlink = obj.hyperlink;
    return patch;
  }
  return { value: obj };
}

function applyRangeStyle(sheet, range, style) {
  const rect = parseRange(range);
  assert(rangeSize(rect) <= 20000, `range.style would materialize too many cells: ${range}`);
  for (let r = rect.r1; r <= rect.r2; r++) for (let c = rect.c1; c <= rect.c2; c++) setCell(sheet, cellRef(r, c), { style });
}

function applyRowEmit(state, ev) {
  const sheet = ensureSheet(state, ev.sheet);
  const rowNo = Number(ev.row);
  assert(Number.isInteger(rowNo) && rowNo >= 1 && rowNo <= EXCEL_MAX_ROW, `row out of Excel bounds: ${ev.row}`);
  const patternId = ev.pattern || ev.pattern_id;
  const pattern = patternId ? state.rowPatterns.get(patternId) : null;
  if (patternId) assert(pattern, `unknown row pattern: ${patternId}`);
  if (pattern && pattern.row) sheet.rows.set(rowNo, { ...(sheet.rows.get(rowNo) || {}), ...deepClone(pattern.row) });
  if (pattern && Array.isArray(pattern.cells)) {
    for (const p of pattern.cells) {
      const from = colToIndex(p.from_col || p.from || p.col);
      const to = colToIndex(p.to_col || p.to || p.from_col || p.from || p.col);
      for (let c = Math.min(from, to); c <= Math.max(from, to); c++) setCell(sheet, cellRef(rowNo, c), { style: p.style });
    }
  }
  if (pattern && Array.isArray(pattern.merges)) {
    for (const m of pattern.merges) {
      const from = colToIndex(m.from_col || m.from || m.col);
      const to = colToIndex(m.to_col || m.to || m.from_col || m.from || m.col);
      addMerge(sheet, `${cellRef(rowNo, Math.min(from, to))}:${cellRef(rowNo, Math.max(from, to))}`);
    }
  }
  if (Array.isArray(ev.values)) {
    const startCol = colToIndex(ev.start_col || ev.from_col || ev.col || 1);
    ev.values.forEach((value, idx) => {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const col = colToIndex(value.col || value.column || (startCol + idx));
        const patch = normalizeCellPatch(value);
        const ref = cellRef(rowNo, col);
        setCell(sheet, ref, patch);
        if (patch.hyperlink) sheet.hyperlinks.push({ ref, ...deepClone(patch.hyperlink) });
      } else {
        setCell(sheet, cellRef(rowNo, startCol + idx), { value });
      }
    });
  }
}


function applyRowValues(state, ev) {
  const sheet = ensureSheet(state, ev.sheet);
  const rowNo = Number(ev.row);
  assert(Number.isInteger(rowNo) && rowNo >= 1 && rowNo <= EXCEL_MAX_ROW, `row out of Excel bounds: ${ev.row}`);
  assert(Array.isArray(ev.values), 'row.values requires values array');
  const startCol = colToIndex(ev.start_col || ev.from_col || ev.col || 1);
  ev.values.forEach((value, idx) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const col = colToIndex(value.col || value.column || (startCol + idx));
      const patch = normalizeCellPatch(value);
      for (const key of ['style', 'extra_attrs', 'hyperlink']) delete patch[key];
      setCell(sheet, cellRef(rowNo, col), patch);
    } else {
      setCell(sheet, cellRef(rowNo, startCol + idx), { value });
    }
  });
}


function applyDataValidation(sheet, ev) {
  const sqref = ev.sqref || ev.range || ev.ref;
  assert(sqref, 'data_validation.add requires range/sqref');
  const rule = deepClone(ev.rule || {});
  if (ev.type) rule.type = ev.type;
  if (ev.operator) rule.operator = ev.operator;
  if (ev.allow_blank != null) rule.allowBlank = ev.allow_blank;
  if (ev.allowBlank != null) rule.allowBlank = ev.allowBlank;
  if (ev.formula1 != null) rule.formula1 = ev.formula1;
  if (ev.formula2 != null) rule.formula2 = ev.formula2;
  if (Array.isArray(ev.values)) {
    const lit = `"${ev.values.map(v => String(v).replace(/"/g, '""')).join(',')}"`;
    assert(lit.length <= 255, 'data validation literal list must be <= 255 characters; use formula1 range instead');
    rule.type = rule.type || 'list';
    rule.formula1 = lit;
  }
  sheet.validations.push({ sqref: normalizeSqref(sqref), rule });
}

function normalizeFreeze(ev) {
  if (ev.attrs) return deepClone(ev.attrs);
  const cell = ev.cell || ev.topLeftCell || 'A1';
  const rc = splitCellRef(cell);
  const attrs = { state: 'frozen', topLeftCell: cell };
  if (rc.col > 1) attrs.xSplit = String(rc.col - 1);
  if (rc.row > 1) attrs.ySplit = String(rc.row - 1);
  if (rc.col > 1 && rc.row > 1) attrs.activePane = 'bottomRight';
  else if (rc.col > 1) attrs.activePane = 'topRight';
  else if (rc.row > 1) attrs.activePane = 'bottomLeft';
  return attrs;
}

function reduceEvents(events, options = {}) {
  const state = createState();
  let lastSeq = -Infinity;
  for (const ev of events) {
    assert(ev && typeof ev === 'object' && !Array.isArray(ev), 'event must be an object');
    if (ev.seq !== undefined) {
      const seq = Number(ev.seq);
      assert(Number.isFinite(seq), `invalid seq at line ${ev._line || '?'}`);
      assert(seq >= lastSeq, `seq must be append-only nondecreasing. line=${ev._line || '?'} seq=${seq} previous=${lastSeq}`);
      lastSeq = seq;
    }
    state.history.push(deepClone(ev));
    const op = ev.op;
    switch (op) {
      case 'schema.declare':
      case 'layer.declare':
      case 'manifest.layer':
        break;
      case 'workbook.init':
      case 'workbook.patch':
        if (ev.title !== undefined) state.title = ev.title;
        if (ev.creator !== undefined) state.creator = ev.creator;
        if (ev.created !== undefined) state.created = ev.created;
        if (ev.attrs && typeof ev.attrs === 'object') state.attrs = { ...state.attrs, ...deepClone(ev.attrs) };
        break;
      case 'defined_name.set':
      case 'defined_name.upsert':
        state.definedNames.push(deepClone(ev));
        break;
      case 'sheet.upsert': {
        const id = ev.sheet_id || ev.sheet || ev.id || ev.name;
        assert(id, 'sheet.upsert requires sheet_id/sheet/name');
        const used = new Set([...state.sheets.values()].filter(s => s.id !== id).map(s => s.name));
        let name = ev.name || id;
        if (!sheetNameIsValid(name)) {
          assert(ev.sanitize === true, `invalid sheet name: ${name}`);
          name = makeSafeSheetName(name, used);
        }
        assert(sheetNameIsValid(name), `invalid sheet name: ${name}`);
        for (const [otherId, s] of state.sheets.entries()) assert(otherId === id || s.name !== name, `duplicate sheet name: ${name}`);
        if (!state.sheets.has(id)) state.sheetOrder.push(id);
        const prev = state.sheets.get(id) || emptySheet(id, name, ev.order || state.sheetOrder.length);
        const next = { ...prev, ...deepClone(ev), id, name, order: ev.order != null ? Number(ev.order) : prev.order };
        next.hidden = ev.hidden === true || ev.state === 'hidden' || prev.hidden;
        next.state = ev.state || (next.hidden ? 'hidden' : null);
        for (const key of ['cells', 'rows', 'columns', 'merges', 'validations', 'conditionalFormats', 'hyperlinks', 'tables', 'rawDrawingElements']) if (prev[key]) next[key] = prev[key];
        state.sheets.set(id, next);
        break;
      }
      case 'sheet.delete': {
        const id = sheetKey(state, ev.sheet || ev.sheet_id);
        state.sheets.delete(id);
        state.sheetOrder = state.sheetOrder.filter(k => k !== id);
        break;
      }
      case 'sheet.view': {
        const sheet = ensureSheet(state, ev.sheet);
        sheet.view = { ...sheet.view, ...deepClone(ev) };
        break;
      }
      case 'sheet.freeze':
      case 'pane.freeze': {
        const sheet = ensureSheet(state, ev.sheet);
        sheet.freeze = normalizeFreeze(ev);
        break;
      }
      case 'sheet.page': {
        const sheet = ensureSheet(state, ev.sheet);
        sheet.page = deepMerge(sheet.page || {}, { margins: ev.margins || ev.page_margins, setup: ev.setup || ev.page_setup });
        break;
      }
      case 'sheet_format.set': {
        const sheet = ensureSheet(state, ev.sheet);
        sheet.sheetFormat = { ...sheet.sheetFormat, ...deepClone(ev.attrs || ev) };
        break;
      }
      case 'sheet.protection':
      case 'sheet_protection.set': {
        const sheet = ensureSheet(state, ev.sheet);
        sheet.protection = deepClone(ev.attrs || ev.protection || {});
        break;
      }
      case 'style.upsert': {
        assert(ev.style_id, 'style.upsert requires style_id');
        const stylePayload = ev.style || ev.design || Object.fromEntries(Object.entries(ev).filter(([k]) => !['op', 'seq', 'ts', 'source', '_line', 'style_id'].includes(k)));
        state.styles[ev.style_id] = ev.mode === 'merge' && state.styles[ev.style_id] ? deepMerge(state.styles[ev.style_id], stylePayload) : deepClone(stylePayload);
        break;
      }
      case 'row_pattern.upsert':
        assert(ev.pattern_id, 'row_pattern.upsert requires pattern_id');
        state.rowPatterns.set(ev.pattern_id, deepClone(ev));
        break;
      case 'row.emit':
        applyRowEmit(state, ev);
        break;
      case 'row.values':
        applyRowValues(state, ev);
        break;
      case 'column.set': {
        const sheet = ensureSheet(state, ev.sheet);
        const from = colToIndex(ev.from_col || ev.from || ev.col || ev.min || 'A');
        const to = colToIndex(ev.to_col || ev.to || ev.max || ev.from_col || ev.from || ev.col || ev.min || 'A');
        assert(to >= from, `invalid column.set range: ${JSON.stringify(ev)}`);
        const attrs = deepClone(ev.attrs || {});
        sheet.columns.push({ ...attrs, ...deepClone(ev), from_col: indexToCol(from), to_col: indexToCol(to), min: from, max: to, style: ev.style || attrs.style, width: ev.width != null ? ev.width : attrs.width });
        break;
      }
      case 'row.set': {
        const sheet = ensureSheet(state, ev.sheet);
        const row = Number(ev.row);
        assert(Number.isInteger(row) && row >= 1 && row <= EXCEL_MAX_ROW, `row out of Excel bounds: ${ev.row}`);
        const attrs = deepClone(ev.attrs || {});
        sheet.rows.set(row, { ...(sheet.rows.get(row) || {}), ...attrs, ...deepClone(ev) });
        break;
      }
      case 'cell.set':
      case 'cell.value.set':
      case 'cell.formula.set': {
        const sheet = ensureSheet(state, ev.sheet);
        assert(ev.cell || ev.ref, `${op} requires cell/ref`);
        setCell(sheet, ev.cell || ev.ref, normalizeCellPatch(ev));
        break;
      }
      case 'cell.style': {
        const sheet = ensureSheet(state, ev.sheet);
        setCell(sheet, ev.cell || ev.ref, { style: ev.style });
        break;
      }
      case 'cell.clear': {
        const sheet = ensureSheet(state, ev.sheet);
        clearCell(sheet, ev.cell || ev.ref, ev.keep_style === true);
        break;
      }
      case 'cell.value.clear': {
        const sheet = ensureSheet(state, ev.sheet);
        clearCellValue(sheet, ev.cell || ev.ref);
        break;
      }
      case 'range.style': {
        const sheet = ensureSheet(state, ev.sheet);
        applyRangeStyle(sheet, ev.range || ev.ref, ev.style);
        break;
      }
      case 'range.merge': {
        const sheet = ensureSheet(state, ev.sheet);
        addMerge(sheet, ev.range || ev.ref);
        break;
      }
      case 'range.unmerge': {
        const sheet = ensureSheet(state, ev.sheet);
        removeMerge(sheet, ev.range || ev.ref);
        break;
      }
      case 'auto_filter.set':
      case 'autofilter.set':
      case 'sheet.auto_filter': {
        const sheet = ensureSheet(state, ev.sheet);
        sheet.autoFilter = { ref: normalizeRange(ev.range || ev.ref), attrs: deepClone(ev.attrs || {}) };
        break;
      }
      case 'table.add': {
        const sheet = ensureSheet(state, ev.sheet);
        const range = normalizeRange(ev.range || ev.ref);
        const rect = parseRange(range);
        assert(rect.r2 > rect.r1, `table ${ev.name || ''} must include at least one data row`);
        const name = tableDisplayName(ev.name || `Table${state.tableNames.size + 1}`);
        assert(!state.tableNames.has(name), `duplicate table name: ${name}`);
        state.tableNames.add(name);
        sheet.tables.push({ ...deepClone(ev), name, range, style: ev.style || 'TableStyleMedium2' });
        break;
      }
      case 'data_validation.add':
        applyDataValidation(ensureSheet(state, ev.sheet), ev);
        break;
      case 'conditional_format.add': {
        const sheet = ensureSheet(state, ev.sheet);
        sheet.conditionalFormats.push({ ...deepClone(ev), range: normalizeSqref(ev.range || ev.sqref || ev.ref) });
        break;
      }
      case 'conditional_format.raw': {
        const sheet = ensureSheet(state, ev.sheet);
        sheet.conditionalFormats.push({ raw_xml: ev.raw_xml || ev.xml, range: ev.range || ev.sqref });
        break;
      }
      case 'hyperlink.set': {
        const sheet = ensureSheet(state, ev.sheet);
        sheet.hyperlinks.push({ ...deepClone(ev), ref: normalizeRange(ev.ref || ev.cell) });
        break;
      }
      case 'asset.drawing.element': {
        const sheet = ensureSheet(state, ev.sheet);
        sheet.rawDrawingElements.push(deepClone(ev));
        break;
      }
      case 'asset.drawing.rels': {
        const sheet = ensureSheet(state, ev.sheet);
        sheet.rawDrawingRelsB64 = ev.rels_b64 || ev.data_b64 || null;
        break;
      }
      case 'asset.media.part': {
        const path = ev.path || `xl/media/${ev.asset_id || 'asset.bin'}`;
        assert(String(path).startsWith('xl/media/') && !String(path).includes('..') && !String(path).includes('\\') && String(path).slice('xl/media/'.length) && !String(path).slice('xl/media/'.length).includes('/'), `asset.media.part path must be a direct xl/media/ file: ${path}`);
        state.rawParts.set(path, ev.data_b64 || ev.content_b64);
        break;
      }
      default:
        throw new Error(`unknown op at line ${ev._line || '?'}: ${op}`);
    }
  }
  assert(state.sheetOrder.length > 0, 'no sheet declared');
  return state;
}

function sortedSheets(state) {
  return state.sheetOrder.map(id => state.sheets.get(id)).filter(Boolean).sort((a, b) => (a.order || 0) - (b.order || 0) || state.sheetOrder.indexOf(a.id) - state.sheetOrder.indexOf(b.id));
}

function computedDimension(sheet) {
  const ranges = [];
  for (const ref of sheet.cells.keys()) {
    const rc = splitCellRef(ref);
    ranges.push({ r1: rc.row, c1: rc.col, r2: rc.row, c2: rc.col });
  }
  for (const r of sheet.rows.keys()) ranges.push({ r1: r, c1: 1, r2: r, c2: 1 });
  for (const m of sheet.merges) ranges.push(m.rect);
  for (const t of sheet.tables) ranges.push(parseRange(t.range));
  for (const h of sheet.hyperlinks) if (h.ref) ranges.push(parseRange(h.ref));
  if (!ranges.length) return 'A1';
  const r1 = Math.min(...ranges.map(r => r.r1));
  const c1 = Math.min(...ranges.map(r => r.c1));
  const r2 = Math.max(...ranges.map(r => r.r2));
  const c2 = Math.max(...ranges.map(r => r.c2));
  return normalizeRange(`${cellRef(r1, c1)}:${cellRef(r2, c2)}`);
}


async function buildXlsxBytes(stateOrEvents, options = {}, port = {}) {
  if (Array.isArray(stateOrEvents)) assertValidEventShapes(stateOrEvents);
  const state = Array.isArray(stateOrEvents) ? reduceEvents(stateOrEvents, options) : stateOrEvents;
  return renderStateToXlsxBytes(state, options, port);
}

async function compileJsonlTextToBytes(jsonl, options = {}, port = {}) {
  const events = parseJsonlText(jsonl, options.jsonl || {});
  assertValidEventShapes(events);
  return buildXlsxBytes(reduceEvents(events, options), options, port);
}

function buildXlsxFiles() {
  throw new Error('buildXlsxFiles was removed: XLSX serialization is delegated to hucre.writeXlsx');
}

export { createState, reduceEvents, buildXlsxFiles, buildXlsxBytes, compileJsonlTextToBytes, computedDimension, emptySheet };
