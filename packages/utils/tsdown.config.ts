import { defineConfig } from 'tsdown';

export default defineConfig({
  dts: true,
  entry: 'src/**/*.ts', // consumers import only what they need
  sourcemap: true,
  exports: true, // Auto generate pkg json exports. See https://tsdown.dev/options/package-exports
  external: ['effect', '@effect/platform'],
});
