import { assert } from './errors.mjs';
import { toUint8Array, utf8Decode } from './binary.mjs';

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data) {
  const bytes = toUint8Array(data);
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function readU16(buf, off) {
  return new DataView(buf.buffer, buf.byteOffset, buf.byteLength).getUint16(off, true);
}

function readU32(buf, off) {
  return new DataView(buf.buffer, buf.byteOffset, buf.byteLength).getUint32(off, true);
}

function dateFromDos(dosDate, dosTime) {
  const day = dosDate & 31;
  const month = (dosDate >>> 5) & 15;
  const year = ((dosDate >>> 9) & 127) + 1980;
  const sec = (dosTime & 31) * 2;
  const min = (dosTime >>> 5) & 63;
  const hour = (dosTime >>> 11) & 31;
  return [year, month, day, hour, min, sec];
}

function safeZipPath(name) {
  const path = String(name || '').replace(/\\/g, '/');
  assert(path && !path.startsWith('/') && !path.split('/').includes('..'), `unsafe ZIP entry path: ${name}`);
  return path;
}

async function requireInflate(port, raw) {
  assert(port && typeof port.inflateRaw === 'function', 'zip method 8 requires a port.inflateRaw adapter');
  return toUint8Array(await port.inflateRaw(raw));
}

function findEndOfCentralDirectory(buf) {
  const min = Math.max(0, buf.length - 0xffff - 22);
  for (let i = buf.length - 22; i >= min; i--) {
    if (readU32(buf, i) === 0x06054b50) return i;
  }
  throw new Error('ZIP end of central directory not found');
}

async function readZip(buffer, options = {}, port = {}) {
  const buf = toUint8Array(buffer);
  const eocd = findEndOfCentralDirectory(buf);
  const count = readU16(buf, eocd + 10);
  const centralSize = readU32(buf, eocd + 12);
  const centralOffset = readU32(buf, eocd + 16);
  assert(centralOffset + centralSize <= buf.length, 'ZIP central directory is out of bounds');
  const entries = [];
  const seen = new Set();
  let p = centralOffset;
  for (let i = 0; i < count; i++) {
    assert(readU32(buf, p) === 0x02014b50, `Invalid central directory signature at ${p}`);
    const flags = readU16(buf, p + 8);
    const method = readU16(buf, p + 10);
    const dosTime = readU16(buf, p + 12);
    const dosDate = readU16(buf, p + 14);
    const entryCrc = readU32(buf, p + 16);
    const compSize = readU32(buf, p + 20);
    const uncompSize = readU32(buf, p + 24);
    const fileNameLen = readU16(buf, p + 28);
    const extraLen = readU16(buf, p + 30);
    const commentLen = readU16(buf, p + 32);
    const externalAttr = readU32(buf, p + 38);
    const localOffset = readU32(buf, p + 42);
    assert((flags & 1) === 0, 'encrypted ZIP entries are not supported');
    const nameRaw = buf.slice(p + 46, p + 46 + fileNameLen);
    const name = (flags & 0x0800) ? utf8Decode(nameRaw) : [...nameRaw].map(x => String.fromCharCode(x)).join('');
    p += 46 + fileNameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue;
    const path = safeZipPath(name);
    assert(!seen.has(path), `duplicate ZIP entry path: ${path}`);
    seen.add(path);
    assert(readU32(buf, localOffset) === 0x04034b50, `Invalid local file header for ${path}`);
    const localNameLen = readU16(buf, localOffset + 26);
    const localExtraLen = readU16(buf, localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    assert(dataStart + compSize <= buf.length, `ZIP entry data is out of bounds for ${path}`);
    const compressed = buf.slice(dataStart, dataStart + compSize);
    let data;
    if (method === 0) data = compressed.slice();
    else if (method === 8) data = await requireInflate(port, compressed);
    else if (options.allowUnsupported) data = compressed.slice();
    else throw new Error(`Unsupported ZIP compression method ${method} for ${path}`);
    assert(options.skipCrc || crc32(data) === entryCrc, `CRC mismatch for ${path}`);
    assert(options.allowSizeMismatch || data.length === uncompSize, `Uncompressed size mismatch for ${path}`);
    entries.push({ path, data, method, flags, crc32: entryCrc.toString(16).padStart(8, '0'), compressedSize: compSize, size: data.length, order: entries.length, dateTime: dateFromDos(dosDate, dosTime), externalAttr });
  }
  return entries;
}

function entriesToMap(entries) {
  return new Map(entries.map(e => [e.path, e.data]));
}


function dosDateTimeFromArray(dateTime) {
  const [year = 1980, month = 1, day = 1, hour = 0, min = 0, sec = 0] = Array.isArray(dateTime) ? dateTime : [];
  const y = Math.max(1980, Math.min(2107, Number(year) || 1980));
  const m = Math.max(1, Math.min(12, Number(month) || 1));
  const d = Math.max(1, Math.min(31, Number(day) || 1));
  const h = Math.max(0, Math.min(23, Number(hour) || 0));
  const mi = Math.max(0, Math.min(59, Number(min) || 0));
  const se = Math.max(0, Math.min(59, Number(sec) || 0));
  return {
    time: ((h << 11) | (mi << 5) | Math.floor(se / 2)) & 0xffff,
    date: (((y - 1980) << 9) | (m << 5) | d) & 0xffff
  };
}

async function maybeDeflate(port, data, compress) {
  if (!compress || !data.length || !port || typeof port.deflateRaw !== 'function') return { data, method: 0 };
  const compressed = toUint8Array(await port.deflateRaw(data));
  if (compressed.length >= data.length) return { data, method: 0 };
  return { data: compressed, method: 8 };
}

async function writeZip(entries, options = {}, port = {}) {
  const encoder = new TextEncoder();
  const prepared = [];
  const seen = new Set();
  for (const entry of entries || []) {
    const path = safeZipPath(entry.path);
    assert(!seen.has(path), `duplicate ZIP entry path: ${path}`);
    seen.add(path);
    const data = toUint8Array(entry.data || new Uint8Array());
    const compress = entry.compress != null ? !!entry.compress : options.compress !== false;
    const packed = await maybeDeflate(port, data, compress);
    const dt = dosDateTimeFromArray(entry.dateTime || options.dateTime || [1980, 1, 1, 0, 0, 0]);
    prepared.push({ path, data, compressedData: packed.data, method: packed.method, crc: crc32(data), date: dt.date, time: dt.time, externalAttr: entry.externalAttr || 0 });
  }
  const encodedPaths = prepared.map(e => encoder.encode(e.path));
  let localSize = 0;
  for (let i = 0; i < prepared.length; i++) localSize += 30 + encodedPaths[i].length + prepared[i].compressedData.length;
  let centralSize = 0;
  for (let i = 0; i < prepared.length; i++) centralSize += 46 + encodedPaths[i].length;
  const totalSize = localSize + centralSize + 22;
  const output = new Uint8Array(totalSize);
  const view = new DataView(output.buffer);
  const localOffsets = [];
  let offset = 0;
  for (let i = 0; i < prepared.length; i++) {
    const entry = prepared[i];
    const pathBytes = encodedPaths[i];
    localOffsets.push(offset);
    view.setUint32(offset, 0x04034b50, true);
    view.setUint16(offset + 4, 20, true);
    view.setUint16(offset + 6, 0x0800, true);
    view.setUint16(offset + 8, entry.method, true);
    view.setUint16(offset + 10, entry.time, true);
    view.setUint16(offset + 12, entry.date, true);
    view.setUint32(offset + 14, entry.crc, true);
    view.setUint32(offset + 18, entry.compressedData.length, true);
    view.setUint32(offset + 22, entry.data.length, true);
    view.setUint16(offset + 26, pathBytes.length, true);
    view.setUint16(offset + 28, 0, true);
    output.set(pathBytes, offset + 30);
    offset += 30 + pathBytes.length;
    output.set(entry.compressedData, offset);
    offset += entry.compressedData.length;
  }
  const centralOffset = offset;
  for (let i = 0; i < prepared.length; i++) {
    const entry = prepared[i];
    const pathBytes = encodedPaths[i];
    view.setUint32(offset, 0x02014b50, true);
    view.setUint16(offset + 4, 20, true);
    view.setUint16(offset + 6, 20, true);
    view.setUint16(offset + 8, 0x0800, true);
    view.setUint16(offset + 10, entry.method, true);
    view.setUint16(offset + 12, entry.time, true);
    view.setUint16(offset + 14, entry.date, true);
    view.setUint32(offset + 16, entry.crc, true);
    view.setUint32(offset + 20, entry.compressedData.length, true);
    view.setUint32(offset + 24, entry.data.length, true);
    view.setUint16(offset + 28, pathBytes.length, true);
    view.setUint16(offset + 30, 0, true);
    view.setUint16(offset + 32, 0, true);
    view.setUint16(offset + 34, 0, true);
    view.setUint16(offset + 36, 0, true);
    view.setUint32(offset + 38, entry.externalAttr >>> 0, true);
    view.setUint32(offset + 42, localOffsets[i], true);
    output.set(pathBytes, offset + 46);
    offset += 46 + pathBytes.length;
  }
  const centralSizeActual = offset - centralOffset;
  view.setUint32(offset, 0x06054b50, true);
  view.setUint16(offset + 4, 0, true);
  view.setUint16(offset + 6, 0, true);
  view.setUint16(offset + 8, prepared.length, true);
  view.setUint16(offset + 10, prepared.length, true);
  view.setUint32(offset + 12, centralSizeActual, true);
  view.setUint32(offset + 16, centralOffset, true);
  view.setUint16(offset + 20, 0, true);
  return output;
}

export { crc32, readZip, writeZip, entriesToMap, safeZipPath };
