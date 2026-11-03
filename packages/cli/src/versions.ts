import { Record as Rec } from 'effect';

import { cliVersion } from './engine/meta.ts';

// Every dependency version a generated repo can receive. Generators ask for a
// name through `GenContext.version`, which throws on a name missing here, so
// nothing is ever emitted as `latest`. Families move together: bump a family
// as one edit. `bun run update:generated-versions` moves every pin here to
// npm's latest.

const effect = '4.1.2';
const oxlint = '1.90.0';
const alchemy = '2.0.0-beta.85';
const tanstackRouter = '^1.170.46';
const expoSdk = '~58.0.23';
// Changesets releases the shoemaker packages as one fixed group, so the CLI's
// own version is theirs. On 0.x a caret only admits patches, so a literal here
// fell behind the first minor release.
const shoemaker = `^${cliVersion}`;

// The packages this repo publishes as one changesets `fixed` group.
export const shoemakerFamily = [
  'shoemaker',
  'shoemaker-oxlint-config',
  'shoemaker-oxlint-plugins',
  'shoemaker-oxfmt-config',
  'shoemaker-typescript-config',
  'shoemaker-knip-config',
] as const;

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
  // @effect/tsgo 0.64 supports oxlint 1.88-1.90, tsgolint 7.0.2004-2005, TS 7.0.2.
  '@effect/tsgo': '0.64.1',
  '@effect/language-service': '^0.87.5',

  // Lint / format family: oxlint, its plugin API and tsgolint move together.
  oxlint,
  '@oxlint/plugins': oxlint,
  'oxlint-tsgolint': '7.0.2005',
  oxfmt: '0.76.0',
  knip: '^6.44.1',
  jscpd: '^5.4.2',
  '@tanstack/eslint-plugin-query': '^5.105.3',
  'eslint-plugin-playwright': '^2.12.2',
  'eslint-plugin-testing-library': '^7.16.2',

  // Toolchain
  typescript: '^7.0.2',
  turbo: '^2.11.10',
  nx: '^24.0.3',
  tsdown: '^0.23.5',
  vitest: '^5.1.0',
  'happy-dom': '^21.0.4',
  '@types/node': '^26.6.6',
  'bun-types': '^1.4.4',
  '@changesets/cli': '^3.0.3',
  '@changesets/changelog-github': '^1.0.1',

  // Secrets
  varlock: '^1.24.0',
  '@varlock/vite-integration': '^1.5.5',
  '@varlock/expo-integration': '^1.2.2',
  '@varlock/cloudflare-integration': '^1.6.3',
  '@varlock/effect-plugin': '^0.1.0',

  // Infra (alchemy is Effect-native; pin exact while in beta)
  alchemy,
  '@alchemy.run/cloudflare': alchemy,
  '@alchemy.run/aws': alchemy,
  '@alchemy.run/github': alchemy,
  '@alchemy.run/frontend-frameworks': alchemy,

  // React / web
  react: '^19.3.1',
  'react-dom': '^19.3.1',
  '@types/react': '^19.3.0',
  '@types/react-dom': '^19.3.0',
  vite: '^8.3.5',
  '@vitejs/plugin-react': '^6.2.1',
  '@rolldown/plugin-babel': '^0.3.0',
  'babel-plugin-react-compiler': '^1.0.0',
  // Babel 7 while the repo can hold an Expo app: bun's hoisted linker puts
  // the web app's @babel/core at the root, where Metro loads it and Expo's
  // Babel 7 presets refuse 8. @rolldown/plugin-babel takes either.
  '@babel/core': '^7.29.0',
  tailwindcss: '^4.3.4',
  '@tailwindcss/vite': '^4.3.4',
  '@tanstack/react-start': '^1.169.4',
  '@tanstack/react-router': tanstackRouter,
  '@tanstack/router-plugin': '^1.168.48',
  '@tanstack/react-query': '^5.105.3',
  '@tanstack/react-router-ssr-query': '^1.167.3',
  // Pre-1.0: pin minor.
  'raf-effect-atom': '~0.3.3',

  // foldkit (pre-1.0: pin minor)
  foldkit: '~0.170.0',
  '@foldkit/vite-plugin': '~0.29.0',
  '@foldkit/devtools': '~0.170.0',

  // Expo family: let `expo install --fix` own the exact RN-side versions.
  expo: expoSdk,
  'expo-router': '~58.0.30',
  'expo-status-bar': '~58.0.4',
  'expo-system-ui': '~58.0.7',
  'expo-constants': '~58.0.15',
  'expo-linking': '~58.0.16',
  'react-native-safe-area-context': '~5.11.1',
  'react-native-screens': '~4.30.1',
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

