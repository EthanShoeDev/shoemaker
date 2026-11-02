---
'shoemaker': patch
---

Generated repos get newer dependency versions:

- `effect`: 4.1.0 → 4.1.1
- `expoSdk`: ~58.0.21 → ~58.0.22
- `knip`: ^6.43.0 → ^6.44.1
- `@tanstack/eslint-plugin-query`: ^5.105.0 → ^5.105.1
- `nx`: ^24.0.2 → ^24.0.3
- `tsdown`: ^0.23.3 → ^0.23.4
- `varlock`: ^1.23.0 → ^1.24.0
- `@varlock/vite-integration`: ^1.5.4 → ^1.5.5
- `@varlock/cloudflare-integration`: ^1.6.2 → ^1.6.3
- `@rolldown/plugin-babel`: ^0.2.4 → ^0.3.0
- `@babel/core`: ^7.29.0 → ^8.0.10
- `@tanstack/react-query`: ^5.105.0 → ^5.105.1
- `foldkit`: ~0.169.0 → ~0.170.0
- `@foldkit/vite-plugin`: ~0.28.0 → ~0.29.0
- `@foldkit/devtools`: ~0.169.0 → ~0.170.0
- `expo-router`: ~58.0.28 → ~58.0.29
- `react-native-screens`: ~4.30.0 → ~4.30.1

Existing repos: `bun run shoemaker:sync`, then `bun install`. A version the
repo already raised past these stays as it is.
