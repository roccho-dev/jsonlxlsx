import test from 'node:test';
import assert from 'node:assert/strict';
import { compileJsonlToBytes, extractXlsxToJsonl, validateEventShapes } from '../src/core/index.mjs';
import * as nodeApi from '../src/adapters/node/index.mjs';

const semanticEvents = [
  { op: 'workbook.init', title: 'no package mode' },
  { op: 'sheet.upsert', sheet_id: 's', name: 'S' },
  { op: 'cell.value.set', sheet: 's', cell: 'A1', value: 'editable' }
];

test('package mode public facades are removed', () => {
  assert.equal('extractPackage' in nodeApi, false);
  assert.equal('compilePackage' in nodeApi, false);
  assert.equal('hasPackageEvents' in nodeApi, false);
});

test('compile rejects explicit package mode', async () => {
  await assert.rejects(
    () => compileJsonlToBytes(semanticEvents, { mode: 'package' }),
    /package mode has been removed/
  );
});

test('extract rejects explicit package and hybrid modes', async () => {
  const bytes = await compileJsonlToBytes(semanticEvents, { mode: 'semantic', now: '1980-01-01T00:00:00Z' });
  await assert.rejects(
    () => extractXlsxToJsonl(bytes, { mode: 'package' }),
    /package mode has been removed/
  );
  await assert.rejects(
    () => extractXlsxToJsonl(bytes, { mode: 'hybrid' }),
    /package mode has been removed/
  );
});

test('schema rejects package events and package declarations', () => {
  assert.match(
    validateEventShapes([{ op: 'schema.declare', mode: 'package' }]).join('\n'),
    /package mode has been removed/
  );
  assert.match(
    validateEventShapes([{ op: 'schema.declare', mode: 'hybrid' }]).join('\n'),
    /package mode has been removed/
  );
  assert.match(
    validateEventShapes([{ op: 'schema.declare', package_mode: true }]).join('\n'),
    /package_mode must be false or omitted/
  );
  assert.match(
    validateEventShapes([{ op: 'package.part', path: '[Content_Types].xml', data_b64: 'AA==' }]).join('\n'),
    /unknown op/
  );
  assert.match(
    validateEventShapes([{ op: 'drawing.raw', sheet: 's', data_b64: 'AA==' }]).join('\n'),
    /unknown op/
  );
  assert.match(
    validateEventShapes([{ op: 'asset.media.part', path: 'xl/theme/theme1.xml', data_b64: 'AA==' }]).join('\n'),
    /asset.media.part path must be under xl\/media\//
  );
});
