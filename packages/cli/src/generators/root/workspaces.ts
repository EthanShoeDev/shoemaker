import { Array as Arr, pipe } from 'effect';

import type { ShoemakerConfig } from '../../config/schema.ts';
import type { GenContext } from '../../engine/types.ts';
import { contractName } from '../apps/mount.ts';

export interface Workspace {
  readonly dir: string;
  readonly name: string;
  readonly kind: ShoemakerConfig['apps'][number]['kind'] | 'library';
}

// Every workspace package shoemaker generates, in a stable order. Renderers that
// list packages (vitest projects, nx project.json stubs, knip) read this.
export const workspaces = (ctx: GenContext): ReadonlyArray<Workspace> => [
  ...Arr.map(ctx.config.apps, (app) => ({
    dir: `apps/${app.name}`,
    name: ctx.pkg(app.name),
    kind: app.kind,
  })),
  ...Arr.map(ctx.config.packages, (pkg) => ({
    dir: `packages/${pkg.name}`,
    name: ctx.pkg(pkg.name),
    kind: pkg.kind,
  })),
  // Each effect-api app's contract is a library package of its own.
  ...pipe(
    ctx.config.apps,
    Arr.filter((app) => app.kind === 'effect-api'),
    Arr.map((app) => ({
      dir: `packages/${contractName(app)}`,
      name: ctx.pkg(contractName(app)),
      kind: 'library' as const,
    })),
  ),
];
