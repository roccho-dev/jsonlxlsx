#!/usr/bin/env node

/**
 * Thin CLI adapter for engine.
 * Usage: node src/cli.js --input-dir ./data --template template.xlsx --output output.xlsx
 *     or: node src/cli.js --schema s.jsonl --masters m.jsonl --edges e.jsonl --config c.jsonl --template t.xlsx --output o.xlsx
 */

import { engine, engineFromDir } from './engine.js';

const args = process.argv.slice(2);
const options = {};

for (let i = 0; i < args.length; i++) {
  const key = args[i];
  if (key === '--input-dir') options.inputDir = args[++i];
  else if (key === '--schema') options.schemaPath = args[++i];
  else if (key === '--masters') options.mastersPath = args[++i];
  else if (key === '--edges') options.edgesPath = args[++i];
  else if (key === '--config') options.configPath = args[++i];
  else if (key === '--template') options.templatePath = args[++i];
  else if (key === '--output') options.outputPath = args[++i];
}

if (!options.outputPath) {
  console.error('Usage: cli --input-dir ./data --template t.xlsx --output o.xlsx');
  console.error('    or: cli --schema s.jsonl --masters m.jsonl --edges e.jsonl --config c.jsonl --template t.xlsx --output o.xlsx');
  process.exit(1);
}

try {
  const result = options.inputDir
    ? await engineFromDir(options)
    : await engine(options);
  const state = result.state;
  console.log(`✓ Rendered: ${options.outputPath}`);
  console.log(`  Masters: ${state.masters.length} records`);
  console.log(`  Edges: ${state.edges.length} records`);
} catch (err) {
  console.error(`✗ Error: ${err.message}`);
  process.exit(1);
}
