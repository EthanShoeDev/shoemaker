import { Array as Arr } from 'effect';

import type { ShoeboxConfig } from '../../config/schema.ts';
import type { Aggregate, GenContext } from '../../engine/types.ts';

// The generated `@scope/env` package exists whenever something reads env:
// any app, or any generator that contributed an EnvVar.
export const hasEnvPackage = (config: ShoeboxConfig, aggregate: Aggregate) =>
  config.apps.length > 0 || aggregate.env.length > 0;

export interface Workspace {
  readonly dir: string;
  readonly name: string;
  readonly kind:
    | ShoeboxConfig['apps'][number]['kind']
    | 'library'
    | 'env'
    | 'infra';
}

// Every workspace package shoebox generates, in a stable order. Renderers that
// list packages (vitest projects, nx project.json stubs, knip) read this.
export const workspaces = (
  ctx: GenContext,
  aggregate: Aggregate,
): ReadonlyArray<Workspace> => [
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
  ...(ctx.config.infra.kind === 'alchemy'
    ? [
        {
          dir: 'packages/infra',
          name: ctx.pkg('infra'),
          kind: 'infra' as const,
        },
      ]
    : []),
  ...(hasEnvPackage(ctx.config, aggregate)
    ? [{ dir: 'packages/env', name: ctx.pkg('env'), kind: 'env' as const }]
    : []),
];
