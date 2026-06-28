import { writeXlsx } from 'hucre/xlsx';
import { cellRef, indexToCol, parseRange, splitCellRef } from './a1.mjs';
import { base64Decode, utf8Decode, utf8Encode } from './binary.mjs';
import { eventHash } from './jsonl.mjs';
import { createStyleCatalog, deepClone } from './style-catalog.mjs';
import { readZip, writeZip, entriesToMap } from './zip.mjs';

function sortedSheets(state) {
  return state.sheetOrder
    .map(id => state.sheets.get(id))
    .filter(Boolean)
    .sort((a, b) => (a.order || 0) - (b.order || 0) || state.sheetOrder.indexOf(a.id) - state.sheetOrder.indexOf(b.id));
}

function toBool(v) {
  if (v === true || v === 1 || v === '1' || v === 'true') return true;
  if (v === false || v === 0 || v === '0' || v === 'false') return false;
  return v == null ? undefined : Boolean(v);
}

function num(v) {
  if (v == null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function normalizeExcelText(value) {
  return typeof value === 'string' ? value.replace(/\r\n/g, '\n').replace(/\r/g, '\n') : value;
}

function xmlEscapeAttr(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function relsPathForPart(part) {
  const clean = String(part || '').replace(/\\/g, '/');
  const idx = clean.lastIndexOf('/');
  const dir = idx >= 0 ? clean.slice(0, idx) : '';
  const base = idx >= 0 ? clean.slice(idx + 1) : clean;
  return `${dir}/_rels/${base}.rels`;
}

function relativeTarget(fromPart, toPart) {
  const from = String(fromPart || '').split('/').slice(0, -1).filter(Boolean);
  const to = String(toPart || '').split('/').filter(Boolean);
  let i = 0;
  while (i < from.length && i < to.length && from[i] === to[i]) i++;
  const ups = from.slice(i).map(() => '..');
  return [...ups, ...to.slice(i)].join('/') || to[to.length - 1] || '';
}

function decodeXmlPartB64(b64) {
  return utf8Decode(base64Decode(b64 || ''));
}

function xmlUnescape(text) {
  return String(text || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function attr(xml, name) {
  const re = new RegExp(`(?:^|\\s)(?:[A-Za-z0-9_]+:)?${name}=["']([^"']*)["']`);
  const m = String(xml || '').match(re);
  return m ? xmlUnescape(m[1]) : undefined;
}

function colorToHucre(color) {
  if (color == null || color === '') return undefined;
  if (typeof color === 'object') {
    if (color.rgb != null) return colorToHucre(color.rgb);
    if (color.color != null) return colorToHucre(color.color);
    const out = {};
    if (color.theme != null) out.theme = Number(color.theme);
    if (color.tint != null) out.tint = Number(color.tint);
    if (color.indexed != null) out.indexed = Number(color.indexed);
    return Object.keys(out).length ? out : undefined;
  }
  let s = String(color).trim();
  const named = { black: 'FF000000', white: 'FFFFFFFF', red: 'FFFF0000', green: 'FF008000', blue: 'FF0000FF', yellow: 'FFFFFF00', gray: 'FF808080', grey: 'FF808080' };
  if (named[s.toLowerCase()]) s = named[s.toLowerCase()];
  if (s.startsWith('#')) s = s.slice(1);
  s = s.toUpperCase();
  if (/^[0-9A-F]{6}$/.test(s) || /^[0-9A-F]{8}$/.test(s)) return { rgb: s };
  throw new Error(`invalid RGB/ARGB color: ${JSON.stringify(color)}`);
}

function fontToHucre(font) {
  if (!font) return undefined;
  const out = {};
  if (font.name) out.name = String(font.name);
  if (font.size != null || font.sz != null) out.size = Number(font.size ?? font.sz);
  if (font.bold || font.b) out.bold = true;
  if (font.italic || font.i) out.italic = true;
  if (font.underline != null || font.u != null) out.underline = font.underline ?? font.u;
  if (font.strikethrough || font.strike) out.strikethrough = true;
  const c = colorToHucre(font.color);
  if (c) out.color = c;
  if (font.vertAlign) out.vertAlign = font.vertAlign;
  if (font.family != null) out.family = Number(font.family);
  if (font.charset != null) out.charset = Number(font.charset);
  if (font.scheme) out.scheme = font.scheme;
  return Object.keys(out).length ? out : undefined;
}

function fillToHucre(fill) {
  if (!fill) return undefined;
  if (typeof fill === 'string') return { type: 'pattern', pattern: 'solid', fgColor: colorToHucre(fill) };
  const pattern = fill.patternType || fill.pattern || fill.type || 'solid';
  const out = { type: 'pattern', pattern };
  const fg = colorToHucre(fill.fgColor || fill.color);
  const bg = colorToHucre(fill.bgColor);
  if (fg) out.fgColor = fg;
  if (bg) out.bgColor = bg;
  return out;
}

function borderSideToHucre(side) {
  if (!side) return undefined;
  if (typeof side === 'string') return { style: side };
  if (!side.style) return undefined;
  const out = { style: side.style };
  const c = colorToHucre(side.color);
  if (c) out.color = c;
  return out;
}

function borderToHucre(border) {
  if (!border) return undefined;
  const out = {};
  for (const key of ['left', 'right', 'top', 'bottom', 'diagonal']) {
    const side = borderSideToHucre(border[key]);
    if (side) out[key] = side;
  }
  if (border.diagonalUp != null) out.diagonalUp = toBool(border.diagonalUp);
  if (border.diagonalDown != null) out.diagonalDown = toBool(border.diagonalDown);
  return Object.keys(out).length ? out : undefined;
}

function alignmentToHucre(alignment) {
  if (!alignment) return undefined;
  const out = {};
  for (const key of ['horizontal', 'vertical', 'indent', 'readingOrder']) if (alignment[key] != null) out[key] = alignment[key];
  if (alignment.textRotation != null || alignment.text_rotation != null) out.textRotation = Number(alignment.textRotation ?? alignment.text_rotation);
  if (alignment.wrapText != null || alignment.wrap_text != null) out.wrapText = toBool(alignment.wrapText ?? alignment.wrap_text);
  if (alignment.shrinkToFit != null || alignment.shrink_to_fit != null) out.shrinkToFit = toBool(alignment.shrinkToFit ?? alignment.shrink_to_fit);
  return Object.keys(out).length ? out : undefined;
}

function protectionToHucre(protection) {
  if (!protection) return undefined;
  const out = {};
  if (protection.locked != null) out.locked = toBool(protection.locked);
  if (protection.hidden != null) out.hidden = toBool(protection.hidden);
  return Object.keys(out).length ? out : undefined;
}

function styleToHucre(styleRef, catalog) {
  if (!styleRef) return undefined;
  const style = catalog.normalizeStyle(catalog.resolve(styleRef));
  const out = {};
  const font = fontToHucre(style.font);
  if (font) out.font = font;
  const fill = fillToHucre(style.fill);
  if (fill) out.fill = fill;
  const border = borderToHucre(style.border);
  if (border) out.border = border;
  const alignment = alignmentToHucre(style.alignment);
  if (alignment) out.alignment = alignment;
  const fmt = style.number_format || style.numberFormat || style.numFmt;
  if (fmt) out.numFmt = String(fmt);
  const protection = protectionToHucre(style.protection);
  if (protection) out.protection = protection;
  return Object.keys(out).length ? out : undefined;
}

function formulaAttrsToHucre(cell, out) {
  const attrs = cell.formula_attrs || {};
  if (attrs.t === 'shared') {
    out.formulaType = 'shared';
    if (attrs.si != null) out.formulaSharedIndex = Number(attrs.si);
    if (attrs.ref != null) out.formulaRef = attrs.ref;
  } else if (attrs.t === 'array') {
    out.formulaType = 'array';
    if (attrs.ref != null) out.formulaRef = attrs.ref;
  }
  if (attrs.cm != null) out.formulaDynamic = toBool(attrs.cm);
}

function cellToHucre(cell, catalog) {
  const out = {};
  const st = styleToHucre(cell.style, catalog);
  if (st) out.style = st;
  const formula = cell.formula !== undefined ? cell.formula : cell.f;
  if (formula !== undefined && formula !== null) {
    out.value = normalizeExcelText(cell.cached_value !== undefined ? cell.cached_value : (cell.cached !== undefined ? cell.cached : null));
    out.formula = String(formula).replace(/^=/, '');
    if (cell.cached_value !== undefined || cell.cached !== undefined) out.formulaResult = out.value;
    formulaAttrsToHucre(cell, out);
    return out;
  }
  const value = cell.value !== undefined ? cell.value : cell.v;
  out.value = value === undefined ? null : normalizeExcelText(value);
  return out;
}

function applyHyperlinks(sheet, hucreCells) {
  for (const hl of sheet.hyperlinks || []) {
    const ref = hl.ref || hl.cell || hl.attrs?.ref;
    if (!ref) continue;
    const rect = parseRange(ref);
    if (rect.r1 !== rect.r2 || rect.c1 !== rect.c2) continue;
    const key = `${rect.r1 - 1},${rect.c1 - 1}`;
    const cell = hucreCells.get(key) || { value: null };
    const attrs = hl.attrs || {};
    const target = hl.target || attrs.target || '';
    const location = hl.location || attrs.location || '';
    const display = normalizeExcelText(hl.display || hl.text || attrs.display || attrs.text);
    const tooltip = hl.tooltip || attrs.tooltip;
    if (target || location) {
      cell.hyperlink = location && !target
        ? { target: '', location, display, tooltip }
        : { target, display, tooltip };
      hucreCells.set(key, cell);
    }
  }
}

function columnsToHucre(sheet, catalog) {
  const cols = [];
  for (const c of sheet.columns || []) {
    const start = Number(c.min || 1);
    const end = Number(c.max || start);
    for (let i = start; i <= end; i++) {
      const idx = i - 1;
      const prev = cols[idx] || {};
      const next = { ...prev };
      const width = c.width != null ? c.width : c.attrs?.width;
      if (width != null) next.width = Number(width);
      const hidden = c.hidden != null ? c.hidden : c.attrs?.hidden;
      if (hidden != null) next.hidden = toBool(hidden);
      const outline = c.outlineLevel != null ? c.outlineLevel : c.attrs?.outlineLevel;
      if (outline != null) next.outlineLevel = Number(outline);
      const collapsed = c.collapsed != null ? c.collapsed : c.attrs?.collapsed;
      if (collapsed != null) next.collapsed = toBool(collapsed);
      const style = c.style || c.attrs?.style;
      if (style) next.style = styleToHucre(style, catalog);
      cols[idx] = next;
    }
  }
  return cols.length ? Array.from({ length: cols.length }, (_, i) => cols[i] || {}) : undefined;
}

function rowsToHucre(sheet) {
  const defs = new Map();
  for (const [row, r] of sheet.rows.entries()) {
    const out = {};
    const height = r.height != null ? r.height : (r.ht != null ? r.ht : r.h);
    if (height != null) out.height = Number(height);
    if (r.hidden != null) out.hidden = toBool(r.hidden);
    if (r.outlineLevel != null) out.outlineLevel = Number(r.outlineLevel);
    if (r.collapsed != null) out.collapsed = toBool(r.collapsed);
    if (Object.keys(out).length) defs.set(Number(row) - 1, out);
  }
  return defs.size ? defs : undefined;
}

function mergesToHucre(sheet) {
  return (sheet.merges || []).map(m => {
    const r = m.rect || parseRange(m.range);
    return { startRow: r.r1 - 1, startCol: r.c1 - 1, endRow: r.r2 - 1, endCol: r.c2 - 1 };
  });
}

function dataValidationsToHucre(sheet) {
  return (sheet.validations || []).map(dv => {
    const rule = { ...(dv.rule || {}) };
    const out = {
      range: dv.sqref || dv.range || rule.sqref,
      type: rule.type || dv.type || 'custom'
    };
    if (rule.operator || dv.operator) out.operator = rule.operator || dv.operator;
    if (rule.formula1 != null) out.formula1 = rule.formula1;
    if (rule.formula2 != null) out.formula2 = rule.formula2;
    if (rule.allowBlank != null || rule.allow_blank != null || dv.allowBlank != null || dv.allow_blank != null) out.allowBlank = toBool(rule.allowBlank ?? rule.allow_blank ?? dv.allowBlank ?? dv.allow_blank);
    if (rule.showInputMessage != null) out.showInputMessage = toBool(rule.showInputMessage);
    if (rule.showErrorMessage != null) out.showErrorMessage = toBool(rule.showErrorMessage);
    if (rule.inputTitle != null) out.inputTitle = rule.inputTitle;
    if (rule.inputMessage != null) out.inputMessage = rule.inputMessage;
    if (rule.errorTitle != null) out.errorTitle = rule.errorTitle;
    if (rule.errorMessage != null) out.errorMessage = rule.errorMessage;
    if (Array.isArray(dv.values)) out.values = dv.values.map(String);
    return out;
  }).filter(v => v.range);
}

function conditionalRulesToHucre(sheet, catalog) {
  let priority = 1;
  return (sheet.conditionalFormats || []).filter(cf => !cf.raw_xml).map(cf => {
    const out = {
      range: cf.range || cf.sqref || cf.ref,
      type: cf.type || 'expression',
      priority: cf.priority != null ? Number(cf.priority) : priority++
    };
    if (cf.operator) out.operator = cf.operator;
    if (cf.stopIfTrue != null) out.stopIfTrue = toBool(cf.stopIfTrue);
    if (cf.formula != null) out.formula = cf.formula;
    else if (cf.formula1 != null || cf.formula2 != null) out.formula = [cf.formula1, cf.formula2].filter(v => v != null);
    const style = cf.format || cf.style;
    if (style) out.style = styleToHucre(style, catalog);
    return out;
  }).filter(v => v.range);
}

function tableHeaderNames(sheet, table) {
  const rect = parseRange(table.range || table.ref);
  const used = new Set();
  const names = [];
  for (let c = rect.c1; c <= rect.c2; c++) {
    const v = sheet.cells.get(cellRef(rect.r1, c))?.value;
    let base = v != null && v !== '' ? String(v) : `Column${c - rect.c1 + 1}`;
    let candidate = base;
    let i = 2;
    while (used.has(candidate)) candidate = `${base}_${i++}`;
    used.add(candidate);
    names.push(candidate);
  }
  return names;
}

function tablesToHucre(sheet) {
  return (sheet.tables || []).map(t => ({
    name: t.name,
    displayName: t.displayName || t.name,
    range: t.range || t.ref,
    columns: tableHeaderNames(sheet, t).map(name => ({ name })),
    style: t.style || 'TableStyleMedium2',
    showRowStripes: true,
    showColumnStripes: false,
    showAutoFilter: true,
    showTotalRow: false
  })).filter(t => t.range && t.name);
}

function freezeToHucre(sheet) {
  if (!sheet.freeze) return undefined;
  const rows = num(sheet.freeze.ySplit);
  const columns = num(sheet.freeze.xSplit);
  if (rows || columns) return { rows: rows || 0, columns: columns || 0 };
  return undefined;
}

function viewToHucre(sheet) {
  const src = sheet.view || {};
  const out = {};
  if (src.showGridLines === false || src.show_grid_lines === false) out.showGridLines = false;
  if (src.showRowColHeaders === false || src.show_row_col_headers === false) out.showRowColHeaders = false;
  if (src.zoomScale != null) out.zoomScale = Number(src.zoomScale);
  if (src.rightToLeft != null) out.rightToLeft = toBool(src.rightToLeft);
  return Object.keys(out).length ? out : undefined;
}

function pageSetupToHucre(sheet) {
  const page = sheet.page || {};
  const margins = page.margins || page.page_margins;
  const setup = page.setup || page.page_setup;
  if (!margins && !setup) return undefined;
  const out = {};
  if (margins) {
    out.margins = {};
    for (const k of ['top', 'right', 'bottom', 'left', 'header', 'footer']) if (margins[k] != null) out.margins[k] = Number(margins[k]);
  }
  if (setup) {
    if (setup.orientation) out.orientation = setup.orientation;
    if (setup.scale != null) out.scale = Number(setup.scale);
    if (setup.fitToWidth != null) out.fitToWidth = Number(setup.fitToWidth);
    if (setup.fitToHeight != null) out.fitToHeight = Number(setup.fitToHeight);
    if (setup.fitToPage != null) out.fitToPage = toBool(setup.fitToPage);
    if (setup.paperSize === '9' || setup.paperSize === 9) out.paperSize = 'a4';
    else if (typeof setup.paperSize === 'string' && Number.isNaN(Number(setup.paperSize))) out.paperSize = setup.paperSize;
  }
  return out;
}

function protectionToHucreSheet(sheet) {
  if (!sheet.protection) return undefined;
  const p = sheet.protection;
  const out = {};
  for (const key of ['sheet', 'objects', 'scenarios', 'selectLockedCells', 'selectUnlockedCells', 'formatCells', 'formatColumns', 'formatRows', 'insertColumns', 'insertRows', 'insertHyperlinks', 'deleteColumns', 'deleteRows', 'sort', 'autoFilter', 'pivotTables']) {
    if (p[key] != null) out[key] = toBool(p[key]);
  }
  return Object.keys(out).length ? out : undefined;
}

function parseRelationships(relsB64) {
  const rels = new Map();
  if (!relsB64) return rels;
  const xml = utf8Decode(base64Decode(relsB64));
  const tagRe = /<Relationship\b[^>]*>/g;
  let m;
  while ((m = tagRe.exec(xml))) {
    const tag = m[0];
    const id = attr(tag, 'Id') || attr(tag, 'id');
    if (!id) continue;
    rels.set(id, { Id: id, Target: attr(tag, 'Target'), Type: attr(tag, 'Type'), TargetMode: attr(tag, 'TargetMode') });
  }
  return rels;
}

function joinDrawingTarget(drawingPart, target) {
  if (!target) return '';
  if (target.startsWith('/')) return target.slice(1);
  const dir = String(drawingPart || 'xl/drawings/drawing.xml').split('/').slice(0, -1);
  const parts = [...dir, ...target.split('/')];
  const out = [];
  for (const p of parts) {
    if (!p || p === '.') continue;
    if (p === '..') out.pop();
    else out.push(p);
  }
  return out.join('/');
}

function parseAnchor(xml) {
  function block(name) {
    const m = String(xml || '').match(new RegExp(`<(?:[A-Za-z0-9_]+:)?${name}>[\\s\\S]*?<\\/(?:[A-Za-z0-9_]+:)?${name}>`));
    return m ? m[0] : '';
  }
  function intTag(src, tag, fallback = 0) {
    const m = src.match(new RegExp(`<(?:[A-Za-z0-9_]+:)?${tag}>(-?\\d+)<\\/(?:[A-Za-z0-9_]+:)?${tag}>`));
    return m ? Number(m[1]) : fallback;
  }
  const from = block('from');
  const to = block('to');
  const a = { from: { row: intTag(from, 'row'), col: intTag(from, 'col') } };
  if (to) a.to = { row: intTag(to, 'row'), col: intTag(to, 'col') };
  return a;
}

function imageTypeFromPath(path) {
  const ext = String(path || '').toLowerCase().split('.').pop();
  if (ext === 'jpg' || ext === 'jpeg') return 'jpeg';
  if (['png', 'gif', 'svg', 'webp'].includes(ext)) return ext;
  return 'png';
}

function extractTextBoxText(xml) {
  const parts = [];
  const re = /<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>|<a:br\b[^>]*\/>/g;
  let m;
  while ((m = re.exec(xml))) {
    if (m[1] != null) parts.push(xmlUnescape(m[1]));
    else parts.push('\n');
  }
  return parts.join('').replace(/\n{3,}/g, '\n\n');
}

function drawingAssetsToHucre(sheet, state) {
  const rels = parseRelationships(sheet.rawDrawingRelsB64 || sheet.rawDrawingRelB64);
  const images = [];
  const textBoxes = [];
  for (const ev of sheet.rawDrawingElements || []) {
    const b64 = ev.raw_xml_b64 || ev.anchor_xml_b64 || ev.data_b64 || ev.xml_b64;
    const xml = ev.raw_xml != null ? String(ev.raw_xml) : (b64 ? utf8Decode(base64Decode(b64)) : '');
    if (!xml) continue;
    const anchor = parseAnchor(xml);
    if (/<(?:[A-Za-z0-9_]+:)?pic\b/.test(xml)) {
      const rid = attr(xml, 'embed') || attr(xml, 'link');
      const rel = rid ? rels.get(rid) : null;
      const mediaPath = rel ? joinDrawingTarget(ev.drawing_part || rel.Source || '', rel.Target) : '';
      const dataB64 = state.rawParts.get(mediaPath);
      if (!dataB64) continue;
      images.push({
        data: base64Decode(dataB64),
        type: imageTypeFromPath(mediaPath),
        anchor,
        altText: attr(xml, 'descr'),
        title: attr(xml, 'name')
      });
    } else if (/<(?:[A-Za-z0-9_]+:)?sp\b/.test(xml)) {
      const text = normalizeExcelText(extractTextBoxText(xml)).trim();
      if (text) textBoxes.push({ text, anchor, title: attr(xml, 'name'), altText: attr(xml, 'descr') });
    }
  }
  return { images: images.length ? images : undefined, textBoxes: textBoxes.length ? textBoxes : undefined };
}

function toHucreSheet(sheet, state, catalog) {
  const hucreCells = new Map();
  for (const [ref, cell] of sheet.cells.entries()) {
    const rc = splitCellRef(ref);
    hucreCells.set(`${rc.row - 1},${rc.col - 1}`, cellToHucre(cell, catalog));
  }
  applyHyperlinks(sheet, hucreCells);
  const drawing = drawingAssetsToHucre(sheet, state);
  const out = {
    name: sheet.name,
    rows: [],
    cells: hucreCells,
    columns: columnsToHucre(sheet, catalog),
    rowDefs: rowsToHucre(sheet),
    merges: mergesToHucre(sheet),
    dataValidations: dataValidationsToHucre(sheet),
    conditionalRules: conditionalRulesToHucre(sheet, catalog),
    autoFilter: sheet.autoFilter ? { range: sheet.autoFilter.ref || sheet.autoFilter.range } : undefined,
    freezePane: freezeToHucre(sheet),
    view: viewToHucre(sheet),
    pageSetup: pageSetupToHucre(sheet),
    protection: protectionToHucreSheet(sheet),
    hidden: sheet.state === 'hidden' || sheet.hidden === true,
    veryHidden: sheet.state === 'veryHidden',
    tables: tablesToHucre(sheet),
    images: drawing.images,
    textBoxes: drawing.textBoxes
  };
  for (const [k, v] of Object.entries(out)) {
    if (v == null) delete out[k];
    else if (Array.isArray(v) && v.length === 0) delete out[k];
    else if (v instanceof Map && v.size === 0) delete out[k];
  }
  if (!out.cells) out.rows = [[]];
  return out;
}

function historySheetToHucre(state, name) {
  const rows = [['seq', 'op', 'sha256', 'json']];
  for (const ev of state.history || []) rows.push([ev.seq ?? '', ev.op || '', eventHash(ev), JSON.stringify(ev)]);
  return {
    name,
    hidden: true,
    rows,
    columns: [{ width: 10 }, { width: 24 }, { width: 68 }, { width: 120 }]
  };
}


const DRAWING_REL_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing';
const HYPERLINK_REL_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink';
const DRAWING_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.drawing+xml';
const RELS_XMLNS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const DRAWING_ROOT_OPEN = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">';
const DRAWING_ROOT_CLOSE = '</xdr:wsDr>';

function parseRelationshipTags(xml) {
  const out = [];
  const re = /<Relationship\b[^>]*>/g;
  let m;
  while ((m = re.exec(String(xml || '')))) {
    const tag = m[0];
    const Id = attr(tag, 'Id') || attr(tag, 'id');
    const Type = attr(tag, 'Type');
    const Target = attr(tag, 'Target');
    const TargetMode = attr(tag, 'TargetMode');
    if (Id && Type && Target) out.push({ Id, Type, Target, TargetMode });
  }
  return out;
}

function serializeRelationshipTags(rels) {
  const body = rels.map(rel => {
    const attrs = [`Id="${xmlEscapeAttr(rel.Id)}"`, `Type="${xmlEscapeAttr(rel.Type)}"`, `Target="${xmlEscapeAttr(rel.Target)}"`];
    if (rel.TargetMode) attrs.push(`TargetMode="${xmlEscapeAttr(rel.TargetMode)}"`);
    return `<Relationship ${attrs.join(' ')}/>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${RELS_XMLNS}">${body}</Relationships>`;
}

function ensureWorksheetRelForDrawing(entries, sheetPart, drawingPart) {
  const relsPath = relsPathForPart(sheetPart);
  const existingXml = entries.has(relsPath) ? utf8Decode(entries.get(relsPath)) : '';
  const rels = parseRelationshipTags(existingXml).filter(rel => rel.Type !== DRAWING_REL_TYPE && !String(rel.Type || '').endsWith('/drawing'));
  const used = new Set(rels.map(rel => rel.Id));
  let rid;
  const sheetXml = entries.has(sheetPart) ? utf8Decode(entries.get(sheetPart)) : '';
  const existingDrawing = sheetXml.match(/<drawing\b[^>]*(?:r:)?id=["']([^"']+)["'][^>]*\/?>(?:<\/drawing>)?/);
  if (existingDrawing && !used.has(existingDrawing[1])) rid = existingDrawing[1];
  if (!rid) {
    for (let i = 1; ; i++) {
      const candidate = `rId${i}`;
      if (!used.has(candidate)) { rid = candidate; break; }
    }
  }
  rels.push({ Id: rid, Type: DRAWING_REL_TYPE, Target: relativeTarget(sheetPart, drawingPart) });
  entries.set(relsPath, utf8Encode(serializeRelationshipTags(rels)));
  return rid;
}

function ensureWorksheetDrawingTag(entries, sheetPart, rid) {
  if (!entries.has(sheetPart)) return;
  let xml = utf8Decode(entries.get(sheetPart));
  if (!/xmlns:r=/.test(xml)) {
    xml = xml.replace(/<worksheet\b/, '<worksheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"');
  }
  const drawingTag = `<drawing r:id="${xmlEscapeAttr(rid)}"/>`;
  if (/<drawing\b[^>]*\/?>(?:<\/drawing>)?/.test(xml)) {
    xml = xml.replace(/<drawing\b[^>]*\/?>(?:<\/drawing>)?/, drawingTag);
  } else {
    xml = xml.replace(/<\/worksheet>\s*$/, `${drawingTag}</worksheet>`);
  }
  entries.set(sheetPart, utf8Encode(xml));
}

function rawDrawingPartsFromState(state) {
  const parts = new Map();
  const relsParts = new Map();
  const sheetDrawing = new Map();
  for (const sheet of sortedSheets(state)) {
    const elements = [...(sheet.rawDrawingElements || [])];
    if (!elements.length) continue;
    const drawingPart = elements.find(ev => ev.drawing_part)?.drawing_part || `xl/drawings/drawing${sheetDrawing.size + 1}.xml`;
    const anchors = elements
      .map((ev, i) => ({ index: ev.anchor_index != null ? Number(ev.anchor_index) : i, xml: ev.raw_xml != null ? String(ev.raw_xml) : decodeXmlPartB64(ev.raw_xml_b64 || ev.anchor_xml_b64 || ev.data_b64 || ev.xml_b64) }))
      .sort((a, b) => a.index - b.index)
      .map(a => a.xml)
      .join('');
    parts.set(drawingPart, `${DRAWING_ROOT_OPEN}${anchors}${DRAWING_ROOT_CLOSE}`);
    sheetDrawing.set(sheet.id, drawingPart);
    if (sheet.rawDrawingRelsB64) relsParts.set(relsPathForPart(drawingPart), decodeXmlPartB64(sheet.rawDrawingRelsB64));
  }
  return { parts, relsParts, sheetDrawing };
}

function mediaContentType(path) {
  const ext = String(path || '').toLowerCase().split('.').pop();
  if (ext === 'png') return 'image/png';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'svg') return 'image/svg+xml';
  if (ext === 'webp') return 'image/webp';
  return undefined;
}

function ensureContentTypes(entries, drawingParts, mediaPaths) {
  const path = '[Content_Types].xml';
  if (!entries.has(path)) return;
  let xml = utf8Decode(entries.get(path));
  xml = xml.replace(/<Override\b[^>]*PartName=["']\/xl\/drawings\/drawing\d+\.xml["'][^>]*\/>/g, '');
  const defaults = [];
  const seenExt = new Set([...xml.matchAll(/<Default\b[^>]*Extension=["']([^"']+)["'][^>]*\/>/g)].map(m => m[1].toLowerCase()));
  for (const mediaPath of mediaPaths) {
    const ext = String(mediaPath).toLowerCase().split('.').pop();
    const ct = mediaContentType(mediaPath);
    if (ext && ct && !seenExt.has(ext)) {
      defaults.push(`<Default Extension="${xmlEscapeAttr(ext)}" ContentType="${xmlEscapeAttr(ct)}"/>`);
      seenExt.add(ext);
    }
  }
  if (defaults.length) {
    const firstOverride = xml.indexOf('<Override');
    if (firstOverride >= 0) xml = `${xml.slice(0, firstOverride)}${defaults.join('')}${xml.slice(firstOverride)}`;
    else xml = xml.replace(/<\/Types>\s*$/, `${defaults.join('')}</Types>`);
  }
  const overrides = [...drawingParts].sort().map(part => `<Override PartName="/${xmlEscapeAttr(part)}" ContentType="${DRAWING_CONTENT_TYPE}"/>`).join('');
  xml = xml.replace(/<\/Types>\s*$/, `${overrides}</Types>`);
  entries.set(path, utf8Encode(xml));
}


function hyperlinkEventRef(hl) {
  return hl.ref || hl.cell || hl.attrs?.ref;
}

function hyperlinkEventId(hl) {
  return hl.attrs?.id || hl.id || hl.rId || hl.rid;
}

function nextRelationshipId(used) {
  for (let i = 1; ; i++) {
    const candidate = `rId${i}`;
    if (!used.has(candidate)) return candidate;
  }
}

function addRawHyperlinksToWorksheet(entries, sheetPart, sheet) {
  const links = (sheet.hyperlinks || []).filter(hl => hyperlinkEventRef(hl));
  if (!links.length || !entries.has(sheetPart)) return;
  const relsPath = relsPathForPart(sheetPart);
  const existingRels = entries.has(relsPath) ? parseRelationshipTags(utf8Decode(entries.get(relsPath))) : [];
  const keptRels = existingRels.filter(rel => rel.Type !== HYPERLINK_REL_TYPE && !String(rel.Type || '').endsWith('/hyperlink'));
  const used = new Set(keptRels.map(rel => rel.Id));
  const hyperlinkTags = [];
  const newRels = [...keptRels];
  for (const hl of links) {
    const attrs = hl.attrs || {};
    const ref = hyperlinkEventRef(hl);
    const target = hl.target || attrs.target;
    const location = hl.location || attrs.location;
    const display = normalizeExcelText(hl.display || hl.text || attrs.display || attrs.text);
    const tooltip = normalizeExcelText(hl.tooltip || attrs.tooltip);
    if (target) {
      let rid = hyperlinkEventId(hl) || nextRelationshipId(used);
      if (used.has(rid)) rid = nextRelationshipId(used);
      used.add(rid);
      newRels.push({ Id: rid, Type: hl.relType || attrs.relType || HYPERLINK_REL_TYPE, Target: target, TargetMode: hl.targetMode || attrs.targetMode || 'External' });
      const tagAttrs = [`ref="${xmlEscapeAttr(ref)}"`, `id="${xmlEscapeAttr(rid)}"`];
      if (display) tagAttrs.push(`display="${xmlEscapeAttr(display)}"`);
      tagAttrs.push(`r:id="${xmlEscapeAttr(rid)}"`);
      if (tooltip) tagAttrs.push(`tooltip="${xmlEscapeAttr(tooltip)}"`);
      hyperlinkTags.push(`<hyperlink ${tagAttrs.join(' ')}/>`);
    } else if (location) {
      const tagAttrs = [`ref="${xmlEscapeAttr(ref)}"`, `location="${xmlEscapeAttr(location)}"`];
      if (display) tagAttrs.push(`display="${xmlEscapeAttr(display)}"`);
      if (tooltip) tagAttrs.push(`tooltip="${xmlEscapeAttr(tooltip)}"`);
      hyperlinkTags.push(`<hyperlink ${tagAttrs.join(' ')}/>`);
    }
  }
  if (newRels.length) entries.set(relsPath, utf8Encode(serializeRelationshipTags(newRels)));
  else entries.delete(relsPath);

  let xml = utf8Decode(entries.get(sheetPart));
  if (!/xmlns:r=/.test(xml) && hyperlinkTags.some(t => t.includes('r:id='))) {
    xml = xml.replace(/<worksheet\b/, '<worksheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"');
  }
  const block = `<hyperlinks>${hyperlinkTags.join('')}</hyperlinks>`;
  if (/<hyperlinks\b[\s\S]*?<\/hyperlinks>/.test(xml)) {
    xml = xml.replace(/<hyperlinks\b[\s\S]*?<\/hyperlinks>/, block);
  } else if (hyperlinkTags.length) {
    const insertBefore = xml.search(/<(?:pageMargins|pageSetup|drawing|legacyDrawing|picture|oleObjects|controls|webPublishItems|tableParts|extLst)\b|<\/worksheet>/);
    if (insertBefore >= 0) xml = `${xml.slice(0, insertBefore)}${block}${xml.slice(insertBefore)}`;
    else xml += block;
  }
  entries.set(sheetPart, utf8Encode(xml));
}

function preserveRawHyperlinksInEntries(entries, state) {
  for (const sheet of sortedSheets(state)) {
    if (!(sheet.hyperlinks || []).length) continue;
    const sheetPart = sheet.source_part || `xl/worksheets/sheet${sheet.order || sortedSheets(state).indexOf(sheet) + 1}.xml`;
    addRawHyperlinksToWorksheet(entries, sheetPart, sheet);
  }
}


function normalizeLegacyNumberLexemesInWorksheets(entries) {
  let changed = false;
  for (const [path, data] of [...entries.entries()]) {
    if (!/^xl\/worksheets\/sheet\d+\.xml$/.test(path)) continue;
    let xml = utf8Decode(data);
    const next = xml.replace(/<c\b([^>]*)>([\s\S]*?)<\/c>/g, (cellXml, attrs, body) => {
      const type = attr(`<c ${attrs}>`, 't');
      if (type && type !== 'n') return cellXml;
      return `<c${attrs}>${body.replace(/<v>([^<]+)<\/v>/g, (vXml, raw) => {
        const text = String(raw);
        if (!/[.eE]/.test(text)) return vXml;
        const n = Number(text);
        if (!Number.isFinite(n)) return vXml;
        const legacy = n.toPrecision(15);
        return `<v>${legacy}</v>`;
      })}</c>`;
    });
    if (next !== xml) {
      entries.set(path, utf8Encode(next));
      changed = true;
    }
  }
  return changed;
}

async function preserveRawDrawingsInXlsx(bytes, state, port = {}) {
  const raw = rawDrawingPartsFromState(state);
  const hasHyperlinks = sortedSheets(state).some(sheet => (sheet.hyperlinks || []).length);
  if (!raw.parts.size && !hasHyperlinks && typeof port.inflateRaw !== 'function') return bytes;
  const zipEntries = await readZip(bytes, {}, port);
  const entries = entriesToMap(raw.parts.size
    ? zipEntries.filter(e => !e.path.startsWith('xl/drawings/') && !e.path.startsWith('xl/media/'))
    : zipEntries);
  const numberLexemeChanged = normalizeLegacyNumberLexemesInWorksheets(entries);
  if (!raw.parts.size && !hasHyperlinks && !numberLexemeChanged) return bytes;
  if (raw.parts.size) {
    for (const [path, xml] of raw.parts) entries.set(path, utf8Encode(xml));
    for (const [path, xml] of raw.relsParts) entries.set(path, utf8Encode(xml));
    for (const [path, b64] of state.rawParts || []) entries.set(path, base64Decode(b64));
    for (const sheet of sortedSheets(state)) {
      const drawingPart = raw.sheetDrawing.get(sheet.id);
      if (!drawingPart) continue;
      const sheetPart = sheet.source_part || `xl/worksheets/sheet${sheet.order || sortedSheets(state).indexOf(sheet) + 1}.xml`;
      const rid = ensureWorksheetRelForDrawing(entries, sheetPart, drawingPart);
      ensureWorksheetDrawingTag(entries, sheetPart, rid);
    }
    ensureContentTypes(entries, raw.parts.keys(), (state.rawParts || new Map()).keys());
  }
  preserveRawHyperlinksInEntries(entries, state);
  const existingOrder = zipEntries.map(e => e.path).filter(path => entries.has(path));
  const ordered = [];
  const added = new Set();
  for (const path of existingOrder) {
    if (added.has(path)) continue;
    ordered.push({ path, data: entries.get(path) });
    added.add(path);
  }
  for (const [path, data] of [...entries.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (!added.has(path)) ordered.push({ path, data });
  }
  return writeZip(ordered, {}, port);
}

function namedRangesToHucre(state, sheets) {
  const out = [];
  for (const dn of state.definedNames || []) {
    const attrs = dn.attrs || {};
    const name = dn.name || attrs.name;
    const range = dn.text || dn.refers_to || dn.range;
    if (!name || !range) continue;
    const nr = { name, range };
    if (attrs.localSheetId != null) {
      const sheet = sheets[Number(attrs.localSheetId)];
      if (sheet) nr.scope = sheet.name;
    }
    if (dn.comment || attrs.comment) nr.comment = dn.comment || attrs.comment;
    out.push(nr);
  }
  return out.length ? out : undefined;
}

function buildHucreWorkbook(state, options = {}) {
  const catalog = createStyleCatalog(state.styles || {});
  const sheets = sortedSheets(state);
  if (!sheets.length) throw new Error('no sheets to write');
  const hucreSheets = sheets.map(sheet => toHucreSheet(sheet, state, catalog));
  if (options.historySheet) hucreSheets.push(historySheetToHucre(state, options.historySheet));
  const properties = {
    title: state.title || 'JSONL workbook',
    creator: state.creator || 'jsonl-xlsx-shiftleft-js',
    lastModifiedBy: state.creator || 'jsonl-xlsx-shiftleft-js'
  };
  const created = state.created || options.now;
  const modified = options.now || state.modified || state.created;
  if (created) properties.created = new Date(created);
  if (modified) properties.modified = new Date(modified);
  const wb = {
    sheets: hucreSheets,
    properties,
    namedRanges: namedRangesToHucre(state, sheets),
    stringMode: options.stringMode || 'shared'
  };
  if (state.attrs?.workbookPr?.date1904 || state.attrs?.date1904) wb.dateSystem = '1904';
  return wb;
}

async function renderStateToXlsxBytes(state, options = {}, port = {}) {
  const bytes = await writeXlsx(buildHucreWorkbook(state, options));
  return preserveRawDrawingsInXlsx(bytes, state, port);
}

export { buildHucreWorkbook, renderStateToXlsxBytes, sortedSheets, styleToHucre, cellToHucre };
