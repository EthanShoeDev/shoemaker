import { Array as Arr, Option, pipe, String as Str } from 'effect';

import type { Aggregate } from '../../engine/types.ts';
import type { EnvVar } from './model.ts';

export const STAGES = ['development', 'staging', 'production'] as const;

// The environment flag every manager keys off: varlock's `@currentEnv`, the
// secretspec profile defaults, and `@scope/env`'s `appEnv`.
export const appEnvVar: EnvVar = {
  key: 'APP_ENV',
  description:
    'Deployment stage this process runs as; selects per-stage env files and profiles',
  required: false,
  sensitive: false,
  default: 'development',
  type: `enum(${Arr.join(STAGES, ', ')})`,
};

// APP_ENV first, then every contributed var by key. A generator that declares
// APP_ENV itself replaces the base definition.
export const allEnvVars = (aggregate: Aggregate): ReadonlyArray<EnvVar> => {
  const contributed = Arr.filter(aggregate.env, (v) => v.key !== appEnvVar.key);
  const override = pipe(
    Arr.findFirst(aggregate.env, (v) => v.key === appEnvVar.key),
    Option.getOrElse(() => appEnvVar),
  );
  return [
    override,
    ...Arr.sort(contributed, (a: EnvVar, b: EnvVar) =>
      Str.localeCompare(b.key)(a.key),
    ),
  ];
};

export const enumMembers = (type: string | undefined) => {
  const members = /^enum\((.*)\)$/u.exec(type ?? '')?.[1];
  return members === undefined
    ? undefined
    : Arr.map(Str.split(members, ','), (member) => Str.trim(member));
};
