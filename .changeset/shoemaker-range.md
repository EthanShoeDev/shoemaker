---
'shoemaker': patch
---

Generated repos now get `^<this CLI's version>` for shoemaker and the
`shoemaker-*` config packages. It used to be a hard-coded `^0.1.0`, which on
0.x never matches 0.2.x, so synced repos installed 0.1.x tooling, and a repo
that raised the catalog by hand got a root `package.json` conflict on every
sync. A test now fails if the range stops admitting the released versions,
and a new `doctor` check, `shoemaker-versions`, reports any shoemaker-* range
that excludes the running CLI.

Existing repos (for a coding agent):

1. Run `bun run shoemaker:sync`. It writes `^<version>` for every
   shoemaker-* entry in the root catalog. A repo that held the catalog at
   `^0.2.x` by hand no longer sees the root `package.json` conflict.
2. `bun install`, then run the repo's checks.
