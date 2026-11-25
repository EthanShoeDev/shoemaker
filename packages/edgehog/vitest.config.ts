import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'edgehog',
    root: import.meta.dirname,
    include: ['./test/**/*.test.ts'],
    environment: 'node',
  },
});
