import { defineConfig } from 'tsdown';

export default defineConfig({
  // One per subpath in package.json.
  entry: [
    'src/index.ts',
    'src/contract.ts',
    'src/server.ts',
    'src/sql.ts',
    'src/flags.ts',
    'src/openfeature.ts',
  ],
  dts: { sourcemap: true },
  sourcemap: true,
});
