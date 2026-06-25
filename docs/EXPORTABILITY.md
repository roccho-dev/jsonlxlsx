# exportability boundary

This repository is portable implementation code, not adopter data.

Allowed:

- Generic JSONL reduce and render code.
- Synthetic examples.
- Public package metadata.
- Small test fixtures that prove generic XLSX behavior.

Not allowed:

- Customer, project, or company names.
- Real workbook templates or exports.
- Auth material, service endpoints, cloud IDs, and environment paths.
- App-specific schema, master data, edge data, or business rules.

The exportability check scans committed text-like files against `scripts/denylist.txt`.
