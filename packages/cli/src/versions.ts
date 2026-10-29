import { Record as Rec } from 'effect';

// Every dependency version a generated repo can receive. Generators ask for a
// name through `GenContext.version`, which throws on a name missing here, so
// nothing is ever emitted as `latest`. Families move together: bump a family
// as one edit.

const effect = '4.1.0';
const oxlint = '1.90.0';
const alchemy = '2.0.0-beta.84';
const tanstackRouter = '^1.170.46';
const expoSdk = '~58.0.21';
const shoemaker = '^0.1.0';

// Every runtime package Effect-TS/effect-smol publishes in lockstep with
// `effect` (all exist at 4.1.0). Dependencies such as alchemy pull these with
// caret ranges that drift past the exact effect pin, so the root package.json
// overrides every one of them to `effect`'s version.
export const effectFamily = [
  'effect',
  '@effect/ai-anthropic',
  '@effect/ai-cloudflare',
  '@effect/ai-openai',
  '@effect/ai-openai-compat',
  '@effect/ai-openrouter',
  '@effect/ai-typesafe',
  '@effect/atom-react',
  '@effect/atom-solid',
  '@effect/atom-vue',
  '@effect/opentelemetry',
  '@effect/platform-browser',
  '@effect/platform-bun',
  '@effect/platform-deno',
  '@effect/platform-node',
  '@effect/platform-node-shared',
  '@effect/sql-clickhouse',
  '@effect/sql-d1',
  '@effect/sql-libsql',
  '@effect/sql-mssql',
  '@effect/sql-mysql2',
  '@effect/sql-pg',
  '@effect/sql-pglite',
  '@effect/sql-sqlite-bun',
  '@effect/sql-sqlite-do',
  '@effect/sql-sqlite-node',
  '@effect/sql-sqlite-react-native',
  '@effect/sql-sqlite-wasm',
  '@effect/vitest',
] as const;

export const versions = {
  // shoemaker itself
  shoemaker,
  'shoemaker-oxlint-config': shoemaker,
  'shoemaker-oxlint-plugins': shoemaker,
  'shoemaker-oxfmt-config': shoemaker,
  'shoemaker-typescript-config': shoemaker,
  'shoemaker-knip-config': shoemaker,

  // Effect family: exact pins, all on the same version
  // (effect-versions check enforces it in bun.lock).
  effect,
  '@effect/platform-bun': effect,
  '@effect/platform-node': effect,
  '@effect/platform-browser': effect,
  '@effect/vitest': effect,
  '@effect/opentelemetry': effect,
  '@effect/atom-react': effect,
  '@effect/sql-pg': effect,
  // @effect/tsgo 0.63 supports oxlint 1.88-1.90, tsgolint 7.0.2004-2005, TS 7.0.2.
  '@effect/tsgo': '0.63.0',
  '@effect/language-service': '^0.87.5',

  // Lint / format family: oxlint, its plugin API and tsgolint move together.
  oxlint,
  '@oxlint/plugins': oxlint,
  'oxlint-tsgolint': '7.0.2005',
  oxfmt: '0.75.0',
  knip: '^6.43.0',
  jscpd: '^5.4.2',
  '@tanstack/eslint-plugin-query': '^5.105.0',
  'eslint-plugin-playwright': '^2.12.1',
  'eslint-plugin-testing-library': '^7.16.2',

  // Toolchain
  typescript: '^7.0.2',
  turbo: '^2.11.10',
  nx: '^24.0.2',
  tsdown: '^0.23.3',
  vitest: '^5.0.5',
  '@vitest/browser-playwright': '^5.0.5',
  playwright: '^1.64.1',
  'happy-dom': '^21.0.4',
  '@types/node': '^26.6.6',
  'bun-types': '^1.4.4',
  '@changesets/cli': '^3.0.3',
  '@changesets/changelog-github': '^1.0.1',

  // Secrets
  varlock: '^1.23.0',
  '@varlock/vite-integration': '^1.5.4',
  '@varlock/expo-integration': '^1.2.2',
  '@varlock/cloudflare-integration': '^1.6.2',
  '@varlock/effect-plugin': '^0.1.0',

  // Infra (alchemy is Effect-native; pin exact while in beta)
  alchemy,
  '@alchemy.run/cloudflare': alchemy,
  '@alchemy.run/aws': alchemy,
  '@alchemy.run/frontend-frameworks': alchemy,

  // React / web
  react: '^19.3.1',
  'react-dom': '^19.3.1',
  '@types/react': '^19.3.0',
  '@types/react-dom': '^19.3.0',
  vite: '^8.3.5',
  '@vitejs/plugin-react': '^6.1.2',
  '@rolldown/plugin-babel': '^0.2.4',
  'babel-plugin-react-compiler': '^1.0.0',
  '@babel/core': '^7.29.0',
  tailwindcss: '^4.3.3',
  '@tailwindcss/vite': '^4.3.3',
  '@tanstack/react-start': '^1.169.4',
  '@tanstack/react-router': tanstackRouter,
  '@tanstack/router-plugin': '^1.168.48',
  '@tanstack/react-query': '^5.105.0',
  '@tanstack/react-router-ssr-query': '^1.167.3',

  // foldkit (pre-1.0: pin minor)
  foldkit: '~0.169.0',
  '@foldkit/vite-plugin': '~0.28.0',
  '@foldkit/devtools': '~0.169.0',

  // Expo family: let `expo install --fix` own the exact RN-side versions.
  expo: expoSdk,
  'expo-router': '~58.0.28',
  'expo-status-bar': '~58.0.4',
  'expo-system-ui': '~58.0.7',
  'expo-constants': '~58.0.14',
  'expo-linking': '~58.0.15',
  'react-native-safe-area-context': '~5.10.1',
  'react-native-screens': '~4.30.0',
  'react-native': '0.88.1',
  uniwind: '^1.13.1',
} as const;

export type Dependency = keyof typeof versions;

const pinned: Readonly<Record<string, string>> = versions;

export const isDependency = (name: string): name is Dependency =>
  Rec.has(pinned, name);

export const versionOf = (name: string): string => {
  if (!isDependency(name)) {
    throw new Error(
      `No pinned version for "${name}". Add it to packages/cli/src/versions.ts.`,
    );
  }
  return versions[name];
};
