# JSONL-to-XLSX Engine: Design Document

## Purpose Lineage

This document establishes the design rationale for a portable JSONL-to-XLSX rendering engine.

### Meta Objectives

| Meta | Statement | Verification |
|---|---|---|
| purpose0 | Survive WSL/Claude/tmp-worktree loss | Engine can be re-instantiated from SSOT bare repo |
| meta1 | Preserve reusable inventions, not local artifacts | This repo contains only portable code, no domain-specific secrets |
| meta2 | Make JSONL-to-XLSX reusable across repos/projects | Single module works with any masters/edges/config structure |
| meta3 | Separate portable technique from non-portable data | No hardcoded customer/project/person/product names |
| meta4 | Prevent future agents from promoting confidential data | Test suite verifies forbidden patterns absent |
| meta5 | Leave proposal/ADR material that can be reviewed | This document + design decisions recorded inline |
| meta6 | Increase company value through reusable process/IP | Pattern can be deployed in new projects without license cost |
| meta7 | Improve operational continuity under tool failure | JSONL append-only design survives partial writes |
| meta8 | Make organizational learning durable | Design pattern documented and tested for future reference |
| meta9 | Keep decision provenance in SSOT | ADR/RFC lifecycle tracked in git history |
| meta10 | Terminal assumption is corporate sale; only buyer-transferable | All code is generic, no project-specific bindings |

## Core Patterns

### 1. Append-Only JSONL Logs

**Why**: Append-only semantics provide durability under partial writes and simplify concurrency.
- Records never mutate; new state is appended as a new record
- Natural key identifies equivalence; latest _ts wins
- _deleted: true tombstones records without hard deletes

**Implementation**: `jsonxlsx/reduce.py::reduce_log()`
- Partition records by natural key (config-driven)
- For each group, keep only _ts-bearing records if any exist
- Select winner by latest _ts
- Exclude winners with _deleted: true

**Portable Pattern**:
```
records: [
  {id: "a", value: "x", _ts: "2026-01-01"},
  {id: "a", value: "y", _ts: "2026-01-02"},  ← wins
  {id: "b", value: "z", _ts: "2026-01-01"},
]
↓ reduce_log()
[
  {id: "a", value: "y", _ts: "2026-01-02"},
  {id: "b", value: "z", _ts: "2026-01-01"},
]
```

### 2. Schema-Driven Natural Key Dispatch

**Why**: Business logic for "what makes this record unique" lives in config, not in code.
- Each record type declares presence fields and key fields
- Different types coexist in the same log with different keys
- Schema is itself append-only (bootstrapped from config/schema.jsonl)

**Implementation**: `jsonxlsx/reduce.py::_record_key()`
- For each schema spec, check if record has all presence fields
- If all presence + non_null constraints met, return (type, *key_values)
- Fallback to generic key (sorted non-metadata fields) if no schema matches

**Portable Pattern**:
```
schema.jsonl:
{type: "release", presence: ["id", "name"], key: ["id"]}
{type: "step", presence: ["step_id", "release_id"], key: ["step_id"]}

masters/mixed.jsonl:
{id: "rel-001", name: "release-a"}  ← natural key ("release", "rel-001")
{step_id: "stp-001", release_id: "rel-001"}  ← natural key ("step", "stp-001")
```

### 3. Config-Driven Sheet Rendering

**Why**: Styling, layout, and business rules are declarations, not imperative code.

**Implementation**: `jsonxlsx/render.py` + `config/sheets.jsonl`
- Load reference XLSX template (format/style source)
- For each sheet config, apply strategy (preserve or data_replace)
- data_replace: clear data rows, inject from masters, apply styles from template
- preserve: keep template as-is, apply cell_overrides if configured

**Sheet Config Example**:
```jsonl
{
  sheet: "releases",
  source: "release",
  strategy: "data_replace",
  data_start_row: 2,
  style_template_row: 2,
  columns: [
    {col: 1, src: "id"},
    {col: 2, src: "name"},
    {col: 3, literal: "placeholder"}
  ]
}
```

**Portable Pattern**: All rendering decisions are configuration; no Python changes needed for new sheets.

### 4. Edge Lookups for Joins

**Why**: Relationship data lives in separate "edges" JSONL, reducing duplication and coupling.

**Implementation**: `jsonxlsx/render.py::render_sheet_data_replace()`
- After normal column rendering, scan for edge_lookup directives
- For each edge lookup, join masters record with edges on match criteria
- Apply where conditions, select result field

**Edge Lookup Config Example**:
```jsonl
{
  col: 5,
  edge_lookup: {
    source: "approval",
    match: {from_id: "id"},
    where: {status: "approved"},
    select: "approver_name"
  }
}
```

**Portable Pattern**: Relationship modeling without hardcoding join logic.

### 5. Bumon (Department) Matrix Support

**Why**: Multi-dimensional assignment grids (rows = items, columns = departments, cells = marks) are common in Japanese business.

**Implementation**: `jsonxlsx/render.py::render_sheet_data_replace()`
- bumon_matrix config specifies edge source, field mappings, column range
- For each record, match edges by id_field, build map of bumon_id → mark_field
- Fill matrix cells by (record_row, bumon_column)

**Portable Pattern**: Generic support for N×M assignment matrices without custom code.

## Decision Log

### D1: JSONL over database snapshots
- Chosen: JSONL (append-only logs)
- Rationale: Durability, concurrency, no external dependencies
- Tradeoff: Less queryable than SQL, but JSONL is human-readable and git-friendly

### D2: Reduce vs. eager apply
- Chosen: Lazy reduce (apply at render time)
- Rationale: Business rules (schema, TTL) can change; reduce is idempotent
- Tradeoff: Reduce cost amortized to render time, not record-write time

### D3: Template-based styling
- Chosen: Load XLSX template, copy styles at render
- Rationale: Format/styling decision separate from data
- Tradeoff: Requires valid template XLSX, but decouples concerns

### D4: Config in JSONL vs. YAML/TOML
- Chosen: JSONL (append-only config)
- Rationale: Config itself is data; append-only versioning applies to config
- Tradeoff: Less readable than YAML, but consistent with data model

## Exportability Assessment

See `docs/EXPORTABILITY.md` for detailed portability mapping.

**Summary**: 
- ✅ Portable: Core reduce/render logic, schema/config model, synthetic examples
- ⚠️ Borderline: Template generation (test creates synthetic templates, not copied)
- ❌ Non-portable: Domain-specific master data, customer/product/company identifiers, real infrastructure URLs

## Future Extensions

1. **Streaming reduce**: For large logs, reduce in chunks without materializing full state
2. **Schema evolution**: Handle field renames, type changes via versioned schema
3. **Multi-format output**: CSV, JSON, Parquet in addition to XLSX
4. **Validation**: Pre-render validation of records against schema constraints
5. **Observable reduce**: Emit events during reduce for audit/monitoring

---

**Document Status**: Proposal v0.1 (2026-06-18)  
**Author**: Gen1 (Claude Code)  
**Reviewable**: Yes – design rationale and patterns are stable  
**Adoptable**: Yes – all code is minimal, tested, and portable
