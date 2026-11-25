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
//
// The header's Infisical example is in backticks because a comment line that
// starts with `@` is a live decorator. Its `enabled` matters: with no site URL
// the plugin falls back to Infisical's cloud and sends the credential there.

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
# repo reads. App code reads them through \`ENV\` from varlock/env, never
# process.env. Docs: https://varlock.dev/env-spec/overview/
#
# Secret values live in a remote store that a varlock plugin reads, never here
# and never in .env.local or another local file, gitignored or not. A private
# repo uses the self-hosted Infisical: add @varlock/infisical-plugin to the root
# devDependencies, and these to the slot below, without the backticks:
#   \`@plugin(@varlock/infisical-plugin)\`
#   \`@initInfisical(projectId=<uuid>, siteUrl=$INFISICAL_DOMAIN,\`
#   \`  environment=remap($APP_ENV, development, dev, production, prod),\`
#   \`  clientId=$INFISICAL_CLIENT_ID, clientSecret=$INFISICAL_CLIENT_SECRET)\`
#   \`@setValuesBulk(infisicalBulk(), omit=[APP_ENV, INFISICAL_*],\`
#   \`  enabled=not(isEmpty($INFISICAL_DOMAIN)))\`
# then declare the three INFISICAL_ variables at the end of this file as
# \`@optional @sensitive @internal\`. Each machine and CI sets them in its
# environment. A public repo never contains the server's URL.
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
