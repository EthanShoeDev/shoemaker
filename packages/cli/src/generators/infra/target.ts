import type { DeployTarget, ShoemakerConfig } from '../../config/schema.ts';

// Where the apps deploy: `none` without alchemy, or when the Stack holds only
// resources added by hand.
export const deployTarget = (config: ShoemakerConfig): DeployTarget =>
  config.infra.kind === 'alchemy' ? config.infra.deploy : 'none';
