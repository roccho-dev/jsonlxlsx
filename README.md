# jsonxlsx: Portable JSONL-to-XLSX Engine

A minimal, reusable Python package for rendering XLSX workbooks from append-only JSONL records using schema-driven natural key dispatch and configuration-driven sheet templating.

## Purpose Lineage

- **purpose0**: Survive WSL/Claude/tmp-worktree loss
- **meta1**: Preserve reusable inventions, not local artifacts
- **meta2**: Make JSONL-to-XLSX method reusable across repos/projects
- **meta3**: Separate portable technique from non-portable customer/project/person/product data
- **meta4**: Prevent future agents from promoting confidential identifiers or payloads
- **meta5**: Leave proposal/ADR material that can be reviewed
- **meta6**: Increase company value through reusable process/IP assets
- **meta7**: Improve operational continuity under tool failure
- **meta8**: Make organizational learning durable
- **meta9**: Keep decision provenance in SSOT
- **meta10**: Terminal assumption is corporate sale; only buyer-transferable assets are proposal candidates

## Core Features

### Append-Only JSONL Reduce
- **Natural key dispatch** driven by `config/schema.jsonl`
- **Latest-wins semantics** using `_ts` timestamps
- **Tombstone deletion** via `_deleted: true`
- **Generic fallback** for unmatched schemas with observability

### Config-Driven Rendering
- **Schema definitions** in `config/schema.jsonl` declare natural keys
- **Sheet configuration** in `config/sheets.jsonl` specify rendering strategy
- **Edge lookups** for joining masters with relationship edges
- **Cell overrides** for hardcoded template values
- **Bumon (department) matrix** support for multi-dimensional data

### Template-Based Output
- Load reference XLSX template (format/style source)
- Apply `data_replace` strategy (clear + inject) or `preserve` (template + overrides)
- Copy styles from template rows to generated rows
- Support for formula cells (with row interpolation)

## Usage

```bash
# Synthetic example
python -m jsonxlsx.engine \
  --template examples/minimal/template.xlsx \
  --output examples/minimal/output.xlsx \
  --masters examples/minimal/masters \
  --edges examples/minimal/edges \
  --config examples/minimal/config
```

## Project Structure

```
jsonxlsx/
  engine.py              # Core JSONL→XLSX renderer
  reduce.py              # Append-only reduce logic
  render.py              # Template & config rendering
examples/
  minimal/
    config/
      schema.jsonl       # Natural key definitions
      sheets.jsonl       # Sheet rendering config
    masters/
      release.jsonl      # Sample master records
    edges/
      (empty)            # Optional edge records
    template.xlsx        # Reference template
tests/
  test_reduce.py         # Reduce/tombstone semantics
  test_render.py         # XLSX cell value verification
  test_exportability.py  # Confirm no forbidden names
nix/
  flake.nix              # Reproducible environment
pyproject.toml           # Python package metadata
```

## Design Principles

1. **Pure Configuration**: All business logic lives in JSONL config, not in code
2. **Append-Only**: Source data is immutable; reduce determines final state
3. **Natural Keys**: Each record type declares its identity fields
4. **Template-Driven Styling**: Format comes from XLSX template, data from records
5. **No Hardcoded Values**: Decisions expressed as config, traceable and auditable

## Reference

Based on portable patterns extracted from:
- `gen_tested_xlsx.py`: TSV→XLSX simple view transformation
- `build_xlsx.py`: Full masters/edges/config rendering with reduce semantics

These implementations demonstrate that JSONL reduce + config-driven rendering is a durable pattern
suitable for cross-repo, cross-project reuse.
