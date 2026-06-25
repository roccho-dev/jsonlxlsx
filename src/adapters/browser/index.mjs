import * as core from '../../core/index.mjs';
import { browserPort } from './port.mjs';

async function compileJsonlText(jsonl, options = {}) {
  return core.compileJsonlToBytes(jsonl, options, browserPort);
}

async function compileEvents(events, options = {}) {
  return core.compileJsonlToBytes(events, options, browserPort);
}

async function compileLayeredJsonlTexts(texts, options = {}) {
  return core.compileLayeredJsonlToBytes(texts, options, browserPort);
}

async function compileSeparatedJsonl(texts, options = {}) {
  return compileLayeredJsonlTexts(texts, options);
}

async function compileLayeredTexts(texts, options = {}) {
  return compileLayeredJsonlTexts(texts, options);
}

async function extractXlsxBytes(bytes, options = {}) {
  return core.extractXlsxToEvents(bytes, options, browserPort);
}

async function extractXlsxJsonl(bytes, options = {}) {
  return core.extractXlsxToJsonl(bytes, options, browserPort);
}

async function extractXlsxLayeredJsonl(bytes, options = {}) {
  return core.extractXlsxToLayeredJsonl(bytes, options, browserPort);
}

async function extractXlsxSeparated(bytes, options = {}) {
  return core.extractXlsxToEvents(bytes, { ...options, mode: 'separated' }, browserPort);
}

async function validateXlsxBytes(bytes) {
  return core.validateXlsxBytes(bytes, browserPort);
}

async function compareXlsxBytes(a, b) {
  return core.compareXlsxBytes(a, b, browserPort);
}

export { browserPort, compileJsonlText, compileEvents, compileLayeredJsonlTexts, compileLayeredTexts, compileSeparatedJsonl, extractXlsxBytes, extractXlsxJsonl, extractXlsxLayeredJsonl, extractXlsxSeparated, validateXlsxBytes, compareXlsxBytes };
export * from '../../core/index.mjs';
