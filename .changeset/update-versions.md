---
'shoemaker': patch
---

Generated repos get newer dependency versions:

- `oxfmt`: 0.75.0 → 0.76.0
- `tsdown`: ^0.23.4 → ^0.23.5
- `tailwindcss`, `@tailwindcss/vite`: ^4.3.3 → ^4.3.4
- `expo`: ~58.0.22 → ~58.0.23, with the native module ranges SDK 58.0.23
  pins (`expo-router` ~58.0.30, `expo-constants` ~58.0.15, `expo-linking`
  ~58.0.16, `react-native-safe-area-context` ~5.11.1)

`oxlint` and `@oxlint/plugins` stay at 1.90.0: `@effect/tsgo` 0.64.1 supports
oxlint up to 1.90.0, and `effect-tsgo patch --oxlint` (the `prepare` script)
fails `bun install` on 1.91.0. The weekly version update now holds oxlint
until `@effect/tsgo` lists a newer one.

`flake.nix` escapes `${` in the repo description, which Nix would otherwise
read as an interpolation, and `secretspec.toml` escapes every control
character TOML requires (DEL was left raw).

Existing repos: `bun run shoemaker:sync`, then `bun install`. A version the
repo already raised past these stays as it is.
