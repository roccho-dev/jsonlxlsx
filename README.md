# jsonxlsx: Proposal Container

This repository is a **proposal container** for a portable JSONL-to-XLSX rendering engine.

## Status

- **Branch**: `main` (proposal container seed)
- **Portable Engine**: `proposal/jsonxlsx-portable-engine-260618`
- **Main Content**: Not accepted; this is a proposal for review

## What This Is

This repo holds the SSOT (Single Source of Truth) for a design proposal and reference implementation of a portable JSONL-to-XLSX engine. The design is documented in `/docs/` and the implementation lives on the proposal branch.

## Using the Proposal

1. **Review the Design**:
   - `docs/DESIGN.md` — Design rationale and patterns
   - `docs/EXPORTABILITY.md` — Portability assessment

2. **See the Implementation**:
   - Checkout `proposal/jsonxlsx-portable-engine-260618`
   - Core engine: `jsonxlsx/` (300 LOC)
   - Tests: `tests/` (180 LOC)
   - Examples: `examples/minimal/`

3. **Adopt in Your Project**:
   - Clone from this SSOT
   - Customize `config/schema.jsonl` for your domain entities
   - Map your fields to XLSX columns in `config/sheets.jsonl`
   - Run `python -m jsonxlsx.engine` with your masters/edges/config

## Key Features

- **Append-only JSONL reduce** with latest-wins and tombstone deletion
- **Schema-driven natural key dispatch** (config, not code)
- **Template-based XLSX rendering** with style inheritance
- **Edge lookups** for relational joins
- **Target axis matrices** for N×M assignment grids

## Decision: Proposal Status

This is a **proposal**, not accepted code. Intended audiences:

- **Architects**: Review design decisions in `docs/DESIGN.md`
- **Potential adopters**: See `docs/EXPORTABILITY.md` for what you can take
- **Implementers**: Reference implementation on `proposal/jsonxlsx-portable-engine-260618`

---

**SSOT Location**: `ssh://100.124.250.91/home/nixos/repos/jsonxlsx.git`  
**Proposal Date**: 2026-06-18  
**Generation**: Gen1 (Claude Code)
