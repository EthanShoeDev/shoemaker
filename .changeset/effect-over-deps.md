---
'shoemaker': patch
---

`jsonc-parser` is gone: Effect's `Json5` parses JSONC, and `check --fix`
edits package.json through the merge `sync` uses. A fixed package.json keeps
its key order, indent and line endings, but comes out in `JSON.stringify`
layout, without any comments it had.

`--force` globs use Effect's `Glob`, so `{a,b}` and `[...]` now work; a path
with literal brackets needs them escaped (`app/\[id].tsx`). Version comparisons
use `SemVer`, which orders prereleases.

`doctor` parses `openspec/config.yaml` instead of matching it line by line.
