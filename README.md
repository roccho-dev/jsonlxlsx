# jsonxlsx JS-Only Engine

This is a **JavaScript-only re-proposal** of the JSONL-to-XLSX rendering engine, addressing the Python implementation from the prior proposal.

## Status

- **Branch**: `proposal/jsonxlsx-js-only-engine-260618`
- **Language**: JavaScript (ES modules)
- **Core Libraries**: exceljs (XLSX), vitest (tests)
- **Prior Proposal Issue**: Python implementation (`*.py`, `pyproject.toml`) — **rejected, rewritten in JS**

## What This Is

A portable JSONL-to-XLSX engine with:

- **Append-only JSONL reduce**: Partition by natural key, keep latest by `_ts`, tombstone deletion
- **Schema-driven natural key dispatch**: Config-driven, no hardcoded keys
- **Template-based XLSX rendering**: Load template, copy styles, inject data
- **Edge lookups**: FK-like joins between masters and edges
- **Bumon matrices**: N×M assignment grids for Japanese business workflows

## Design

See `/docs/DESIGN.md` for full design rationale. Key patterns:

| Pattern | Purpose | Implementation |
|---|---|---|
| Append-only reduce | Durability, concurrency, TTL-driven | `src/reduce.js::reduceLog()` |
| Schema-driven keys | Config not code | `src/reduce.js::recordKey()` |
| Template rendering | Style/data separation | `src/render.js::renderSheetDataReplace()` |
| Edge lookups | Relational joins | `src/render.js` (edge_lookup config) |
| Bumon matrix | N×M assignments | `src/render.js` (bumon_matrix config) |

## Installation

```bash
npm install
```

## Usage

### As a Library

```javascript
import { materialize } from './src/reduce.js';
import { render } from './src/render.js';

const state = materialize({
  schema: schemaJsonl,
  masters: mastersJsonl,
  edges: edgesJsonl,
});

await render({
  templatePath: 'template.xlsx',
  configContent: sheetsJsonl,
  state,
  outputPath: 'output.xlsx',
});
```

### As a CLI

```bash
node src/cli.js \
  --schema config/schema.jsonl \
  --masters masters.jsonl \
  --edges edges.jsonl \
  --config config/sheets.jsonl \
  --template template.xlsx \
  --output output.xlsx
```

## Project Structure

```
src/
  reduce.js       # Append-only reduce + natural key dispatch
  render.js       # Template + style + data injection
  engine.js       # Orchestration (reduce → render)
  cli.js          # Thin CLI adapter

test/
  reduce.test.js  # Reduce logic tests
  render.test.js  # Render logic tests
  exportability.test.js # Security/portability checks

examples/minimal/
  config/
    schema.jsonl  # Record type definitions
    sheets.jsonl  # Sheet rendering configs
  masters/
    release.jsonl # Sample release data
    step.jsonl    # Sample step data

scripts/
  check-exportability.js # Verify no forbidden patterns
  denylist.txt          # Custom forbidden identifiers

docs/
  DESIGN.md       # Design rationale (from main)
  EXPORTABILITY.md # Portability assessment (from main)
```

## Testing

```bash
npm test                  # Run all tests
npm run test:watch       # Watch mode
npm run check:exportability # Exportability audit
```

## Exportability

This engine is designed to be **portable and reusable**:

✅ **Portable**:
- Core reduce/render logic (generic algorithms)
- Schema/config model (append-only JSONL)
- Synthetic examples (abstract names)

⚠️ **Requires Adaptation**:
- Your domain entity types (replace `release`, `step`, `approval` with your domain)
- Your XLSX template (create your own styling)
- Your masters/edges structure

❌ **Not Portable**:
- Customer/project/company identifiers
- Real infrastructure URLs
- Credentials or environment-specific config

See `docs/EXPORTABILITY.md` for detailed assessment.

## For Adopters

1. **Customize schema**: Define your entity types in `config/schema.jsonl`
2. **Create template**: Design XLSX with your styles
3. **Map fields**: Configure columns in `config/sheets.jsonl`
4. **Provide data**: Append JSONL records to `masters/` and `edges/`
5. **Render**: Call `engine()` or CLI to produce output XLSX

No code changes required if your config is correct.

## Implementation Notes

- **No Python**: JS-only, no `.py` or `pyproject.toml` files
- **Minimal deps**: exceljs for XLSX, vitest for tests
- **Portable code**: No hardcoded identifiers, all business logic in config
- **Tested**: Reduce, render, edge lookups, bumon matrices covered
- **Exportability verified**: Denylist check prevents accidental data leakage

## Status

**Ready for Proposal** (Gen1 re-proposal)

---

**SSOT**: `ssh://100.124.250.91/home/nixos/repos/jsonxlsx.git`  
**Proposal Date**: 2026-06-18  
**Branch**: `proposal/jsonxlsx-js-only-engine-260618`  
**Author**: Gen1 (Claude Code)
