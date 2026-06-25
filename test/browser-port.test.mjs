import test from 'node:test';
import assert from 'node:assert/strict';
import { compileJsonlText, extractXlsxJsonl, validateXlsxBytes } from '../src/adapters/browser/index.mjs';
import { readFile } from 'node:fs/promises';

const browserPhoneticFixture = new URL('./fixtures/phonetic_rph_fixture.xlsx', import.meta.url);

test('browser adapter compiles and semantically extracts without node facade', async () => {
  const jsonl = '{"op":"workbook.init","title":"browser"}\n{"op":"sheet.upsert","sheet_id":"s","name":"B"}\n{"op":"row.emit","sheet":"s","row":1,"values":["ok",2]}\n';
  const bytes = await compileJsonlText(jsonl, { now: '1980-01-01T00:00:00Z' });
  assert.deepEqual(await validateXlsxBytes(bytes), []);
  const semanticJsonl = await extractXlsxJsonl(bytes, { mode: 'semantic', ts: '1980-01-01T00:00:00Z' });
  assert.match(semanticJsonl, /cell\.set|cell\.value\.set|row\.values/);
  assert.doesNotMatch(semanticJsonl, /package\./);
  const roundtrip = await compileJsonlText(semanticJsonl, { mode: 'semantic', now: '1980-01-01T00:00:00Z' });
  assert.deepEqual(await validateXlsxBytes(roundtrip), []);
});

test('browser adapter semantic extraction also excludes rPh phonetic text', async () => {
  const bytes = await readFile(browserPhoneticFixture);
  const jsonl = await extractXlsxJsonl(bytes, { mode: 'semantic', ts: '1980-01-01T00:00:00Z' });
  assert.match(jsonl, /Synthetic Alpha Record/);
  assert.match(jsonl, /Synthetic Beta List/);
  assert.doesNotMatch(jsonl, /ALPHA_READING/);
  assert.doesNotMatch(jsonl, /BETA_READING/);
});
