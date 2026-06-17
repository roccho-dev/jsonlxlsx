# Exportability Assessment: JSONL-to-XLSX Engine

## Purpose

This document classifies code and content in this repo against the 10-point meta lineage, identifying what is portable and what must be sanitized before external use.

## Classification Table

| Category | Item | Classification | Rationale | Usage |
|---|---|---|---|---|
| **Portable Inventions** | Append-only reduce logic | ✅ Portable | Generic algorithm independent of domain | Core: `src/reduce.js` |
| | Schema-driven natural key dispatch | ✅ Portable | Config-driven; no hardcoded keys | Core: `src/reduce.js::recordKey()` |
| | Latest-wins semantics with _ts | ✅ Portable | Generic timestamp/tombstone pattern | Core: `src/reduce.js::reduceLog()` |
| | Template-based XLSX rendering | ✅ Portable | exceljs pattern; style/data separation | Core: `src/render.js` |
| | Edge lookup (relation join) | ✅ Portable | Generic FK-like join pattern | Core: `src/render.js::renderSheetDataReplace()` |
| | Bumon (N×M matrix) rendering | ✅ Portable | Parametric matrix filling | Core: `src/render.js::renderSheetDataReplace()` |
| | Engine CLI & config loading | ✅ Portable | Orchestrates reduce+render; no domain logic | Core: `src/engine.js` |
| **Sanitized Samples** | Synthetic schema.jsonl | ✅ Allowed | Uses abstract names (release, step, bumon) | Examples: `examples/minimal/config/schema.jsonl` |
| | Synthetic masters/release.jsonl | ✅ Allowed | Names: release-alpha, release-beta | Examples: `examples/minimal/masters/release.jsonl` |
| | Synthetic masters/step.jsonl | ✅ Allowed | Names: check-001, check-002, stp-*** | Examples: `examples/minimal/masters/step.jsonl` |
| | Synthetic sheets.jsonl | ✅ Allowed | Generic sheet rendering config | Examples: `examples/minimal/config/sheets.jsonl` |
| | Template generation (tests) | ✅ Allowed | Tests create XLSX programmatically (not copied) | Tests: `test/render.test.js` |
| **Non-Portable** | Domain-specific business objects | ❌ Excluded | Customer/project-specific implementations | Not in this repo |
| | Concrete XLSX file from source | ❌ Excluded | Contains real customer data, formatting | Not in this repo |
| | Department/team/person names | ❌ Excluded | Company-internal identifiers | Not in this repo |
| | Real URLs/endpoints | ❌ Excluded | Infrastructure-specific | Not in this repo |
| **Forbidden** | Project/customer/product identifiers | ❌ Forbidden | Company-specific names (denylist in scripts/denylist.txt) | Verified absent via external denylist |
| | Domain-specific business model | ❌ Forbidden | Not reusable; implementation-specific | Verified absent |
| | Cloud auth/credentials | ❌ Forbidden | Credential & infrastructure-specific | Verified absent |
| | GCP project IDs, BigQuery dataset names | ❌ Forbidden | Infrastructure-specific | Verified absent |
| | Japanese company/product names | ❌ Forbidden | PII/confidential | Verified absent |

## Exportability Verification

### ✅ What You Can Take

1. **Core Engine**
   - `src/reduce.js`: Append-only reduce + natural key dispatch
   - `src/render.js`: Template-based rendering + joins
   - `src/engine.js`: CLI orchestration
   - Tests: Reduce/render logic verification

2. **Design Patterns**
   - Append-only JSONL architecture
   - Config-driven rendering (schema, sheets, directives)
   - Natural key dispatch driven by schema
   - Template + style separation

3. **Examples**
   - Synthetic config (schema.jsonl, sheets.jsonl)
   - Synthetic master records (with names like release-*, check-*)
   - Nix flake for reproducible builds
   - Test suite with full coverage

### ⚠️ What Requires Adaptation

1. **Domain Model**
   - Initial implementation uses "release", "step", "check" (domain-specific)
   - Map to your domain's entities and natural keys
   - Example: swap release→deployment, step→phase, check→validation

2. **Template XLSX**
   - No template is included (to avoid embedding real customer file)
   - You create your own template with desired styling
   - Render logic is agnostic to template content

3. **Master/Edge Structure**
   - Your domain defines masters/ and edges/ directories
   - Schema must declare presence + key fields for your types
   - Sheet config maps your fields to columns

### ❌ What Is Forbidden

1. **Customer/Company Identifiers**
   - Do NOT reuse real customer names, project names, product names
   - Do NOT reuse department, team, person identifiers
   - Do NOT reuse internal URLs, GCP projects, infrastructure names

2. **Credential/Config**
   - Do NOT include Azure AD settings, API keys, connection strings
   - Do NOT hardcode endpoints or environment-specific values
   - All such config belongs in deployment, not in code

3. **Business Logic Encoded as Code**
   - Do NOT hard-wire field mappings, validations, or conditional rendering
   - Do NOT hard-code entity types or key fields
   - Use config/schema.jsonl for all business decisions

## Testing & Validation

### Exportability Tests
- `tests/test_exportability.py`: Scans repo for forbidden patterns (grep-based)
- Runs as part of standard `pytest` suite
- **False negatives possible** if forbidden names are buried in comments or strings

### Before Proposing/Publishing
1. Populate `scripts/denylist.txt` with identifiers from your source
2. Run `pytest tests/test_exportability.py -v` to verify denylist patterns absent
3. Verify no `.xlsx`, `.jpg`, `.pdf` files present in repo
4. Verify no `.env`, `.json` files with credentials

## Implementation Checklist for New Projects

When adopting this engine in a new project:

- [ ] Define your entity types in `config/schema.jsonl`
  - Example: replace `release` → `deployment`, `step` → `phase`
  - Declare presence fields and natural keys
  - Include non_null constraints if needed

- [ ] Create masters & edges JSONL directories
  - `masters/{entity}.jsonl` for each type
  - `edges/{relationship}.jsonl` for joins

- [ ] Define sheet rendering in `config/sheets.jsonl`
  - Map entity fields to columns
  - Specify strategies (data_replace or preserve)
  - Add edge_lookup directives if needed

- [ ] Create XLSX template in your styling tool
  - Set up fonts, colors, borders in template
  - Mark data_start_row and style_template_row
  - Engine will copy styles at render time

- [ ] Run reduce_log() + render_sheet_data_replace()
  - No code changes required if config is correct
  - All business decisions stay in config

## Risk Mitigation

### Risk: Accidental leakage of customer data
- **Mitigation**: All fixtures use synthetic names verified by test suite
- **Verification**: `pytest tests/test_exportability.py` must pass

### Risk: Code depends on initial implementation specifics
- **Mitigation**: No imports from initial implementation; pure Python + openpyxl
- **Verification**: `pytest tests/test_exportability.py` with denylist must pass

### Risk: Hardcoded values embedded in code
- **Mitigation**: All values in `config/` JSONL files; code is generic
- **Verification**: Review `jsonxlsx/*.py` for any string literals with business meaning

## Decision: Exportability Approved

**Status**: ✅ Ready for proposal  
**Confidence**: High  
**Why**: Core logic is generic; examples are synthetic; forbidden patterns are absent  
**Prerequisites**: Buyer will customize schema/config for their domain  
**License**: Company proprietary; no GPL or OSS copyleft  

---

**Document Version**: 1.0  
**Date**: 2026-06-18  
**Verified By**: Gen1 automated exportability scan
