import { catalogCheck } from './catalog.ts';
import { effectVersionsCheck } from './effect-versions.ts';
import { lintIgnoresCheck } from './lint-ignores.ts';
import { packageBoundariesCheck } from './package-boundaries.ts';
import { patchesCheck } from './patches.ts';
import type { RepoCheck } from './types.ts';

export const repoChecks: ReadonlyArray<RepoCheck> = [
  catalogCheck,
  effectVersionsCheck,
  patchesCheck,
  packageBoundariesCheck,
  lintIgnoresCheck,
];
