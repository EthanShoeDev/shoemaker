import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'cli',
    include: ['test/**/*.test.ts'],
    // The integration tests run oxfmt and write temp repos.
    testTimeout: 30_000,
  },
});
