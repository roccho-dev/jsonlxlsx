import { parseJsonlText, stringifyJsonl } from './jsonl.mjs';
import { assertValidEventShapes } from './schema.mjs';
import { compileJsonlTextToBytes } from './compiler.mjs';
import { extractSemanticEvents } from './semantic-extract.mjs';
import { composeSeparatedEvents, splitEventsByLayer, stringifyLayeredJsonl, splitJsonlToLayeredJsonl } from './layers.mjs';

const REMOVED_PACKAGE_MODES = new Set(['package', 'hybrid']);

function normalizeCompileMode(mode) {
  const selected = mode || 'semantic';
  if (REMOVED_PACKAGE_MODES.has(selected)) throw new Error('package mode has been removed; compile semantic JSONL or separated design/values/assets layers instead');
  if (selected === 'semantic' || selected === 'auto') return 'semantic';
  throw new Error(`unknown compile mode: ${selected}`);
}

function normalizeExtractMode(mode) {
  const selected = mode || 'semantic';
  if (REMOVED_PACKAGE_MODES.has(selected)) throw new Error('package mode has been removed; extract semantic JSONL or separated design/values/assets layers instead');
  if (selected === 'semantic' || selected === 'separated') return selected;
  throw new Error(`unknown extract mode: ${selected}`);
}

async function compileJsonlToBytes(jsonl, options = {}, port = {}) {
  const events = Array.isArray(jsonl) ? jsonl : parseJsonlText(jsonl, options.jsonl || {});
  assertValidEventShapes(events);
  const mode = normalizeCompileMode(options.mode);
  return compileJsonlTextToBytes(Array.isArray(jsonl) ? stringifyJsonl(events) : jsonl, { ...options, mode }, port);
}

async function compileSeparatedJsonlToBytes(layers = {}, options = {}, port = {}) {
  const events = composeSeparatedEvents(layers, options.layers || {});
  return compileJsonlTextToBytes(stringifyJsonl(events), { ...options, mode: 'semantic' }, port);
}

async function compileLayeredJsonlToBytes(layers = {}, options = {}, port = {}) {
  return compileSeparatedJsonlToBytes(layers, options, port);
}

async function extractXlsxToLayeredEvents(xlsxBytes, options = {}, port = {}) {
  const events = await extractSemanticEvents(xlsxBytes, options, port);
  return splitEventsByLayer(events, options.layers || options || {});
}

async function extractXlsxToLayeredJsonl(xlsxBytes, options = {}, port = {}) {
  return stringifyLayeredJsonl(await extractXlsxToLayeredEvents(xlsxBytes, options, port));
}

function splitSemanticJsonlToLayeredJsonl(jsonlText, options = {}) {
  return splitJsonlToLayeredJsonl(jsonlText, options.layers || options || {});
}

async function extractXlsxToEvents(xlsxBytes, options = {}, port = {}) {
  const mode = normalizeExtractMode(options.mode);
  if (mode === 'semantic') return extractSemanticEvents(xlsxBytes, options, port);
  if (mode === 'separated') return extractXlsxToLayeredEvents(xlsxBytes, options, port);
  throw new Error(`unknown extract mode: ${mode}`);
}

async function extractXlsxToJsonl(xlsxBytes, options = {}, port = {}) {
  const mode = normalizeExtractMode(options.mode);
  if (mode === 'separated') return extractXlsxToLayeredJsonl(xlsxBytes, { ...options, mode }, port);
  return stringifyJsonl(await extractXlsxToEvents(xlsxBytes, { ...options, mode }, port));
}

export {
  compileJsonlToBytes,
  compileSeparatedJsonlToBytes,
  compileLayeredJsonlToBytes,
  extractXlsxToEvents,
  extractXlsxToJsonl,
  extractXlsxToLayeredEvents,
  extractXlsxToLayeredJsonl,
  splitSemanticJsonlToLayeredJsonl
};
