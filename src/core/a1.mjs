import { assert } from './errors.mjs';
import { EXCEL_MAX_COL, EXCEL_MAX_ROW } from './constants.mjs';

function colToIndex(col) {
  if (Number.isInteger(col)) {
    assert(col >= 1 && col <= EXCEL_MAX_COL, `column out of Excel bounds: ${col}`);
    return col;
  }
  const m = /^\$?([A-Za-z]{1,3})\$?$/.exec(String(col || '').trim());
  assert(m, `invalid column: ${JSON.stringify(col)}`);
  let n = 0;
  for (const ch of m[1].toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  assert(n >= 1 && n <= EXCEL_MAX_COL, `column out of Excel bounds: ${JSON.stringify(col)}`);
  return n;
}

function indexToCol(n) {
  assert(Number.isInteger(n) && n >= 1 && n <= EXCEL_MAX_COL, `column out of Excel bounds: ${n}`);
  let s = '';
  while (n > 0) {
    n -= 1;
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26);
  }
  return s;
}

function splitCellRef(ref) {
  const m = /^\$?([A-Za-z]{1,3})\$?([1-9][0-9]*)$/.exec(String(ref || '').trim());
  assert(m, `invalid A1 cell reference: ${JSON.stringify(ref)}`);
  const row = Number(m[2]);
  assert(row >= 1 && row <= EXCEL_MAX_ROW, `row out of Excel bounds in ref: ${JSON.stringify(ref)}`);
  return { row, col: colToIndex(m[1]) };
}

function cellRef(row, col) {
  assert(Number.isInteger(row) && row >= 1 && row <= EXCEL_MAX_ROW, `row out of Excel bounds: ${row}`);
  return `${indexToCol(col)}${row}`;
}

function parseRange(ref) {
  const s = String(ref || '').replace(/\$/g, '').trim();
  assert(s.length > 0, 'range is required');
  const parts = s.split(':');
  assert(parts.length === 1 || parts.length === 2, `invalid range: ${ref}`);
  const a = splitCellRef(parts[0]);
  const b = parts.length === 2 ? splitCellRef(parts[1]) : a;
  return {
    r1: Math.min(a.row, b.row),
    c1: Math.min(a.col, b.col),
    r2: Math.max(a.row, b.row),
    c2: Math.max(a.col, b.col)
  };
}

function normalizeRange(ref) {
  const r = parseRange(ref);
  const a = cellRef(r.r1, r.c1);
  const b = cellRef(r.r2, r.c2);
  return a === b ? a : `${a}:${b}`;
}

function parseSqref(ref) {
  const refs = String(ref || '').replace(/\$/g, '').trim().split(/\s+/).filter(Boolean);
  assert(refs.length > 0, 'sqref is required');
  return refs.map(parseRange);
}

function normalizeSqref(ref) {
  return String(ref || '').replace(/\$/g, '').trim().split(/\s+/).filter(Boolean).map(normalizeRange).join(' ');
}

function rangeSize(rect) {
  return (rect.r2 - rect.r1 + 1) * (rect.c2 - rect.c1 + 1);
}

function rangesOverlap(a, b) {
  return !(a.r2 < b.r1 || b.r2 < a.r1 || a.c2 < b.c1 || b.c2 < a.c1);
}

function sheetNameIsValid(name) {
  return typeof name === 'string' && name.length > 0 && name.length <= 31 && !/[\\/?*\[\]:]/.test(name);
}

function makeSafeSheetName(name, used) {
  let base = String(name || 'Sheet').replace(/[\\/?*\[\]:]/g, '_').replace(/^'+|'+$/g, '').slice(0, 31) || 'Sheet';
  let candidate = base;
  let n = 1;
  while (used && used.has(candidate)) {
    const suffix = `_${n++}`;
    candidate = (base.slice(0, 31 - suffix.length) + suffix).slice(0, 31);
  }
  return candidate;
}

function tableDisplayName(name) {
  let s = String(name || '').replace(/[^A-Za-z0-9_]/g, '_');
  if (!s || !/^[A-Za-z_]/.test(s)) s = `Table_${s}`;
  return s.slice(0, 255);
}

export { colToIndex, indexToCol, splitCellRef, cellRef, parseRange, normalizeRange, parseSqref, normalizeSqref, rangeSize, rangesOverlap, sheetNameIsValid, makeSafeSheetName, tableDisplayName };
