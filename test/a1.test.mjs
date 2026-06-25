import test from 'node:test';
import assert from 'node:assert/strict';
import { colToIndex, indexToCol, normalizeRange, sha256Hex, utf8Encode } from '../src/core/index.mjs';

test('A1 address conversion bounds', () => {
  assert.equal(colToIndex('A'), 1);
  assert.equal(colToIndex('XFD'), 16384);
  assert.equal(indexToCol(16384), 'XFD');
  assert.equal(normalizeRange('B2:A1'), 'A1:B2');
  assert.throws(() => colToIndex('XFE'), /bounds/);
});

test('pure sha256 helper is deterministic', () => {
  assert.equal(sha256Hex(utf8Encode('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});
