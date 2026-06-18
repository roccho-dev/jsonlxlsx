# jsonlxlsx JS-Only Engine

This is a **JavaScript-only re-proposal** of the JSONL-to-XLSX rendering engine, addressing the Python implementation from the prior proposal.

## Status

- **Branch**: `proposal/jsonlxlsx-js-only-engine-260618`
- **Language**: JavaScript (ES modules)
- **Core Libraries**: exceljs (XLSX), vitest (tests)
- **Prior Proposal Issue**: Python implementation (`*.py`, `pyproject.toml`) — **rejected, rewritten in JS**
- **Rename/Supersede**: `jsonxlsx` is the superseded source name; `jsonlxlsx` is canonical. The old repo remains compatibility residue and is not deleted.

## Quick Start

Verify the engine works in ~30 seconds:

```bash
npm ci
npm test
npm run check:exportability
npm audit --audit-level=moderate
npm run example
```

This generates `examples/output.xlsx` with two sheets (`releases` and `steps`) containing sample data from `examples/minimal/`.

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

### Quickest Example: No Template Required

The minimal example works **without** providing a template. The engine creates sheets from your config:

```bash
node src/cli.js \
  --schema examples/minimal/config/schema.jsonl \
  --masters examples/minimal/masters \
  --edges "" \
  --config examples/minimal/config/sheets.jsonl \
  --output output.xlsx
```

This creates `output.xlsx` with sheets named `releases` and `steps`, populated from the data in `examples/minimal/masters/`.

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
  templatePath: null,  // Optional: omit for no template, or provide a styled template.xlsx
  configContent: sheetsJsonl,
  state,
  outputPath: 'output.xlsx',
});
```

### As a CLI (with optional template)

```bash
node src/cli.js \
  --schema config/schema.jsonl \
  --masters masters.jsonl \
  --edges edges.jsonl \
  --config config/sheets.jsonl \
  --template template.xlsx \
  --output output.xlsx
```

Omit `--template` if you want the engine to create plain sheets. Provide one if you want to apply your styles.

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

### Minimal Path (No Template)

1. **Define schema**: Create `config/schema.jsonl` with your entity types
2. **Map fields**: Create `config/sheets.jsonl` with columns (see `examples/minimal/config/sheets.jsonl`)
3. **Provide data**: Add JSONL records to `masters/` and `edges/`
4. **Render**: Run the CLI (or call `engineFromDir()`) — sheets are created automatically

**No template file is needed.** The engine generates plain sheets from your config.

### Styled Path (With Template)

If you want to apply custom styles (colors, fonts, borders):

1. Design an XLSX template with your styles (header row, fonts, fills, borders, etc.)
2. In your sheet config, set:
   - `data_start_row`: Row where data injection begins (e.g., 2, skipping the header in row 1)
   - `style_template_row`: Row from which styles are copied to all data rows (e.g., 2)
3. Provide the template path to the CLI or library call

Example sheet config with template:
```json
{"sheet":"releases","source":"release","strategy":"data_replace","data_start_row":2,"style_template_row":2,"columns":[{"col":1,"src":"id"},{"col":2,"src":"name"}]}
```

The engine will copy styles from row 2 of your template and inject data starting at row 2, applying the same styles to all rows.

**No code changes required** if your config is correct.

## Implementation Notes

- **No Python**: JS-only, no `.py` or `pyproject.toml` files
- **Minimal deps**: exceljs for XLSX, vitest for tests
- **Portable code**: No hardcoded identifiers, all business logic in config
- **Tested**: Reduce, render, edge lookups, bumon matrices covered
- **Exportability verified**: Denylist check prevents accidental data leakage

## Status

**Ready for Proposal** (Gen1 re-proposal)

---

**SSOT**: `ssh://100.124.250.91/home/nixos/repos/jsonlxlsx.git`  
**Proposal Date**: 2026-06-18  
**Branch**: `proposal/jsonlxlsx-js-only-engine-260618`  
**Author**: Gen1 (Claude Code), canonical rename by Gen2 Codex

**Supersedes**: `ssh://100.124.250.91/home/nixos/repos/jsonxlsx.git` branch `proposal/jsonxlsx-js-only-engine-260618` at `cc5bc67c2be0e8d401bdb140d49cb252ddf0c927`; retained as compatibility residue.
