import { readZip, entriesToMap } from './zip.mjs';
import { parseXml, children, firstChild, descendants, textOf, attr, attrsWithoutNs, serializeXml, stripPrefix } from './xml.mjs';
import { indexToCol, normalizeRange } from './a1.mjs';
import { REL_TYPES, BUILTIN_NUMFMTS_BY_ID } from './constants.mjs';
import { base64Encode } from './binary.mjs';

function cleanPartPath(partPath) {
  return String(partPath || '').replace(/\\/g, '/').replace(/^\/+/, '');
}

function dirname(p) {
  const i = p.lastIndexOf('/');
  return i < 0 ? '' : p.slice(0, i);
}

function joinPartPath(basePartPath, target) {
  const t = String(target || '');
  if (t.startsWith('/')) return cleanPartPath(t);
  const stack = dirname(basePartPath).split('/').filter(Boolean);
  for (const part of t.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') stack.pop();
    else stack.push(part);
  }
  return stack.join('/');
}

function relsPathForPart(partPath) {
  const d = dirname(partPath);
  const b = partPath.slice(d ? d.length + 1 : 0);
  return d ? `${d}/_rels/${b}.rels` : `_rels/${b}.rels`;
}

function readRels(parts, relsPath) {
  const data = parts.get(relsPath);
  const rels = new Map();
  if (!data) return rels;
  const root = parseXml(data);
  for (const rel of children(root, 'Relationship')) {
    const id = attr(rel, 'Id');
    if (id) rels.set(id, attrsWithoutNs(rel));
  }
  return rels;
}

function findWorkbookPart(parts) {
  const rels = readRels(parts, '_rels/.rels');
  for (const rel of rels.values()) if (rel.Type === REL_TYPES.officeDocument) return cleanPartPath(rel.Target || 'xl/workbook.xml');
  return 'xl/workbook.xml';
}