// The nixpkgs revision a new repo's flake.lock starts on, so its first
// `nix fmt` or `nix develop` doesn't write one (an uncommitted file right
// after init). `bun run update:nix-flake` moves a repo past it.
export const nixpkgsLock = {
  rev: '58deea654ec5dd0644f31c840a07c29fa0592528',
  narHash: 'sha256-lNZLwWf5tYNKjothaoFq/VZYvzaclmLafjgMdUlpJPQ=',
  lastModified: 1793195608,
} as const;

// The Android toolchain nix/android.nix composes for Expo apps, matching what
// the Expo SDK's React Native builds with
// (react-native/gradle/libs.versions.toml: compileSdk, buildTools,
// ndkVersion). Bump it with `expo`.
export const androidToolchain = {
  // android-nixpkgs attribute; installs platforms/android-37.0.
  platform: 'platforms-android-37-0',
  buildTools: '37.0.0',
  // AGP's default, for library modules that set no buildToolsVersion
  // (react-native-gesture-handler). Bump it with AGP.
  agpBuildTools: '36.0.0',
  ndk: '27.1.12297006',
  cmake: '3.22.1',
} as const;

// android-nixpkgs (and its own inputs) as `nix flake lock` pins them next to
// nixpkgsLock, so a new repo with an Expo app is locked before any nix
// command runs.
export const androidLockNodes = {
  'android-nixpkgs': {
    inputs: {
      devshell: 'devshell',
      'flake-utils': 'flake-utils',
      nixpkgs: ['nixpkgs'],
    },
    locked: {
      lastModified: 1793575374,
      narHash: 'sha256-O54fgRT+pGzUtNOsz/JBM29NqiB5LZo1S93pLjuCXfY=',
      owner: 'tadfisher',
      repo: 'android-nixpkgs',
      rev: '37100dff199a34fcce56518facbc75321b379468',
      type: 'github',
    },
    original: {
      owner: 'tadfisher',
      repo: 'android-nixpkgs',
      type: 'github',
    },
  },
  devshell: {
    inputs: {
      nixpkgs: ['android-nixpkgs', 'nixpkgs'],
    },
    locked: {
      lastModified: 1791918082,
      narHash: 'sha256-oN9JrhRfHa7MUTdUq+11dHn7u0Z4WfEA4mhzBq0/zoQ=',
      owner: 'numtide',
      repo: 'devshell',
      rev: '9e29c63dde99a2d80c94b3d024c9768c01544558',
      type: 'github',
    },
    original: {
      owner: 'numtide',
      repo: 'devshell',
      type: 'github',
    },
  },
  'flake-utils': {
    inputs: {
      systems: 'systems',
    },
    locked: {
      lastModified: 1791914995,
      narHash: 'sha256-Zf/xfQEAasnwnmEfHqW/4hjDE/s44yn2hD4RuVIZRjA=',
      owner: 'numtide',
      repo: 'flake-utils',
      rev: 'b7a79d3fea1e214f6d668d521cecec0c01e26544',
      type: 'github',
    },
    original: {
      owner: 'numtide',
      repo: 'flake-utils',
      type: 'github',
    },
  },
  systems: {
    locked: {
      lastModified: 1681028828,
      narHash: 'sha256-Vy1rq5AaRuLzOxct8nz4T6wlgyUR7zLU309k9mBC768=',
      owner: 'nix-systems',
      repo: 'default',
      rev: 'da67096a3b9bf56a91d16901293e51ba5b49a27e',
      type: 'github',
    },
    original: {
      owner: 'nix-systems',
      repo: 'default',
      type: 'github',
    },
  },
} as const;
