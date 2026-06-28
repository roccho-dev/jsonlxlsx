import { readZip } from './zip.mjs';
import { parseXml } from './xml.mjs';
import { sha256Hex } from './binary.mjs';

async function validateXlsxBytes(xlsxBytes, port = {}) {
  const errors = [];
  let entries;
  try {
    entries = await readZip(xlsxBytes, {}, port);
  } catch (err) {
    return [`zip read error: ${err.message}`];
  }
  const names = new Set(entries.map(e => e.path));
  for (const req of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/styles.xml']) {
    if (!names.has(req)) errors.push(`missing OOXML part: ${req}`);
  }
  for (const e of entries) {
    if (e.path.endsWith('.xml') || e.path.endsWith('.rels')) {
      try { parseXml(e.data); } catch (err) { errors.push(`XML parse error in ${e.path}: ${err.message}`); }
    }
  }
  return errors;
}

async function zipPartHashesFromBytes(xlsxBytes, port = {}) {
  const out = {};
  for (const e of await readZip(xlsxBytes, {}, port)) out[e.path] = sha256Hex(e.data);
  return out;
}

async function compareXlsxBytes(aBytes, bBytes, port = {}) {
  const ha = await zipPartHashesFromBytes(aBytes, port);
  const hb = await zipPartHashesFromBytes(bBytes, port);
  const names = new Set([...Object.keys(ha), ...Object.keys(hb)]);
  const different = [];
  const missingA = [];
  const missingB = [];
  for (const name of [...names].sort()) {
    if (!(name in ha)) missingA.push(name);
    else if (!(name in hb)) missingB.push(name);
    else if (ha[name] !== hb[name]) different.push(name);
  }
  return { equal: !missingA.length && !missingB.length && !different.length, missingA, missingB, different, countA: Object.keys(ha).length, countB: Object.keys(hb).length };
}

export { validateXlsxBytes, zipPartHashesFromBytes, compareXlsxBytes };
