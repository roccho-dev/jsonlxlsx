#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { compileJsonl, compileJsonlLayers, extractXlsx, extractSemanticLayers, splitJsonlLayers, validateJsonlLayers, validateXlsx, compareXlsxParts } from '../node/index.mjs';

function parseArgs(argv) {
  const args = [...argv];
  const command = args.shift();
  const opts = {};
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--mode') opts.mode = args[++i];
    else if (a === '--history-sheet') opts.historySheet = args[++i];
    else if (a === '--zip-method') opts.zipMethod = Number(args[++i]);
    else if (a === '--now') opts.now = args[++i];
    else if (a === '--assets') opts.assets = args[++i];
    else if (a === '--sheet') opts.sheet = args[++i];
    else if (a === '--design') opts.design = args[++i];
    else if (a === '--values') opts.values = args[++i];
    else positional.push(a);
  }
  return { command, positional, opts };
}

function usage() {
  return [
    'Usage:',
    '  jsonl-xlsx-js compile input.jsonl output.xlsx [--mode semantic] [--history-sheet NAME]',
    '  jsonl-xlsx-js extract input.xlsx output.jsonl [--mode semantic]',
    '  jsonl-xlsx-js split-layers input.semantic.jsonl output_dir',
    '  jsonl-xlsx-js extract-layers input.xlsx output_dir [--sheet NAME]',
    '  jsonl-xlsx-js compile-layers design.jsonl values.jsonl output.xlsx [--assets assets.jsonl]',
    '  jsonl-xlsx-js compile-separated output.xlsx --design design.jsonl --values values.jsonl [--assets assets.jsonl]',
    '  jsonl-xlsx-js extract-separated input.xlsx output_dir [--sheet NAME]',
    '  jsonl-xlsx-js validate-layers design.jsonl values.jsonl [--assets assets.jsonl]',
    '  jsonl-xlsx-js validate input.xlsx',
    '  jsonl-xlsx-js compare-parts left.xlsx right.xlsx'
  ].join('\n');
}

async function runNodeCli(argv, io = {}) {
  const out = io.out || (text => console.log(text));
  const err = io.err || (text => console.error(text));
  const exit = io.exit || (code => { process.exitCode = code; });
  const { command, positional, opts } = parseArgs(argv);
  if (!command || command === '-h' || command === '--help') {
    out(usage());
    return 0;
  }
  if (command === 'compile') {
    if (positional.length < 2) throw new Error(usage());
    out(JSON.stringify(await compileJsonl(positional[0], positional[1], opts)));
    return 0;
  }
  if (command === 'compile-layers') {
    if (positional.length < 3) throw new Error(usage());
    out(JSON.stringify(await compileJsonlLayers(positional[0], positional[1], positional[2], opts)));
    return 0;
  }
  if (command === 'compile-separated') {
    const output = positional[0];
    if (!output || !opts.design || !opts.values) throw new Error(usage());
    out(JSON.stringify(await compileJsonlLayers(opts.design, opts.values, output, opts)));
    return 0;
  }
  if (command === 'extract') {
    if (positional.length < 2) throw new Error(usage());
    out(JSON.stringify(await extractXlsx(positional[0], positional[1], opts)));
    return 0;
  }
  if (command === 'extract-layers') {
    if (positional.length < 2) throw new Error(usage());
    out(JSON.stringify(await extractSemanticLayers(positional[0], positional[1], opts)));
    return 0;
  }
  if (command === 'extract-separated') {
    if (positional.length < 2) throw new Error(usage());
    out(JSON.stringify(await extractSemanticLayers(positional[0], positional[1], opts)));
    return 0;
  }
  if (command === 'split-layers') {
    if (positional.length < 2) throw new Error(usage());
    out(JSON.stringify(await splitJsonlLayers(positional[0], positional[1], opts)));
    return 0;
  }
  if (command === 'validate-layers') {
    if (positional.length < 2) throw new Error(usage());
    const errors = await validateJsonlLayers(positional[0], positional[1], opts);
    if (errors.length) {
      err(errors.join('\n'));
      exit(1);
      return 1;
    }
    out('OK');
    return 0;
  }
  if (command === 'validate') {
    if (positional.length < 1) throw new Error(usage());
    const errors = await validateXlsx(positional[0]);
    if (errors.length) {
      err(errors.join('\n'));
      exit(1);
      return 1;
    }
    out('OK');
    return 0;
  }
  if (command === 'compare-parts') {
    if (positional.length < 2) throw new Error(usage());
    const result = await compareXlsxParts(positional[0], positional[1]);
    out(JSON.stringify(result, null, 2));
    if (!result.equal) exit(1);
    return result.equal ? 0 : 1;
  }
  throw new Error(usage());
}

async function main() {
  try {
    await runNodeCli(process.argv.slice(2));
  } catch (caught) {
    console.error(caught && caught.stack ? caught.stack : String(caught));
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

export { parseArgs, usage, runNodeCli };
