import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'oxlint-plugins',
    root: import.meta.dirname,
    // The custom rule suites plus the vendored anti-slop RuleTester suites,
    // minus the one that shells out to `pnpm exec oxlint` (see
    // src/vendor/anti-slop/UPSTREAM.md).
    include: ['./test/**/*.test.ts', './src/vendor/anti-slop/**/*.test.ts'],
    exclude: ['**/require-readable-spacing-cli.test.ts'],
    // oxlint's RuleTester registers its cases through the global describe/it.
    globals: true,
    environment: 'node',
    testTimeout: 15_000,
  },
});
