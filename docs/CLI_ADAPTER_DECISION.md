# CLI Adapter Decision

The package is a library first.

## Decision

`cli` is an adapter, not core, not port contract, and not the default package entry.

```text
src/core/              pure environment-free workbook logic
src/ports/             pure port contracts only
src/adapters/node/     Node runtime adapter and file facade
src/adapters/browser/  Browser runtime adapter and byte facade
src/adapters/cli/      Node CLI adapter
```

## Package boundaries

```text
import core from package root:
  exports["."] -> src/core/index.mjs

use Node:
  exports["./adapters/node"] -> src/adapters/node/index.mjs

use Browser:
  exports["./adapters/browser"] -> src/adapters/browser/index.mjs

use CLI:
  bin jsonl-xlsx-js -> src/adapters/cli/node.mjs
```

## Guard

`npm run shiftleft` fails if:

- the forbidden C-token appears in JS source, tests, tools, or package metadata.
- core imports Node, Browser, CLI, or adapter code.
- port contracts import environment APIs.
- browser adapter imports Node APIs.
- CLI bin is outside `src/adapters/cli`.
- package root does not point to pure core.
- runtime or dev dependencies are added.
