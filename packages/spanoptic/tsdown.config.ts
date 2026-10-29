import { defineConfig } from 'tsdown';

export default defineConfig({
  // cli.mjs keeps src/cli.ts's `#!/usr/bin/env bun` hashbang: @opentui/core
  // loads its native renderer through bun:ffi, so the bin needs bun.
  entry: ['src/index.ts', 'src/cli.ts'],
  dts: true,
  sourcemap: true,
});
