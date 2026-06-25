# Complete separation design

## Decision

JSONL is separated by responsibility.

```text
design.jsonl   workbook, sheets, styles, columns, rows, merges, validations, tables, hyperlinks
values.jsonl   cell values, formulas, cached values, value clears
assets.jsonl   optional drawings, media parts, drawing relationships
manifest.jsonl layer composition metadata
```

`design + values` must be enough to rebuild the sheet body. `assets` is optional and only overlays drawings/media.

Whole-workbook package mode is removed. Canonical JSONL must stay editable: cell values, styles, formulas, workbook/sheet layout, and validation rules are represented as semantic events, not as base64 ZIP part wrappers.

## Why

Mixed semantic JSONL is useful for authoring, but it makes template changes and data changes hard to audit. Separated JSONL makes the common operations cheap and safe:

```text
change values only   -> edit values.jsonl
change template only -> edit design.jsonl
change figures only  -> edit assets.jsonl
```

## Asset boundary

The only retained part-granularity boundary is asset-level media/drawing data:

```text
asset.drawing.element  one drawing anchor on a sheet
asset.drawing.rels     relationships for that drawing part
asset.media.part       image/media bytes only under direct xl/media/* paths
asset.drawing.raw      fallback for an unparsable drawing part; still confined to asset layer
```

A sheet body is restored from design and values. Drawing restoration is optional. Raw OOXML part injection and whole-workbook base64 wrapping are rejected.

## Merge gates

```text
npm run shiftleft
node tools/proof-separated.mjs
```

The gates reject design/value/asset contamination before XLSX rendering and explicitly reject package-mode options and package events.
