---
'shoemaker': patch
---

Generated repos get newer dependency versions:

- `alchemy`: 2.0.0-beta.84 → 2.0.0-beta.85
- `tailwindcss`: ^4.3.3 → ^4.3.4
- `@tailwindcss/vite`: ^4.3.3 → ^4.3.4

Existing repos: `bun run shoemaker:sync`, then `bun install`. A version the
repo already raised past these stays as it is.
