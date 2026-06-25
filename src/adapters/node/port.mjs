import { deflateRaw, inflateRaw } from 'node:zlib';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, mkdtemp, rm, copyFile } from 'node:fs/promises';
import { dirname, basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import { toUint8Array, utf8Decode } from '../../core/binary.mjs';

const deflateRawAsync = promisify(deflateRaw);
const inflateRawAsync = promisify(inflateRaw);

async function nodeDeflateRaw(bytes) {
  return new Uint8Array(await deflateRawAsync(Buffer.from(toUint8Array(bytes))));
}

async function nodeInflateRaw(bytes) {
  return new Uint8Array(await inflateRawAsync(Buffer.from(toUint8Array(bytes))));
}

async function readBytes(filePath) {
  return new Uint8Array(await readFile(filePath));
}

async function writeBytes(filePath, bytes) {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, Buffer.from(toUint8Array(bytes)));
}

async function readText(filePath) {
  return utf8Decode(await readBytes(filePath));
}

async function writeText(filePath, text) {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, String(text), 'utf8');
}

async function makeTempDir(prefix = 'jsonl-xlsx-') {
  return mkdtemp(join(tmpdir(), prefix));
}

async function removeTree(target) {
  await rm(target, { recursive: true, force: true });
}

async function copyFileBytes(from, to) {
  await mkdir(dirname(to), { recursive: true });
  await copyFile(from, to);
}

const nodePort = Object.freeze({
  runtime: 'node',
  deflateRaw: nodeDeflateRaw,
  inflateRaw: nodeInflateRaw,
  sha256: async bytes => createHash('sha256').update(Buffer.from(toUint8Array(bytes))).digest('hex')
});

export { nodePort, readBytes, writeBytes, readText, writeText, makeTempDir, removeTree, copyFileBytes, basename, dirname, join };
