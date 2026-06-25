import { assert } from './errors.mjs';
import { sha256Hex, utf8Encode } from './binary.mjs';

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

function jsonLine(value) {
  return JSON.stringify(value, null, 0);
}

function parseJsonlText(text, options = {}) {
  const events = [];
  String(text || '').split(/\r?\n/).forEach((line, index) => {
    const raw = line.trim();
    if (!raw) return;
    if (options.allowComments && (raw.startsWith('#') || raw.startsWith('//'))) return;
    let ev;
    try {
      ev = JSON.parse(line);
    } catch (err) {
      throw new Error(`Invalid JSONL at line ${index + 1}: ${err.message}`);
    }
    assert(ev && typeof ev === 'object' && !Array.isArray(ev), `JSONL line ${index + 1} must be an object`);
    ev._line = index + 1;
    events.push(ev);
  });
  return events;
}

function stringifyJsonl(events) {
  return events.map(jsonLine).join('\n') + (events.length ? '\n' : '');
}

function eventHash(event) {
  const clean = { ...event };
  delete clean._line;
  return sha256Hex(utf8Encode(stableStringify(clean)));
}

export { stableStringify, jsonLine, parseJsonlText, stringifyJsonl, eventHash };
