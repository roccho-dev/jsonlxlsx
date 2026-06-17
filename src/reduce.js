/**
 * Append-only JSONL reduce: partition by natural key, select latest by _ts.
 * Schema-driven natural key dispatch with fallback to generic key.
 */

/**
 * Load and parse JSONL file into records.
 * @param {string} content - JSONL content (one JSON object per line)
 * @returns {Array<Object>} Parsed records, skipping blank lines
 */
export function loadJsonl(content) {
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line));
}

/**
 * Initialize schema from schema.jsonl records.
 * @param {Array<Object>} schemaRecords - Records with type, presence, key fields
 * @returns {Map<string, Object>} Type → {presence, key} schema mapping
 */
export function initSchema(schemaRecords) {
  const schema = new Map();
  for (const rec of schemaRecords) {
    if (rec.type && rec.presence && rec.key) {
      schema.set(rec.type, {
        presence: rec.presence,
        key: rec.key,
        nonNull: rec.non_null || [],
      });
    }
  }
  return schema;
}

/**
 * Compute natural key for a record given schema.
 * Returns (type, ...keyValues) tuple or null if no schema matches.
 * @param {Object} record - Data record
 * @param {Map<string, Object>} schema - Type → {presence, key} mapping
 * @returns {Array|null} [type, ...keyValues] or null
 */
function recordKey(record, schema) {
  // Try schema-driven dispatch
  for (const [type, spec] of schema.entries()) {
    const hasAll = spec.presence.every((f) => f in record);
    if (!hasAll) continue;

    // Check non_null constraints if present
    if (spec.nonNull.length > 0) {
      const nullOk = spec.nonNull.every((f) => record[f] != null);
      if (!nullOk) continue;
    }

    // Extract key values
    const keyVals = spec.key.map((f) => record[f]);
    return [type, ...keyVals];
  }

  // Fallback: generic key from sorted non-metadata fields
  const nonMeta = Object.entries(record)
    .filter(([k]) => !k.startsWith('_'))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, v]) => v);
  return nonMeta.length > 0 ? nonMeta : null;
}

/**
 * Reduce JSONL records: partition by natural key, keep latest by _ts.
 * Exclude records marked _deleted: true.
 * @param {Array<Object>} records - Input records
 * @param {Map<string, Object>} schema - Type → {presence, key} mapping
 * @returns {Array<Object>} Reduced records
 */
export function reduceLog(records, schema) {
  const groups = new Map();

  for (const rec of records) {
    const key = recordKey(rec, schema);
    if (!key) continue; // Skip records with no key

    const keyStr = JSON.stringify(key);
    if (!groups.has(keyStr)) {
      groups.set(keyStr, []);
    }
    groups.get(keyStr).push(rec);
  }

  const result = [];
  for (const [keyStr, group] of groups) {
    // Filter to records with _ts; if none, use the record as-is
    const withTs = group.filter((r) => '_ts' in r);
    const winners = withTs.length > 0 ? withTs : group;

    // Sort by _ts descending (newest first)
    winners.sort(
      (a, b) =>
        (b._ts || '').localeCompare(a._ts || '')
    );

    const winner = winners[0];

    // Skip if marked deleted
    if (winner._deleted === true) continue;

    result.push(winner);
  }

  return result;
}

/**
 * Load multiple JSONL files, reduce, and materialize state.
 * @param {Object} inputs - {schema, masters, edges} content strings
 * @returns {Object} {schema, masters, edges} materialized records
 */
export function materialize(inputs) {
  const schemaRecords = loadJsonl(inputs.schema || '');
  const schema = initSchema(schemaRecords);

  const masters = reduceLog(
    loadJsonl(inputs.masters || ''),
    schema
  );
  const edges = reduceLog(
    loadJsonl(inputs.edges || ''),
    schema
  );

  return { schema, masters, edges };
}
