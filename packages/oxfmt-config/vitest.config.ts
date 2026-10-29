import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'oxfmt-config',
    root: import.meta.dirname,
    include: ['./test/**/*.test.ts'],
    environment: 'node',
  },
});
