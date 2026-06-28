export const NS = Object.freeze({
  MAIN: 'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
  REL_DOC: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  REL_PKG: 'http://schemas.openxmlformats.org/package/2006/relationships',
  CONTENT_TYPES: 'http://schemas.openxmlformats.org/package/2006/content-types',
  CORE: 'http://schemas.openxmlformats.org/package/2006/metadata/core-properties',
  DC: 'http://purl.org/dc/elements/1.1/',
  DCTERMS: 'http://purl.org/dc/terms/',
  DCMITYPE: 'http://purl.org/dc/dcmitype/',
  XSI: 'http://www.w3.org/2001/XMLSchema-instance',
  EXT_PROPS: 'http://schemas.openxmlformats.org/officeDocument/2006/extended-properties',
  VT: 'http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes'
});

export const REL_TYPES = Object.freeze({
  officeDocument: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument',
  coreProps: 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties',
  extendedProps: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties',
  worksheet: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet',
  styles: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles',
  sharedStrings: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings',
  table: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/table',
  hyperlink: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink',
  theme: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme'
});

export const CONTENT_TYPES = Object.freeze({
  workbook: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml',
  worksheet: 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml',
  styles: 'application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml',
  sharedStrings: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml',
  table: 'application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml',
  core: 'application/vnd.openxmlformats-package.core-properties+xml',
  app: 'application/vnd.openxmlformats-officedocument.extended-properties+xml',
  drawing: 'application/vnd.openxmlformats-officedocument.drawing+xml',
  theme: 'application/vnd.openxmlformats-officedocument.theme+xml'
});

export const EXCEL_MAX_ROW = 1048576;
export const EXCEL_MAX_COL = 16384;

export const BUILTIN_NUMFMTS = Object.freeze({
  'General': 0,
  '0': 1,
  '0.00': 2,
  '#,##0': 3,
  '#,##0.00': 4,
  '0%': 9,
  '0.00%': 10,
  '0.00E+00': 11,
  '# ?/?': 12,
  '# ??/??': 13,
  'm/d/yy': 14,
  'mm-dd-yy': 14,
  'd-mmm-yy': 15,
  'd-mmm': 16,
  'mmm-yy': 17,
  'h:mm AM/PM': 18,
  'h:mm:ss AM/PM': 19,
  'h:mm': 20,
  'h:mm:ss': 21,
  'm/d/yy h:mm': 22,
  '#,##0 ;(#,##0)': 37,
  '#,##0 ;[Red](#,##0)': 38,
  '#,##0.00;(#,##0.00)': 39,
  '#,##0.00;[Red](#,##0.00)': 40,
  'mm:ss': 45,
  '[h]:mm:ss': 46,
  'mmss.0': 47,
  '##0.0E+0': 48,
  '@': 49
});

export const BUILTIN_NUMFMTS_BY_ID = Object.freeze(Object.fromEntries(Object.entries(BUILTIN_NUMFMTS).map(([k, v]) => [String(v), k])));
