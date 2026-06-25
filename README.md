# @jsonlxlsx/engine hucre backend proposal

This proposal replaces the current ExcelJS writer with a hucre-backed writer while keeping the package contract focused on append-only JSONL input.

The package contains only portable engine code, synthetic examples, and verification fixtures. Adopter data, workbook templates, auth material, environment paths, and business-specific rules stay outside this repository.

## Contract

- Input is append-only JSONL.
- Output is XLSX.
- Supported runtimes are Node, browser, and CLI adapters over the same core.
- The core has no environment dependency.
- hucre is the only XLSX writer backend dependency.
- JSONL can be semantic single-stream or separated into design, values, and assets layers.

## CLI

```bash
jsonlxlsx compile input.jsonl output.xlsx --mode semantic
jsonlxlsx extract input.xlsx output.jsonl --mode semantic
jsonlxlsx split-layers input.semantic.jsonl output_dir
jsonlxlsx compile-layers design.jsonl values.jsonl output.xlsx --assets assets.jsonl
jsonlxlsx validate input.xlsx
```

## Verification

```bash
npm run shiftleft
npm run check:exportability
```

`shiftleft` runs syntax checks, architecture checks, Node tests, semantic proof, and separated-layer proof.

`check:exportability` rejects known non-portable names, environment paths, and auth-like assignments before this branch is proposed.
