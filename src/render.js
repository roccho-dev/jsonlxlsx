/**
 * Template-based XLSX rendering: load template, copy styles, inject data.
 * Supports data_replace (clear + inject) and preserve (keep template as-is) strategies.
 * Supports edge lookups (FK-like joins) and bumon matrix (N×M assignment grids).
 */

import ExcelJS from 'exceljs';

/**
 * Render preserve strategy: keep template as-is, optionally apply cell overrides.
 * @param {Object} config - Sheet config {sheet, cell_overrides}
 * @param {Object} state - {masters, edges}
 * @param {ExcelJS.Workbook} workbook - Loaded template workbook
 */
export async function renderPreserve(config, state, workbook) {
  const ws = workbook.getWorksheet(config.sheet);
  if (!ws) return;

  if (config.cell_overrides) {
    for (const override of config.cell_overrides) {
      const cell = ws.getCell(override.cell);
      cell.value = override.value;
    }
  }
}

/**
 * Render data_replace strategy: clear data rows, inject from masters, copy styles.
 * @param {Object} config - Sheet config {sheet, source, data_start_row, style_template_row, columns, edge_lookup, bumon_matrix}
 * @param {Object} state - {masters, edges}
 * @param {ExcelJS.Workbook} workbook - Loaded template workbook
 */
export async function renderSheetDataReplace(config, state, workbook) {
  const ws = workbook.getWorksheet(config.sheet);
  if (!ws) return;

  // Find source masters by type (if schema-driven)
  const sources = state.masters.filter((m) => {
    if (!config.source) return true;
    return m.type === config.source || m._type === config.source;
  });

  const startRow = config.data_start_row || 2;
  const styleRow = config.style_template_row || 2;
  const styleRowObj = ws.getRow(styleRow);

  // Clear existing data rows (preserve header)
  const maxRow = ws.rowCount || 1000;
  for (let r = startRow; r <= maxRow; r++) {
    ws.getRow(r).values = [];
  }

  // Inject masters
  let dataRow = startRow;
  for (const master of sources) {
    const rowObj = ws.getRow(dataRow);

    // Copy style from template row
    if (styleRowObj) {
      for (let col = 1; col <= (config.columns?.length || 50); col++) {
        const styleCell = styleRowObj.getCell(col);
        const targetCell = rowObj.getCell(col);
        if (styleCell.fill) targetCell.fill = { ...styleCell.fill };
        if (styleCell.font) targetCell.font = { ...styleCell.font };
        if (styleCell.border) targetCell.border = { ...styleCell.border };
        if (styleCell.alignment) targetCell.alignment = { ...styleCell.alignment };
      }
    }

    // Populate columns
    if (config.columns) {
      for (const col of config.columns) {
        const cell = rowObj.getCell(col.col);
        if (col.src) {
          cell.value = master[col.src] ?? '';
        } else if ('literal' in col) {
          cell.value = col.literal;
        }
      }
    }

    // Apply edge lookups (FK joins)
    if (config.columns) {
      for (const col of config.columns) {
        if (col.edge_lookup) {
          const lookup = col.edge_lookup;
          const edgeMatches = state.edges.filter((e) => {
            if (lookup.source && e._type !== lookup.source && e.type !== lookup.source) {
              return false;
            }
            if (lookup.match) {
              const hasMatch = Object.entries(lookup.match).every(
                ([edgeField, masterField]) =>
                  e[edgeField] === master[masterField]
              );
              if (!hasMatch) return false;
            }
            if (lookup.where) {
              const whereOk = Object.entries(lookup.where).every(
                ([field, val]) => e[field] === val
              );
              if (!whereOk) return false;
            }
            return true;
          });

          if (edgeMatches.length > 0) {
            const match = edgeMatches[0];
            const cell = rowObj.getCell(col.col);
            cell.value = match[lookup.select] ?? '';
          }
        }
      }
    }

    // Bumon matrix: N×M assignment grid
    if (config.bumon_matrix && state.edges) {
      const matrix = config.bumon_matrix;
      const idVal = master[matrix.id_field];
      const edgeMatches = state.edges.filter(
        (e) =>
          e[matrix.edge_id_field] === idVal &&
          (!matrix.source || e.type === matrix.source || e._type === matrix.source)
      );

      for (let colIdx = 0; colIdx < matrix.column_count; colIdx++) {
        const bumonId = matrix.bumon_ids[colIdx];
        const mark = edgeMatches
          .filter((e) => e[matrix.bumon_id_field] === bumonId)
          .map((e) => e[matrix.mark_field])
          .join('');
        const cell = rowObj.getCell(matrix.column_start + colIdx);
        cell.value = mark || '';
      }
    }

    dataRow++;
  }
}

/**
 * Load JSONL sheet configs and render each.
 * @param {string} configContent - JSONL content with sheet directives
 * @param {Object} state - {schema, masters, edges}
 * @param {ExcelJS.Workbook} workbook - Loaded template workbook
 */
export async function renderFromConfig(configContent, state, workbook) {
  const lines = configContent
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l);

  for (const line of lines) {
    const config = JSON.parse(line);
    if (!config.sheet) continue;

    const strategy = config.strategy || 'preserve';
    if (strategy === 'preserve') {
      await renderPreserve(config, state, workbook);
    } else if (strategy === 'data_replace') {
      await renderSheetDataReplace(config, state, workbook);
    }
  }
}

/**
 * Main render: load template XLSX, apply sheet configs, write output.
 * @param {Object} options - {templatePath, configContent, state, outputPath}
 */
export async function render(options) {
  const workbook = new ExcelJS.Workbook();

  // Load or create template
  if (options.templatePath) {
    await workbook.xlsx.readFile(options.templatePath);
  } else {
    // Create minimal template if none provided
    workbook.addWorksheet('Sheet1');
  }

  // If no template but we have config, create sheets from config
  if (!options.templatePath && options.configContent) {
    const lines = options.configContent
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l);
    const sheetNames = new Set();
    for (const line of lines) {
      const config = JSON.parse(line);
      if (config.sheet && !sheetNames.has(config.sheet)) {
        sheetNames.add(config.sheet);
        if (workbook.getWorksheet(config.sheet)) continue;
        const ws = workbook.addWorksheet(config.sheet);
        // Add header row with column placeholders
        if (config.columns) {
          for (const col of config.columns) {
            const cell = ws.getCell(1, col.col);
            cell.value = col.src || `Column ${col.col}`;
          }
        }
      }
    }
    // Remove default Sheet1 if we added other sheets
    if (sheetNames.size > 0) {
      const sheet1 = workbook.getWorksheet('Sheet1');
      if (sheet1) workbook.removeWorksheet(sheet1.id);
    }
  }

  // Apply sheet configs
  if (options.configContent && options.state) {
    await renderFromConfig(options.configContent, options.state, workbook);
  }

  // Write output
  if (options.outputPath) {
    await workbook.xlsx.writeFile(options.outputPath);
  }

  return workbook;
}
