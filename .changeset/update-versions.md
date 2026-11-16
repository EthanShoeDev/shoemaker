---
'shoemaker': patch
---

Generated repos get newer dependency versions:

- `effect`: 4.1.2 → 4.1.4
- `alchemy`: 2.0.0-beta.85 → 2.0.0-beta.87
- `expoSdk`: ~58.0.23 → ~58.0.25
- `@effect/tsgo`: 0.64.1 → 0.69.0
- `oxlint-tsgolint`: 7.0.2005 → 7.0.2007
- `oxfmt`: 0.76.0 → 0.79.0
- `knip`: ^6.44.1 → ^6.45.1
- `jscpd`: ^5.4.2 → ^5.4.3
- `@tanstack/eslint-plugin-query`: ^5.105.3 → ^5.107.1
- `turbo`: ^2.11.10 → ^2.11.11
- `nx`: ^24.0.3 → ^24.0.6
- `tsdown`: ^0.23.5 → ^0.23.7
- `varlock`: ^1.24.0 → ^1.25.0
- `@varlock/vite-integration`: ^1.5.5 → ^1.5.6
- `@varlock/cloudflare-integration`: ^1.6.3 → ^1.6.4
- `vite`: ^8.3.5 → ^8.3.8
- `@vitejs/plugin-react`: ^6.2.1 → ^6.3.0
- `@rolldown/plugin-babel`: ^0.3.0 → ^0.3.1
- `tailwindcss`: ^4.3.4 → ^4.3.5
- `@tailwindcss/vite`: ^4.3.4 → ^4.3.5
- `@tanstack/react-start`: ^1.169.4 → ^1.169.5
- `@tanstack/router-plugin`: ^1.168.48 → ^1.169.0
- `@tanstack/react-query`: ^5.105.3 → ^5.107.1
- `expo-router`: ~58.0.30 → ~58.0.31
- `expo-status-bar`: ~58.0.4 → ~58.0.5
- `expo-constants`: ~58.0.15 → ~58.0.16
- `expo-linking`: ~58.0.16 → ~58.0.17
- `uniwind`: ^1.13.1 → ^1.13.2

Existing repos: `bun run shoemaker:sync`, then `bun install`. A version the
repo already raised past these stays as it is.
