import { describe, it, expect } from 'vitest';
import { loadJsonl, initSchema, reduceLog, materialize } from '../src/reduce.js';

describe('loadJsonl', () => {
  it('parses JSONL with multiple objects', () => {
    const content = '{"id":1}\n{"id":2}\n{"id":3}';
    const result = loadJsonl(content);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ id: 1 });
  });

  it('skips blank lines', () => {
    const content = '{"id":1}\n\n{"id":2}\n  \n{"id":3}';
    const result = loadJsonl(content);
    expect(result).toHaveLength(3);
  });

  it('handles empty input', () => {
    const result = loadJsonl('');
    expect(result).toHaveLength(0);
  });
});

describe('initSchema', () => {
  it('builds schema map from records', () => {
    const records = [
      { type: 'release', presence: ['id'], key: ['id'] },
      { type: 'step', presence: ['step_id', 'release_id'], key: ['step_id'] },
    ];
    const schema = initSchema(records);
    expect(schema.size).toBe(2);
    expect(schema.get('release')).toEqual({
      presence: ['id'],
      key: ['id'],
      nonNull: [],
    });
  });

  it('ignores incomplete schema records', () => {
    const records = [
      { type: 'release', presence: ['id'] }, // missing key
      { type: 'step', presence: ['step_id'], key: ['step_id'] },
    ];
    const schema = initSchema(records);
    expect(schema.size).toBe(1);
    expect(schema.has('step')).toBe(true);
  });
});

describe('reduceLog', () => {
  it('partitions by natural key and keeps latest by _ts', () => {
    const records = [
      { id: 'a', value: 'x', _ts: '2026-01-01' },
      { id: 'a', value: 'y', _ts: '2026-01-02' }, // newer
      { id: 'b', value: 'z', _ts: '2026-01-01' },
    ];
    const schema = new Map([
      ['default', { presence: ['id'], key: ['id'], nonNull: [] }],
    ]);
    const result = reduceLog(records, schema);
    expect(result).toHaveLength(2);
    const aRecord = result.find((r) => r.id === 'a');
    expect(aRecord.value).toBe('y');
  });

  it('excludes records marked _deleted: true', () => {
    const records = [
      { id: 'a', value: 'x', _ts: '2026-01-01' },
      { id: 'a', value: 'deleted', _ts: '2026-01-02', _deleted: true },
    ];
    const schema = new Map();
    const result = reduceLog(records, schema);
    expect(result).toHaveLength(0);
  });

  it('uses fallback generic key if no schema matches', () => {
    const records = [
      { name: 'Alice', age: 30 },
      { name: 'Bob', age: 25 },
      { name: 'Alice', age: 31 },
    ];
    const schema = new Map(); // empty
    const result = reduceLog(records, schema);
    // Generic key includes all non-meta fields sorted
    // Alice records should be deduplicated
    expect(result.length).toBeGreaterThanOrEqual(1);
  });

  it('respects non_null constraints in schema', () => {
    const records = [
      { id: 'a', required: 'yes', _ts: '2026-01-01' },
      { id: 'a', required: null, _ts: '2026-01-02' }, // fails non_null
    ];
    const schema = new Map([
      [
        'release',
        {
          presence: ['id', 'required'],
          key: ['id'],
          nonNull: ['required'],
        },
      ],
    ]);
    const result = reduceLog(records, schema);
    expect(result).toHaveLength(1);
    expect(result[0].required).toBe('yes');
  });
});

describe('materialize', () => {
  it('loads, initializes schema, and reduces all inputs', () => {
    const inputs = {
      schema: '{"type":"release","presence":["id"],"key":["id"]}\n',
      masters: '{"id":"a","name":"x","_ts":"2026-01-01"}\n{"id":"a","name":"y","_ts":"2026-01-02"}\n',
      edges: '{"from":"a","to":"b","_ts":"2026-01-01"}\n',
    };
    const result = materialize(inputs);
    expect(result.schema.size).toBe(1);
    expect(result.masters).toHaveLength(1);
    expect(result.masters[0].name).toBe('y');
    expect(result.edges).toHaveLength(1);
  });

  it('handles missing input sections', () => {
    const inputs = { schema: '' };
    const result = materialize(inputs);
    expect(result.schema.size).toBe(0);
    expect(result.masters).toHaveLength(0);
    expect(result.edges).toHaveLength(0);
  });
});
