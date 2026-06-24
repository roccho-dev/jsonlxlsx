#!/usr/bin/env node

/**
 * Generate example XLSX from examples/minimal/
 * Outputs to examples/output.xlsx and verifies content.
 */

import { engineFromDir } from '../src/engine.js';
import ExcelJS from 'exceljs';
import { readFileSync } from 'fs';

const outputPath = 'examples/output.xlsx';

try {
  // Generate XLSX from example data
  const { state, workbook } = await engineFromDir({
    inputDir: 'examples/minimal',
    outputPath,
  });

  console.log(`✓ Generated: ${outputPath}`);
  console.log(`  Masters: ${state.masters.length} records`);
  console.log(`  Edges: ${state.edges.length} records`);

  // Verify generated content
  const verify = new ExcelJS.Workbook();
  await verify.xlsx.readFile(outputPath);

  const sheets = verify.worksheets.map((ws) => ws.name);
  console.log(`  Sheets: ${sheets.join(', ')}`);

  // Check required sheets and values
  const releaseSheet = verify.getWorksheet('releases');
  const stepsSheet = verify.getWorksheet('steps');

  if (!releaseSheet) {
    throw new Error('Missing "releases" sheet');
  }
  if (!stepsSheet) {
    throw new Error('Missing "steps" sheet');
  }

  // Verify sample values exist in sheets
  let foundRelease = false;
  let foundStep = false;
  let foundValidation = false;

  releaseSheet.eachRow((row) => {
    const vals = row.values.join('|');
    if (vals.includes('release-alpha')) foundRelease = true;
    if (vals.includes('Alpha Release')) {
      console.log(`  ✓ Found "Alpha Release" in releases sheet`);
    }
  });

  stepsSheet.eachRow((row) => {
    const vals = row.values.join('|');
    if (vals.includes('check-001')) foundStep = true;
    if (vals.includes('Validation')) {
      foundValidation = true;
      console.log(`  ✓ Found "Validation" in steps sheet`);
    }
  });

  if (!foundRelease) console.warn('  ⚠ Did not find "release-alpha" in releases sheet');
  if (!foundStep) console.warn('  ⚠ Did not find "check-001" in steps sheet');

  console.log(`✓ Example verification complete`);
} catch (err) {
  console.error(`✗ Error: ${err.message}`);
  process.exit(1);
}
