/** Unit, integration, browser-mode and e2e test files. */
export const testFiles = [
  '**/test/**',
  '**/tests/**',
  '**/e2e/**',
  '**/perf/**',
  '**/__tests__/**',
  '**/*.{test,spec,bench}.*',
  '**/*.browser.*',
];

/** Playwright specs. */
export const e2eFiles = ['**/e2e/**', '**/*.e2e.*'];

/** Component tests that render through Testing Library. */
export const testingLibraryFiles = [
  '**/*.{test,spec}.{jsx,tsx}',
  '**/*.browser.{jsx,tsx}',
];

/**
 * Tool configs and plugins loaded by other tools: no Effect runtime to reach (vite plugins
 * hand Node streams to the dev server; oxlint plugin rules run synchronously
 * inside the plugin host) and the terminal is the output.
 */
export const toolingFiles = [
  '**/vite-plugins/**',
  '**/oxlint-plugins/**',
  '**/*.config.{ts,mts,js,mjs,cjs}',
];

/** Hand-written scaffolding around vendored upstream code. */
export const vendoredFiles = ['**/vendor/**'];

/** Ambient declaration files. */
export const declarationFiles = ['**/*.d.ts'];

/** TanStack Router file routes. */
export const routeFiles = ['**/routes/**'];

/** Ignored everywhere: build output, generated code and agent bundles. */
export const sharedIgnorePatterns = [
  // Build output and tool caches.
  '**/dist/**',
  '**/.output/**',
  '**/.nitro/**',
  '**/.turbo/**',
  '**/.alchemy/**',
  // Generated code: regenerated wholesale, so findings there are noise.
  '**/*.gen.*',
  '**/generated/**',
  '**/*.vendored.*',
  // Vendored SDK output and the specs it is generated from; the hand-written
  // scaffolding outside these directories is linted (see vendoredFiles).
  '**/vendor/**/generated/**',
  '**/vendor/**/specs/**',
  // Reference repos cloned for agents to read (gitignored).
  '.external/**',
  // Agent skill bundles are not project code.
  '.agents/**',
  '.claude/**',
  '.cursor/**',
  '.opencode/**',
  '.github/skills/**',
];

/** shadcn/ui components are vendored from the registry, not hand-written. */
export const reactIgnorePatterns = ['**/components/ui/**'];
