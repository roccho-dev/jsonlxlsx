/**
 * Engine orchestration: load → reduce → render → write.
 * Combines reduce + render into a single pipeline.
 */

import { readFileSync } from 'fs';
import { materialize } from './reduce.js';
import { render } from './render.js';

/**
 * Load JSONL file content, return as string.
 * @param {string} path - File path
 * @returns {string} File content
 */
function loadFile(path) {
  try {
    return readFileSync(path, 'utf-8');
  } catch {
    return '';
  }
}

/**
 * Main engine: masters + edges + config → XLSX.
 * Steps:
 * 1. Load schema, masters, edges
 * 2. Reduce (partition by natural key, keep latest by _ts)
 * 3. Load sheet config
 * 4. Render (template + style copy + data injection)
 * 5. Write output
 * @param {Object} options - {schemaPath, mastersPath, edgesPath, configPath, templatePath, outputPath}
 */
export async function engine(options) {
  const inputs = {
    schema: loadFile(options.schemaPath),
    masters: loadFile(options.mastersPath),
    edges: loadFile(options.edgesPath),
  };

  // Reduce
  const state = materialize(inputs);

  // Render
  const configContent = loadFile(options.configPath);
  const workbook = await render({
    templatePath: options.templatePath,
    configContent,
    state,
    outputPath: options.outputPath,
  });

  return { state, workbook };
}

/**
 * Engine with directory-based input (convention over config).
 * @param {Object} options - {inputDir, templatePath, outputPath}
 *   Looks for:
 *   - inputDir/config/schema.jsonl
 *   - inputDir/masters.jsonl or masters/*.jsonl (merged)
 *   - inputDir/edges.jsonl or edges/*.jsonl (merged)
 *   - inputDir/config/sheets.jsonl
 */
export async function engineFromDir(options) {
  const base = options.inputDir || '.';

  // Collect masters from masters/ dir or single file
  let mastersContent = '';
  try {
    const fs = await import('fs');
    mastersContent = fs.readFileSync(`${base}/masters.jsonl`, 'utf-8');
  } catch {
    try {
      const fs = await import('fs');
      const files = fs.readdirSync(`${base}/masters`);
      const contents = files
        .filter((f) => f.endsWith('.jsonl'))
        .map((f) => fs.readFileSync(`${base}/masters/${f}`, 'utf-8'));
      mastersContent = contents.join('\n');
    } catch {
      mastersContent = '';
    }
  }

  // Same for edges
  let edgesContent = '';
  try {
    const fs = await import('fs');
    edgesContent = fs.readFileSync(`${base}/edges.jsonl`, 'utf-8');
  } catch {
    try {
      const fs = await import('fs');
      const files = fs.readdirSync(`${base}/edges`);
      const contents = files
        .filter((f) => f.endsWith('.jsonl'))
        .map((f) => fs.readFileSync(`${base}/edges/${f}`, 'utf-8'));
      edgesContent = contents.join('\n');
    } catch {
      edgesContent = '';
    }
  }

  return engine({
    schemaPath: `${base}/config/schema.jsonl`,
    mastersPath: mastersContent,
    edgesPath: edgesContent,
    configPath: `${base}/config/sheets.jsonl`,
    templatePath: options.templatePath,
    outputPath: options.outputPath,
  });
}

export default engine;
