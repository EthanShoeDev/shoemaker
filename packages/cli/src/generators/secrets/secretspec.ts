import { Array as Arr } from 'effect';

import type { Renderer } from '../../engine/types.ts';
import { managed, region } from '../shared.ts';
import { allEnvVars, appEnvVar, STAGES } from './env-vars.ts';
import type { EnvVar } from './model.ts';

// TOML cannot reopen a table, so each profile table holds its own region and
// project secrets go under the region, still inside that table.

const str = (value: string) => JSON.stringify(value);

const entry = (v: EnvVar) => {
  const fields = [
    `description = ${str(v.description)}`,
    `required = ${v.required}`,
    // Secrets never carry committed defaults.
    ...(v.default === undefined || v.sensitive
      ? []
      : [`default = ${str(v.default)}`]),
  ];
  return `${v.key} = { ${Arr.join(fields, ', ')} }`;
};

const profile = (name: string, body: string) =>
  `[profiles.${name}]\n${region(`profile-${name}`, body, '#')}\n`;

export const secretspecToml = (name: string, vars: ReadonlyArray<EnvVar>) => {
  const project = region(
    'project',
    `# Declarative secret manifest for ${name}: what every process needs, not where
# it is stored. \`secretspec run --profile <stage> -- <command>\` materializes it;
# app code reads the values through the generated env package (Effect Config).
# Docs: https://secretspec.dev/concepts/declarative/
[project]
name = ${str(name)}
revision = "1.0"`,
    '#',
  );
  // Non-default profiles inherit every secret from `default` and only pin the
  // stage, the same way each deploy stage selects its own values.
  const stages = Arr.map(STAGES, (stage) =>
    profile(stage, entry({ ...appEnvVar, default: stage })),
  );
  return Arr.join(
    [
      `${project}\n`,
      profile('default', Arr.join(Arr.map(vars, entry), '\n')),
      ...stages,
    ],
    '\n',
  );
};

export const secretspecRenderer: Renderer = (ctx, aggregate) =>
  ctx.config.secrets === 'secretspec'
    ? [
        managed(
          'secretspec.toml',
          secretspecToml(ctx.config.name, allEnvVars(aggregate)),
        ),
      ]
    : [];
