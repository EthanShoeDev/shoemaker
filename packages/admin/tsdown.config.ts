import { defineConfig } from 'tsdown';

export default defineConfig({
  // One per subpath in package.json; design.md decision 7 says what each holds.
  entry: [
    'src/index.ts',
    'src/contract.ts',
    'src/access.ts',
    'src/server.ts',
    'src/better-auth.ts',
    'src/sql.ts',
    'src/alchemy.ts',
  ],
  dts: { sourcemap: true },
  sourcemap: true,
});
