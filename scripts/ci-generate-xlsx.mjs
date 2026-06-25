#!/usr/bin/env node

import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import ExcelJS from 'exceljs';
import { engineFromDir } from '../src/engine.js';

const outputPath = process.env.JSONLXLSX_OUTPUT || 'dist/examples/minimal/output.xlsx';
const summaryPath = process.env.JSONLXLSX_SUMMARY || 'dist/examples/minimal/summary.json';

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function worksheetRows(worksheet) {
  const rows = [];
  worksheet.eachRow((row) => {
    rows.push(row.values.slice(1).map((value) => {
      if (value && typeof value === 'object' && 'formula' in value) {
        return value.result ?? value.formula;
      }
      return value;
    }));
  });
  return rows;
}

function findValue(rows, expected) {
  return rows.some((row) => row.some((value) => String(value) === expected));
}

mkdirSync(dirname(outputPath), { recursive: true });
mkdirSync(dirname(summaryPath), { recursive: true });

const { state } = await engineFromDir({
  inputDir: 'examples/minimal',
  outputPath,
});

const generatedSize = statSync(outputPath).size;
assert(generatedSize > 0, `Generated XLSX is empty: ${outputPath}`);

const workbook = new ExcelJS.Workbook();
await workbook.xlsx.readFile(outputPath);

const releases = workbook.getWorksheet('releases');
const steps = workbook.getWorksheet('steps');
assert(releases, 'Missing required sheet: releases');
assert(steps, 'Missing required sheet: steps');

const releaseRows = worksheetRows(releases);
const stepRows = worksheetRows(steps);

assert(findValue(releaseRows, 'release-alpha'), 'Missing release id: release-alpha');
assert(findValue(releaseRows, 'Alpha Release'), 'Missing release name: Alpha Release');
assert(findValue(stepRows, 'check-001'), 'Missing step id: check-001');
assert(findValue(stepRows, 'Validation'), 'Missing step name: Validation');

const summary = {
  success: true,
  outputPath,
  outputBytes: generatedSize,
  sheets: workbook.worksheets.map((sheet) => sheet.name),
  masters: state.masters.length,
  edges: state.edges.length,
  checks: [
    'generated XLSX is non-empty',
    'ExcelJS can reopen generated XLSX',
    'releases sheet exists',
    'steps sheet exists',
    'release-alpha exists',
    'Alpha Release exists',
    'check-001 exists',
    'Validation exists'
  ]
};

writeFileSync(summaryPath, JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 2));
