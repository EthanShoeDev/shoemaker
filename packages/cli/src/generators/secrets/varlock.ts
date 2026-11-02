import { Array as Arr } from 'effect';

import type { Renderer } from '../../engine/types.ts';
import { managed, region } from '../shared.ts';
import { allEnvVars } from './env-vars.ts';
import type { EnvVar } from './model.ts';

// App code reads env through `ENV` from varlock/env (client and server).
// https://varlock.dev/integrations/javascript/
// https://varlock.dev/env-spec/reference/
//
// env-spec attaches every comment line directly above an item to it, and a
// line counts as decorators only when it starts with `@`. Region markers are
// kept apart from items by blank lines so they never become descriptions.
//
// Root decorators come from every comment block before the first item
// (varlock#406), so the project-owned lines between the header region and the
// `# ---` divider are read as header too. That is where a repo adds its
// plugins (`@plugin`, `@initInfisical`, ...); shoemaker has no plugin option
// because their arguments (a self-hosted site URL, say) can be private.

const decorators = (v: EnvVar) =>
  Arr.join(
    [
      v.required ? '@required' : '@optional',
      ...(v.sensitive ? ['@sensitive'] : []),
      ...(v.type === undefined ? [] : [`@type=${v.type}`]),
      ...(v.tags === undefined || v.tags.length === 0
        ? []
        : [`@tag(${Arr.join(v.tags, ', ')})`]),
    ],
    ' ',
  );

const item = (v: EnvVar) => {
  const value = v.sensitive || v.default === undefined ? '' : v.default;
  return `# ${v.description}\n# ${decorators(v)}\n${v.key}=${value}`;
};

export const envSchema = (name: string, vars: ReadonlyArray<EnvVar>) => {
  const header = region(
    'header',
    `# Environment schema (env-spec) for ${name}. Declares every variable the
# repo reads; values live in .env.local (gitignored) or a varlock plugin, never
# here. App code reads them through \`ENV\` from varlock/env, never process.env.
# Docs: https://varlock.dev/env-spec/overview/
#
# @defaultSensitive=false @defaultRequired=infer @currentEnv=$APP_ENV`,
    '#',
  );
  const projectHeader = `# Project root decorators (plugins) go here; shoemaker never touches them.
# ---`;
  const items = region(
    'vars',
    `\n${Arr.join(Arr.map(vars, item), '\n\n')}\n\n`,
    '#',
  );
  return `${header}\n${projectHeader}\n\n${items}\n\n# Project-only variables go below; shoemaker never touches them.\n`;
};

export const varlockRenderer: Renderer = (ctx, aggregate) =>
  ctx.config.secrets === 'varlock'
    ? [
        managed(
          '.env.schema',
          envSchema(ctx.config.name, allEnvVars(aggregate)),
        ),
      ]
    : [];
