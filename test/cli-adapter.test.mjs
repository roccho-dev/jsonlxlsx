import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs, runNodeCli } from '../src/adapters/cli/node.mjs';
import { validateXlsx } from '../src/adapters/node/index.mjs';

const demoEvents = [
  { op: 'workbook.init', title: 'cli', created: '1980-01-01T00:00:00Z' },
  { op: 'sheet.upsert', sheet_id: 's', name: 'CLI' },
  { op: 'row.emit', sheet: 's', row: 1, values: ['ok'] }
];

test('cli is an adapter around node facade', async () => {
  assert.deepEqual(parseArgs(['compile', 'a.jsonl', 'b.xlsx', '--mode', 'semantic']).positional, ['a.jsonl', 'b.xlsx']);
  const dir = await mkdtemp(join(tmpdir(), 'cli-adapter-'));
  const jsonl = join(dir, 'demo.jsonl');
  const xlsx = join(dir, 'demo.xlsx');
  await writeFile(jsonl, demoEvents.map(e => JSON.stringify(e)).join('\n') + '\n', 'utf8');
  const out = [];
  const code = await runNodeCli(['compile', jsonl, xlsx, '--now', '1980-01-01T00:00:00Z'], { out: text => out.push(text), err: text => out.push(text), exit: value => out.push(`exit:${value}`) });
  assert.equal(code, 0);
  assert.equal(JSON.parse(out[0]).output, xlsx);
  assert.deepEqual(await validateXlsx(xlsx), []);
});
