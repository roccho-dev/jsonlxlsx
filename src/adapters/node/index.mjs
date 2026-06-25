import * as core from '../../core/index.mjs';
import { nodePort, readBytes, writeBytes, readText, writeText, basename, join } from './port.mjs';

async function compileJsonlFile(inputJsonl, outputXlsx, options = {}) {
  const jsonl = await readText(inputJsonl);
  const bytes = await core.compileJsonlToBytes(jsonl, options, nodePort);
  await writeBytes(outputXlsx, bytes);
  return { mode: options.mode || 'semantic', output: outputXlsx, bytes: bytes.length, events: core.parseJsonlText(jsonl, options.jsonl || {}).length };
}

async function compileJsonl(inputJsonl, outputXlsx, options = {}) {
  return compileJsonlFile(inputJsonl, outputXlsx, options);
}

async function compileLayeredJsonlFiles(designJsonl, valuesJsonl, assetsJsonl, outputXlsx, options = {}) {
  const layers = {
    design: designJsonl ? await readText(designJsonl) : '',
    values: valuesJsonl ? await readText(valuesJsonl) : '',
    assets: assetsJsonl ? await readText(assetsJsonl) : ''
  };
  const bytes = await core.compileLayeredJsonlToBytes(layers, options, nodePort);
  await writeBytes(outputXlsx, bytes);
  return {
    mode: 'layers',
    output: outputXlsx,
    bytes: bytes.length,
    design_events: layers.design ? core.parseJsonlText(layers.design).length : 0,
    value_events: layers.values ? core.parseJsonlText(layers.values).length : 0,
    asset_events: layers.assets ? core.parseJsonlText(layers.assets).length : 0
  };
}

async function compileJsonlLayers(designJsonl, valuesJsonl, outputXlsx, options = {}) {
  return compileLayeredJsonlFiles(designJsonl, valuesJsonl, options.assets || null, outputXlsx, options);
}

async function compileSeparatedFiles(inputs, outputXlsx, options = {}) {
  return compileLayeredJsonlFiles(inputs.design || null, inputs.values || null, inputs.assets || null, outputXlsx, options);
}

async function extractXlsx(inputXlsx, outputJsonl, options = {}) {
  const bytes = await readBytes(inputXlsx);
  const mode = options.mode || 'semantic';
  const events = await core.extractXlsxToEvents(bytes, { ...options, mode, source: options.source || basename(inputXlsx) }, nodePort);
  await writeText(outputJsonl, Array.isArray(events) ? core.stringifyJsonl(events) : JSON.stringify(events));
  return { mode, events: Array.isArray(events) ? events.length : 0, output: outputJsonl };
}

async function extractSemanticLayers(inputXlsx, outputDir, options = {}) {
  const bytes = await readBytes(inputXlsx);
  const layered = await core.extractXlsxToLayeredJsonl(bytes, { ...options, source: options.source || basename(inputXlsx) }, nodePort);
  await writeText(join(outputDir, 'manifest.jsonl'), layered.manifest);
  await writeText(join(outputDir, 'design.jsonl'), layered.design);
  await writeText(join(outputDir, 'values.jsonl'), layered.values);
  await writeText(join(outputDir, 'assets.jsonl'), layered.assets);
  return {
    mode: 'layers',
    output: outputDir,
    manifest: join(outputDir, 'manifest.jsonl'),
    design: join(outputDir, 'design.jsonl'),
    values: join(outputDir, 'values.jsonl'),
    assets: join(outputDir, 'assets.jsonl'),
    design_events: core.parseJsonlText(layered.design).length,
    value_events: core.parseJsonlText(layered.values).length,
    asset_events: core.parseJsonlText(layered.assets).length
  };
}

async function extractXlsxLayers(inputXlsx, outputDir, options = {}) {
  return extractSemanticLayers(inputXlsx, outputDir, options);
}

async function extractSeparated(inputXlsx, outputs, options = {}) {
  const bytes = await readBytes(inputXlsx);
  const split = await core.extractXlsxToEvents(bytes, { ...options, mode: 'separated', source: options.source || basename(inputXlsx) }, nodePort);
  if (outputs.design) await writeText(outputs.design, core.stringifyJsonl(split.design));
  if (outputs.values) await writeText(outputs.values, core.stringifyJsonl(split.values));
  if (outputs.assets) await writeText(outputs.assets, core.stringifyJsonl(split.assets));
  return { mode: 'separated', design_events: split.design.length, values_events: split.values.length, assets_events: split.assets.length, ignored_events: split.ignored.length, outputs };
}

async function splitJsonlLayers(inputJsonl, outputDir, options = {}) {
  const layered = core.splitSemanticJsonlToLayeredJsonl(await readText(inputJsonl), options);
  await writeText(join(outputDir, 'manifest.jsonl'), layered.manifest);
  await writeText(join(outputDir, 'design.jsonl'), layered.design);
  await writeText(join(outputDir, 'values.jsonl'), layered.values);
  await writeText(join(outputDir, 'assets.jsonl'), layered.assets);
  return { mode: 'split', output: outputDir, design_events: core.parseJsonlText(layered.design).length, value_events: core.parseJsonlText(layered.values).length, asset_events: core.parseJsonlText(layered.assets).length };
}

async function validateJsonlLayers(designJsonl, valuesJsonl, options = {}) {
  return core.validateSeparatedLayers({
    design: designJsonl ? await readText(designJsonl) : '',
    values: valuesJsonl ? await readText(valuesJsonl) : '',
    assets: options.assets ? await readText(options.assets) : ''
  }, options.layers || {});
}

async function extractSemantic(inputXlsx, outputJsonl, options = {}) {
  return extractXlsx(inputXlsx, outputJsonl, { ...options, mode: 'semantic' });
}

async function validateXlsx(inputXlsx) {
  return core.validateXlsxBytes(await readBytes(inputXlsx), nodePort);
}

async function compareXlsxParts(a, b) {
  return core.compareXlsxBytes(await readBytes(a), await readBytes(b), nodePort);
}

async function readZip(input) {
  return core.readZip(input, {}, nodePort);
}


export { nodePort, compileJsonlFile, compileJsonl, compileJsonlLayers, compileLayeredJsonlFiles, compileSeparatedFiles, extractXlsx, extractSemantic, extractSemanticLayers, extractXlsxLayers, extractSeparated, splitJsonlLayers, validateJsonlLayers, validateXlsx, compareXlsxParts, readZip };
export * from '../../core/index.mjs';
