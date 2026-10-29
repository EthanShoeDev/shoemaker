import { Array as Arr } from 'effect';

import type { ShoemakerConfig } from '../../config/schema.ts';
import type { GenContext } from '../../engine/types.ts';

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
];
