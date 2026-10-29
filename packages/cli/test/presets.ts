import { defaultConfig, type ShoemakerConfig } from '../src/config/schema.ts';

// Sample configs e2e.test.ts generates, installs and checks. Together they
// cover every wizard option at least once.
export const presets: Readonly<Record<string, ShoemakerConfig>> = {
  minimal: {
    ...defaultConfig('sample-minimal'),
    packages: [{ name: 'core', kind: 'library' }],
    secrets: 'none',
    // A Stack with no cloud: resources added by hand, state in .alchemy/.
    infra: { kind: 'alchemy', deploy: 'none', state: 'local' },
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
    infra: { kind: 'alchemy', deploy: 'cloudflare', state: 'cloudflare' },
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
    infra: { kind: 'alchemy', deploy: 'aws', state: 'aws' },
    features: { changesets: true, agents: true, vscode: true },
  },
};
