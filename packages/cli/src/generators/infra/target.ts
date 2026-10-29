import type { DeployTarget, ShoeboxConfig } from '../../config/schema.ts';

// Where the apps deploy: `none` without alchemy, or when the Stack holds only
// resources added by hand.
export const deployTarget = (config: ShoeboxConfig): DeployTarget =>
  config.infra.kind === 'alchemy' ? config.infra.deploy : 'none';
