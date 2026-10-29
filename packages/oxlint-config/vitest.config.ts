import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'oxlint-config',
    root: import.meta.dirname,
    include: ['./test/**/*.test.ts'],
    environment: 'node',
    // Each case starts oxlint with type-aware linting.
    testTimeout: 60_000,
  },
});
