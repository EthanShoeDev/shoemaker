import { Array as Arr, pipe, String as Str } from 'effect';

import type { Renderer } from '../../engine/types.ts';
import { hasEnvPackage } from '../root/workspaces.ts';
import {
  owned,
  packageTsconfig,
  seed,
  workspacePackageJson,
} from '../shared.ts';
import { allEnvVars, enumMembers } from './env-vars.ts';
import type { EnvVar } from './model.ts';

const DIR = 'packages/env';

export const quote = (value: string) =>
  `'${pipe(value, Str.replaceAll('\\', '\\\\'), Str.replaceAll("'", "\\'"))}'`;

const camel = (value: string) =>
  pipe(
    value,
    Str.toLowerCase,
    Str.split(/[-_]+(?=[a-z0-9])/u),
    Arr.map((part, index) => (index === 0 ? part : Str.capitalize(part))),
    Arr.join(''),
  );

const baseType = (type: string | undefined) =>
  type === undefined ? 'string' : Str.trim(Str.split(type, '(')[0]);

interface Call {
  readonly fn: string;
  readonly args: ReadonlyArray<string>;
}

const constructor = (v: EnvVar): Call => {
  const key = quote(v.key);
  const call = (fn: string, ...args: ReadonlyArray<string>) => ({
    fn: `Config.${fn}`,
    args: [...args, key],
  });
  if (v.sensitive) return call('Redacted');
  const members = enumMembers(v.type);
  if (members !== undefined) {
    return call('Literals', `[${Arr.join(Arr.map(members, quote), ', ')}]`);
  }
  switch (baseType(v.type)) {
    case 'port': {
      return call('Port');
    }
    case 'url': {
      return call('URL');
    }
    case 'number': {
      return call('Number');
    }
    case 'int':
    case 'integer': {
      return call('Int');
    }
    case 'boolean': {
      return call('Boolean');
    }
    default: {
      return call('String');
    }
  }
};

const defaultLiteral = (v: EnvVar, value: string) => {
  switch (baseType(v.type)) {
    case 'port':
    case 'number':
    case 'int':
    case 'integer':
    case 'boolean': {
      return value;
    }
    case 'url': {
      return `new URL(${quote(value)})`;
    }
    default: {
      return quote(value);
    }
  }
};

const wrapper = (v: EnvVar) => {
  // Secrets never carry committed defaults.
  if (v.default !== undefined && !v.sensitive) {
    return `Config.withDefault(${defaultLiteral(v, v.default)})`;
  }
  return v.required ? undefined : 'Config.option';
};

// Breaks the way oxfmt does: the whole statement on one line if it fits, else
// the `.pipe(...)` argument, else the constructor's arguments.
const declaration = (v: EnvVar) => {
  const { fn, args } = constructor(v);
  const piped = wrapper(v);
  const head = `export const ${camel(v.key)} = `;
  const call = `${fn}(${Arr.join(args, ', ')})`;
  const tail = piped === undefined ? '' : `.pipe(${piped})`;
  const oneLine = `${head}${call}${tail};`;
  const argLines = Arr.join(
    Arr.map(args, (a) => `  ${a},`),
    '\n',
  );
  const brokenArgs = `${head}${fn}(\n${argLines}\n)${tail};`;
  const body =
    oneLine.length <= 80
      ? oneLine
      : piped !== undefined && `${head}${call}.pipe(`.length <= 80
        ? `${head}${call}.pipe(\n  ${piped},\n);`
        : brokenArgs;
  return `/** ${v.description} */\n${body}`;
};

const indexTs = (vars: ReadonlyArray<EnvVar>) => {
  const tags = Arr.sort(
    new Set(Arr.flatMap(vars, (v) => v.tags ?? [])),
    Str.Order,
  );
  const groups = Arr.map(tags, (tag) => {
    const members = pipe(
      vars,
      Arr.filter((v) => v.tags?.includes(tag) === true),
      Arr.map((v) => `  ${camel(v.key)},`),
    );
    return `/** Everything \`${tag}\` reads, as one Config. */\nexport const ${camel(tag)}Env = Config.all({\n${Arr.join(members, '\n')}\n});`;
  });
  return Arr.join(
    [
      "import { Config } from 'effect';",
      '',
      '// Rendered by shoebox from the env vars its generators declare. App code reads\n// env only through these Configs (enforced by the no-raw-env-access rule).',
      '',
      Arr.join(Arr.map(vars, declaration), '\n\n'),
      ...(groups.length > 0 ? ['', Arr.join(groups, '\n\n')] : []),
      '',
    ],
    '\n',
  );
};

const testTs = `import { assert, it } from '@effect/vitest';
import { ConfigProvider, Effect } from 'effect';

import { appEnv } from '../src/index.ts';

it.effect('APP_ENV defaults to development', () =>
  Effect.gen(function* () {
    const value = yield* appEnv.parse(ConfigProvider.fromUnknown({}));
    assert.strictEqual(value, 'development');
  }),
);

it.effect('APP_ENV rejects an unknown stage', () =>
  Effect.gen(function* () {
    const result = yield* appEnv
      .parse(ConfigProvider.fromUnknown({ APP_ENV: 'qa' }))
      .pipe(Effect.result);
    assert.strictEqual(result._tag, 'Failure');
  }),
);
`;

const readme = (scope: string) => `# @${scope}/env

Every environment variable this repo reads, as Effect \`Config\` values.
\`src/index.ts\` is rendered by \`shoe-box sync\` from the env schema; edit the
schema (or the generator that declares the variable), not the file.

\`\`\`ts
import { appEnv } from '@${scope}/env';

const program = Effect.gen(function* () {
  const stage = yield* appEnv;
});
\`\`\`

Never read \`process.env\` directly: the \`no-raw-env-access\` lint rule rejects it.
`;

export const envPackageRenderer: Renderer = (ctx, aggregate) => {
  if (!hasEnvPackage(ctx.config, aggregate)) return [];
  const vars = allEnvVars(aggregate);
  return [
    workspacePackageJson(ctx, {
      dir: DIR,
      name: 'env',
      description:
        'Typed environment (Effect Config) for every app and package',
      exports: { '.': './src/index.ts' },
      scripts: { test: 'vitest run' },
      dependencies: ['effect'],
      devDependencies: ['@effect/vitest', 'vitest'],
    }),
    packageTsconfig(DIR),
    owned(`${DIR}/src/index.ts`, indexTs(vars)),
    seed(`${DIR}/test/index.test.ts`, testTs),
    seed(`${DIR}/README.md`, readme(ctx.config.scope)),
  ];
};
