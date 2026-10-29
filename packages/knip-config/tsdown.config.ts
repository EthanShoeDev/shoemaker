import { defineConfig } from 'tsdown';

export default defineConfig({
  dts: { sourcemap: true },
  entry: ['src/index.ts'],
  sourcemap: true,
});
