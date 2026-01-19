import { defineConfig } from 'tsdown';

export default defineConfig({
  dts: true,
  entry: ['src/index.ts', 'src/cli.ts'],
  sourcemap: true,
  exports: true,
  external: [
    'effect',
    '@effect/opentelemetry',
    '@effect/cli',
    '@effect/platform',
    '@effect/platform-node',
    '@opentelemetry/api',
    '@opentelemetry/sdk-trace-base',
  ],
});
