---
'shoemaker': patch
---

Generated repos get newer dependency versions:

- `effect`: 4.1.5 → 4.1.7
- `expoSdk`: ~58.0.26 → ~58.1.0
- `@effect/tsgo`: 0.73.4 → 0.74.1
- `oxlint` and `@oxlint/plugins`: 1.94.0 → 1.95.0, which `@effect/tsgo` 0.74
  supports
- `oxlint-tsgolint`: 7.0.2008 → 7.0.2009
- `knip`: ^6.48.0 → ^6.49.0
- `nx`: ^24.0.6 → ^24.1.0
- `vitest`: ^5.1.1 → ^5.1.2
- `@types/node`: ^26.6.6 → ^26.6.11
- `@changesets/cli`: ^3.0.3 → ^3.1.0
- `@changesets/changelog-github`: ^1.0.1 → ^2.0.0
- `@types/react`: ^19.3.0 → ^19.3.3
- `vite`: ^8.3.8 → ^8.4.0
- `@rolldown/plugin-babel`: ^0.3.1 → ^0.3.2
- `expo-router`: ~58.0.32 → ~58.0.33

Existing repos: `bun run shoemaker:sync`, then `bun install`. A version the
repo already raised past these stays as it is.
