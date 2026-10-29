import { Array as Arr } from 'effect';

import type {
  AlchemyProvider,
  DeployTarget,
  ShoemakerConfig,
} from '../../config/schema.ts';

// Package order, so generated imports are already sorted.
export const PROVIDERS: ReadonlyArray<AlchemyProvider> = [
  'aws',
  'cloudflare',
  'github',
];

// Where the apps deploy: `none` without alchemy, or when the Stack holds only
// resources added by hand.
export const deployTarget = (config: ShoemakerConfig): DeployTarget =>
  config.infra.kind === 'alchemy' ? config.infra.deploy : 'none';

// Providers the Stack registers: the deploy target's plus any listed.
export const alchemyProviders = (config: ShoemakerConfig) => {
  if (config.infra.kind !== 'alchemy') return [];
  const { deploy, providers = [] } = config.infra;
  return Arr.filter(
    PROVIDERS,
    (provider) => provider === deploy || providers.includes(provider),
  );
};
