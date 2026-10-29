import { Array as Arr } from 'effect';

import type { Renderer } from '../../engine/types.ts';
import { managed, region } from '../shared.ts';
import { allEnvVars } from './env-vars.ts';
import type { EnvVar } from './model.ts';

// env-spec attaches every comment line directly above an item to it, and a
// line counts as decorators only when it starts with `@`. Region markers are
// kept apart from items by blank lines so they never become descriptions.

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
# @defaultSensitive=false @defaultRequired=infer @currentEnv=$APP_ENV
# ---`,
    '#',
  );
  const items = region(
    'vars',
    `\n${Arr.join(Arr.map(vars, item), '\n\n')}\n\n`,
    '#',
  );
  return `${header}\n\n${items}\n\n# Project-only variables go below; shoemaker never touches them.\n`;
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
