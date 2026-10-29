import { defineConfig } from 'tsdown';

export default defineConfig({
  // bin.mjs keeps src/bin.ts's `#!/usr/bin/env bun` hashbang: the published
  // bin runs under bun (Bun.Glob, importing shoemaker.config.ts).
  entry: {
    bin: 'src/bin.ts',
    'config/index': 'src/config/index.ts',
  },
  // Declarations for src only: the default tsconfig also covers test/, which
  // imports repo fixtures and would emit .d.ts files beside them.
  tsconfig: 'tsconfig.build.json',
  dts: { sourcemap: true },
  sourcemap: true,
});
