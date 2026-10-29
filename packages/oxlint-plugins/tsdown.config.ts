import { defineConfig } from 'tsdown';

export default defineConfig({
  dts: true,
  entry: [
    'src/*.ts',
    // The vendored anti-slop plugin: only its two entry points are bundled,
    // never its internals or RuleTester suites.
    'src/vendor/anti-slop/index.ts',
    'src/vendor/anti-slop/effect/index.ts',
  ],
  sourcemap: true,
  // @oxlint/plugins must match the consumer's oxlint version exactly, so it
  // stays a runtime dependency instead of being inlined at build time.
  deps: { neverBundle: ['eslint', '@oxlint/plugins'] },
});
