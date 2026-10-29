import {
  defaultConfig,
  type ShoeboxConfig,
} from '../../packages/cli/src/config/schema.ts';

// Sample configs the e2e harness generates, installs and lints. Together they
// cover every wizard option at least once.
export const presets: Readonly<Record<string, ShoeboxConfig>> = {
  minimal: {
    ...defaultConfig('sample-minimal'),
    packages: [{ name: 'core', kind: 'library' }],
    secrets: 'none',
    ci: 'none',
  },
  web: {
    ...defaultConfig('sample-web'),
    apps: [
      { name: 'web', kind: 'tanstack-start' },
      { name: 'api', kind: 'effect-api' },
    ],
    packages: [{ name: 'core', kind: 'library' }],
    secrets: 'varlock',
    infra: { kind: 'alchemy', providers: ['cloudflare'] },
  },
  full: {
    ...defaultConfig('sample-full'),
    apps: [
      { name: 'web', kind: 'tanstack-start' },
      { name: 'site', kind: 'foldkit' },
      { name: 'mobile', kind: 'expo' },
      { name: 'api', kind: 'effect-api' },
      { name: 'cli', kind: 'effect-cli' },
    ],
    packages: [{ name: 'core', kind: 'library' }],
    taskRunner: 'nx',
    secrets: 'secretspec',
    infra: { kind: 'alchemy', providers: ['cloudflare', 'aws'] },
    features: { changesets: true, agents: true, vscode: true },
  },
};
