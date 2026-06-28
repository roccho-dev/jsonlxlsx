# hucre backend proposal

## Purpose

This branch proposes hucre as the XLSX writer backend for `@jsonlxlsx/engine`.

The package boundary is the compiler and extractor. It does not contain adopter-owned JSONL, real templates, account identifiers, service endpoints, auth material, or business rules.

## What is included

- Core JSONL workbook reducer and compiler.
- Node, browser, and CLI adapters.
- Semantic extraction and round-trip support.
- Design / values / assets separation utilities.
- Synthetic example JSONL.
- Small extraction fixtures used to prove phonetic text is not leaked.
- Vendored hucre tarball for reproducible local verification.

## What is excluded

- Real customer, project, or company identifiers.
- Real XLSX templates.
- Adopter workbook payloads.
- Auth material, service endpoints, cloud project IDs, and local absolute paths.
- App-specific rules that should remain in adopter-owned JSONL or templates.

## Acceptance checks

```bash
npm run shiftleft
npm run check:exportability
node src/adapters/cli/node.mjs compile examples/demo_design.jsonl ./jsonlxlsx-demo.xlsx --mode semantic
node src/adapters/cli/node.mjs validate ./jsonlxlsx-demo.xlsx
```