function spreadsheetTextDecode(text) {
  return String(text || '').replace(/_x([0-9A-Fa-f]{4})_/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function spreadsheetStringText(node) {
  const pieces = [];
  function visit(current, insidePhonetic = false) {
    if (!current) return;
    if (current.name === '#text') return;
    const local = stripPrefix(current.name);
    const nextInsidePhonetic = insidePhonetic || local === 'rPh' || local === 'phoneticPr';
    if (local === 't') {
      if (!nextInsidePhonetic) pieces.push(textOf(current));
      return;
    }
    for (const child of current.children || []) visit(child, nextInsidePhonetic);
  }
  visit(node, false);
  return spreadsheetTextDecode(pieces.join(''));
}

function parseSharedStrings(parts, sharedPath = 'xl/sharedStrings.xml') {
  const data = parts.get(sharedPath);
  if (!data) return [];
  const root = parseXml(data);
  const out = [];
  for (const si of children(root, 'si')) out.push(spreadsheetStringText(si));
  return out;
}

function parseColorNode(node) {
  if (!node) return null;
  const attrs = attrsWithoutNs(node);
  if (attrs.rgb) return attrs.rgb;
  if (attrs.indexed || attrs.theme) return attrs;
  return Object.keys(attrs).length ? attrs : null;
}

function parseFont(font) {
  const out = {};
  if (firstChild(font, 'b')) out.bold = true;
  if (firstChild(font, 'i')) out.italic = true;
  if (firstChild(font, 'u')) out.underline = attr(firstChild(font, 'u'), 'val') || true;
  if (firstChild(font, 'strike')) out.strike = true;
  const name = firstChild(font, 'name');
  if (name && attr(name, 'val')) out.name = attr(name, 'val');
  const sz = firstChild(font, 'sz');
  if (sz && attr(sz, 'val')) out.size = Number(attr(sz, 'val')) || attr(sz, 'val');
  const family = firstChild(font, 'family');
  if (family && attr(family, 'val')) out.family = Number(attr(family, 'val')) || attr(family, 'val');
  const scheme = firstChild(font, 'scheme');
  if (scheme && attr(scheme, 'val')) out.scheme = attr(scheme, 'val');
  const color = parseColorNode(firstChild(font, 'color'));
  if (color) out.color = color;
  return out;
}

function parseFill(fill) {
  const pf = firstChild(fill, 'patternFill');
  if (!pf) return {};
  const out = {};
  if (attr(pf, 'patternType')) out.pattern = attr(pf, 'patternType');
  const fg = parseColorNode(firstChild(pf, 'fgColor'));
  if (fg) out.fgColor = fg;
  const bg = parseColorNode(firstChild(pf, 'bgColor'));
  if (bg) out.bgColor = bg;
  return out;
}

function parseBorderEdge(edge) {
  if (!edge) return null;
  const out = {};
  if (attr(edge, 'style')) out.style = attr(edge, 'style');
  const color = parseColorNode(firstChild(edge, 'color'));
  if (color) out.color = color;
  return Object.keys(out).length ? out : null;
}

function parseBorder(border) {
  const out = {};
  for (const side of ['left', 'right', 'top', 'bottom', 'diagonal']) {
    const edge = parseBorderEdge(firstChild(border, side));
    if (edge) out[side] = edge;
  }
  return out;
}

function parseStyles(parts, stylesPath = 'xl/styles.xml') {
  const data = parts.get(stylesPath);
  if (!data) return [];
  const root = parseXml(data);
  const numFmtMap = {};
  const numFmts = firstChild(root, 'numFmts');
  if (numFmts) for (const nf of children(numFmts, 'numFmt')) numFmtMap[attr(nf, 'numFmtId')] = attr(nf, 'formatCode');
  const fonts = children(firstChild(root, 'fonts'), 'font').map(parseFont);
  const fills = children(firstChild(root, 'fills'), 'fill').map(parseFill);
  const borders = children(firstChild(root, 'borders'), 'border').map(parseBorder);
  const events = [];
  const xfs = children(firstChild(root, 'cellXfs'), 'xf');
  xfs.forEach((xf, i) => {
    const st = {};
    const fontId = Number(attr(xf, 'fontId') || 0);
    const fillId = Number(attr(xf, 'fillId') || 0);
    const borderId = Number(attr(xf, 'borderId') || 0);
    if (fonts[fontId] && Object.keys(fonts[fontId]).length) st.font = fonts[fontId];
    if (fills[fillId] && Object.keys(fills[fillId]).length) st.fill = fills[fillId];
    if (borders[borderId] && Object.keys(borders[borderId]).length) st.border = borders[borderId];
    const numFmtId = attr(xf, 'numFmtId');
    const fmt = numFmtMap[numFmtId] || BUILTIN_NUMFMTS_BY_ID[String(numFmtId || '')];
    if (fmt && fmt !== 'General') st.number_format = fmt;
    const alignment = firstChild(xf, 'alignment');
    if (alignment) {
      st.alignment = attrsWithoutNs(alignment);
      if (st.alignment.wrapText != null) st.alignment.wrap_text = st.alignment.wrapText === '1' || st.alignment.wrapText === 'true';
    }
    const protection = firstChild(xf, 'protection');
    if (protection) st.protection = attrsWithoutNs(protection);
    events.push({ op: 'style.upsert', style_id: `xf_${i}`, ...st });
  });
  return events;
}

function normalizeNumeric(text) {
  if (text == null || text === '') return null;
  const n = Number(text);
  if (Number.isFinite(n) && String(text).trim() !== '') return n;
  return text;
}

function parseInlineString(c) {
  const is = firstChild(c, 'is');
  return is ? spreadsheetStringText(is) : '';
}

function parseCellValue(c, sharedStrings) {
  const t = attr(c, 't');
  const vNode = firstChild(c, 'v');
  const raw = vNode ? textOf(vNode) : '';
  if (t === 's') return { value: sharedStrings[Number(raw)] ?? '', cell_type: 'string' };
  if (t === 'inlineStr') return { value: parseInlineString(c), cell_type: 'string' };
  if (t === 'b') return { value: raw === '1' || raw === 'true', cell_type: 'bool' };
  if (t === 'e') return { value: raw, cell_type: 'error' };
  if (t === 'str') return { value: spreadsheetTextDecode(raw), cell_type: 'string' };
  if (t === 'd') return { value: raw, cell_type: 'date' };
  if (vNode) return { value: normalizeNumeric(raw), cell_type: typeof normalizeNumeric(raw) === 'number' ? 'number' : 'string' };
  return { value: null, cell_type: t || null };
}

async function extractSemanticEvents(xlsxBytes, options = {}, port = {}) {
  const parts = entriesToMap(await readZip(xlsxBytes, {}, port));
  const workbookPart = findWorkbookPart(parts);
  const workbookRoot = parseXml(parts.get(workbookPart));
  const workbookRels = readRels(parts, relsPathForPart(workbookPart));
  let sharedPath = 'xl/sharedStrings.xml';
  let stylesPath = 'xl/styles.xml';
  for (const rel of workbookRels.values()) {
    if (rel.Type === REL_TYPES.sharedStrings) sharedPath = joinPartPath(workbookPart, rel.Target || sharedPath);
    if (rel.Type === REL_TYPES.styles) stylesPath = joinPartPath(workbookPart, rel.Target || stylesPath);
  }
  const sharedStrings = parseSharedStrings(parts, sharedPath);
  const events = [];
  let seq = 1;
  const ts = options.ts || '1980-01-01T00:00:00Z';
  const source = options.source || 'workbook.xlsx';
  function emit(op, obj = {}) { events.push({ seq: seq++, ts, source, op, ...obj }); }

  emit('schema.declare', { schema: 'xlsx-jsonl-bridge-js', version: '2.0-js', mode: 'semantic', note: 'Canonical semantic extraction. Whole-workbook package mode is removed; values/styles/formulas remain editable semantic events.' });
  const wbAttrs = attrsWithoutNs(workbookRoot);
  const wbpr = firstChild(workbookRoot, 'workbookPr');
  if (wbpr) wbAttrs.workbookPr = attrsWithoutNs(wbpr);
  emit('workbook.init', { workbook_part: workbookPart, attrs: wbAttrs });

  const definedNames = firstChild(workbookRoot, 'definedNames');
  if (definedNames) for (const dn of children(definedNames, 'definedName')) emit('defined_name.set', { attrs: attrsWithoutNs(dn), text: textOf(dn) });

  for (const st of parseStyles(parts, stylesPath)) emit(st.op, Object.fromEntries(Object.entries(st).filter(([k]) => k !== 'op')));

  const sheetsEl = firstChild(workbookRoot, 'sheets');
  const sheetEls = children(sheetsEl, 'sheet');
  sheetEls.forEach((sheetEl, sheetIndex) => {
    const sheetId = `s${sheetIndex + 1}`;
    const name = attr(sheetEl, 'name') || `Sheet${sheetIndex + 1}`;
    const rid = attr(sheetEl, 'id');
    const rel = rid ? workbookRels.get(rid) : null;
    const sheetPart = rel ? joinPartPath(workbookPart, rel.Target || '') : `xl/worksheets/sheet${sheetIndex + 1}.xml`;
    const wantedSheet = options.sheet || options.sheetName || options.sheet_id;
    if (wantedSheet && ![name, sheetId, attr(sheetEl, 'sheetId')].includes(String(wantedSheet))) return;
    if (!parts.has(sheetPart)) return;
    const root = parseXml(parts.get(sheetPart));
    const sheetRels = readRels(parts, relsPathForPart(sheetPart));
    emit('sheet.upsert', { sheet: sheetId, name, order: sheetIndex + 1, state: attr(sheetEl, 'state'), sheetId: attr(sheetEl, 'sheetId'), source_part: sheetPart });

    const pane = firstChild(firstChild(firstChild(root, 'sheetViews'), 'sheetView'), 'pane');
    if (pane && ['frozen', 'frozenSplit'].includes(attr(pane, 'state'))) emit('pane.freeze', { sheet: sheetId, attrs: attrsWithoutNs(pane) });
    const sfp = firstChild(root, 'sheetFormatPr');
    if (sfp) emit('sheet_format.set', { sheet: sheetId, attrs: attrsWithoutNs(sfp) });
    const cols = firstChild(root, 'cols');
    if (cols) for (const col of children(cols, 'col')) {
      const attrs = attrsWithoutNs(col);
      const min = Number(attrs.min || 1); const max = Number(attrs.max || min);
      delete attrs.min; delete attrs.max;
      if (attrs.style != null) attrs.style = `xf_${attrs.style}`;
      emit('column.set', { sheet: sheetId, from_col: indexToCol(min), to_col: indexToCol(max), attrs });
    }
    const sd = firstChild(root, 'sheetData');
    if (sd) for (const rowEl of children(sd, 'row')) {
      const rowNo = Number(attr(rowEl, 'r') || 0);
      if (!rowNo) continue;
      const rowAttrs = attrsWithoutNs(rowEl);
      delete rowAttrs.r;
      if (rowAttrs.s != null) rowAttrs.style = `xf_${rowAttrs.s}`;
      if (Object.keys(rowAttrs).length) emit('row.set', { sheet: sheetId, row: rowNo, attrs: rowAttrs });
      for (const c of children(rowEl, 'c')) {
        const ref = attr(c, 'r');
        if (!ref) continue;
        const styleAttr = attr(c, 's');
        const fNode = firstChild(c, 'f');
        const valueInfo = parseCellValue(c, sharedStrings);
        const event = { sheet: sheetId, cell: ref };
        if (styleAttr != null) event.style = `xf_${styleAttr}`;
        if (fNode) {
          event.formula = textOf(fNode);
          event.formula_attrs = attrsWithoutNs(fNode);
          if (valueInfo.value !== null) event.cached_value = valueInfo.value;
          if (valueInfo.cell_type) event.cached_type = valueInfo.cell_type;
        } else {
          event.value = valueInfo.value;
          if (valueInfo.cell_type) event.cell_type = valueInfo.cell_type;
        }
        emit('cell.set', event);
      }
    }
    const af = firstChild(root, 'autoFilter');
    if (af && attr(af, 'ref')) emit('auto_filter.set', { sheet: sheetId, ref: attr(af, 'ref'), attrs: attrsWithoutNs(af) });
    const mergeCells = firstChild(root, 'mergeCells');
    if (mergeCells) for (const mc of children(mergeCells, 'mergeCell')) if (attr(mc, 'ref')) emit('range.merge', { sheet: sheetId, range: normalizeRange(attr(mc, 'ref')) });
    for (const cf of children(root, 'conditionalFormatting')) emit('conditional_format.raw', { sheet: sheetId, sqref: attr(cf, 'sqref'), raw_xml: serializeXml(cf) });
    const dvs = firstChild(root, 'dataValidations');
    if (dvs) for (const dv of children(dvs, 'dataValidation')) {
      const rule = attrsWithoutNs(dv);
      const sqref = rule.sqref;
      delete rule.sqref;
      const f1 = firstChild(dv, 'formula1');
      const f2 = firstChild(dv, 'formula2');
      if (f1) rule.formula1 = textOf(f1);
      if (f2) rule.formula2 = textOf(f2);
      emit('data_validation.add', { sheet: sheetId, sqref, rule });
    }
    const hls = firstChild(root, 'hyperlinks');
    if (hls) for (const hl of children(hls, 'hyperlink')) {
      const attrs = attrsWithoutNs(hl);
      const rid2 = attr(hl, 'id');
      const rel2 = rid2 ? sheetRels.get(rid2) : null;
      const out = { sheet: sheetId, ref: attrs.ref, attrs };
      if (rel2) { out.target = rel2.Target; out.targetMode = rel2.TargetMode; out.relType = rel2.Type; }
      emit('hyperlink.set', out);
    }
    const tps = firstChild(root, 'tableParts');
    if (tps) for (const tp of children(tps, 'tablePart')) {
      const trid = attr(tp, 'id');
      const tr = trid ? sheetRels.get(trid) : null;
      if (!tr) continue;
      const tablePart = joinPartPath(sheetPart, tr.Target || '');
      if (!parts.has(tablePart)) continue;
      try {
        const tableRoot = parseXml(parts.get(tablePart));
        const tsi = firstChild(tableRoot, 'tableStyleInfo');
        emit('table.add', { sheet: sheetId, name: attr(tableRoot, 'displayName') || attr(tableRoot, 'name'), range: attr(tableRoot, 'ref'), style: tsi ? attr(tsi, 'name') : undefined, source_part: tablePart });
      } catch (_) { /* ignore unparsable table */ }
    }
    const sp = firstChild(root, 'sheetProtection');
    if (sp) emit('sheet_protection.set', { sheet: sheetId, attrs: attrsWithoutNs(sp) });
    const pm = firstChild(root, 'pageMargins');
    const ps = firstChild(root, 'pageSetup');
    if (pm || ps) emit('sheet.page', { sheet: sheetId, margins: pm ? attrsWithoutNs(pm) : undefined, setup: ps ? attrsWithoutNs(ps) : undefined });
    const drawing = firstChild(root, 'drawing');
    if (drawing) {
      const drid = attr(drawing, 'id');
      const drel = drid ? sheetRels.get(drid) : null;
      if (drel) {
        const drawingPart = joinPartPath(sheetPart, drel.Target || '');
        if (parts.has(drawingPart)) {
          const drawingRelsPath = relsPathForPart(drawingPart);
          if (parts.has(drawingRelsPath)) {
            emit('asset.drawing.rels', { sheet: sheetId, part: drawingPart, rels_part: drawingRelsPath, rels_b64: base64Encode(parts.get(drawingRelsPath)) });
            for (const rel of readRels(parts, drawingRelsPath).values()) {
              const targetPart = joinPartPath(drawingPart, rel.Target || '');
              if (parts.has(targetPart) && targetPart.startsWith('xl/media/')) emit('asset.media.part', { path: targetPart, data_b64: base64Encode(parts.get(targetPart)), relType: rel.Type });
            }
          }
          try {
            const drawingRoot = parseXml(parts.get(drawingPart));
            const anchors = children(drawingRoot).filter(n => n.name !== '#text');
            anchors.forEach((anchor, anchorIndex) => emit('asset.drawing.element', {
              sheet: sheetId,
              asset_id: `${sheetId}_drawing_${anchorIndex + 1}`,
              drawing_part: drawingPart,
              anchor_index: anchorIndex,
              anchor_kind: stripPrefix(anchor.name),
              raw_xml_b64: base64Encode(serializeXml(anchor))
            }));
          } catch (err) {
            throw new Error(`cannot extract drawing as semantic asset elements from ${drawingPart}: ${err.message || err}`);
          }
        }
      }
    }
  });
  return events;
}

export { extractSemanticEvents, parseStyles, parseSharedStrings, spreadsheetStringText, spreadsheetTextDecode, findWorkbookPart, readRels, joinPartPath, relsPathForPart };
