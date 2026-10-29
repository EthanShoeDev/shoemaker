import { assert, describe, it } from '@effect/vitest';
import { Array as Arr, Option, pipe, String as Str } from 'effect';

import type { ShoeboxConfig } from '../../../src/config/schema.ts';
import { allEnvVars } from '../../../src/generators/secrets/env-vars.ts';
import { parseJson, preset, record, render } from '../root/fixtures.ts';

const withSecrets = (
  config: ShoeboxConfig,
  secrets: ShoeboxConfig['secrets'],
): ShoeboxConfig => ({ ...config, secrets });

const camel = (key: string) =>
  pipe(
    key,
    Str.toLowerCase,
    Str.split(/_(?=[a-z0-9])/u),
    Arr.map((part, index) => (index === 0 ? part : Str.capitalize(part))),
    Arr.join(''),
  );

// A `[section]` table's body, up to the next table header.
const tomlTable = (toml: string, table: string) => {
  const start = pipe(
    toml,
    Str.indexOf(`[${table}]\n`),
    Option.getOrElse(() => -1),
  );
  assert.isAtLeast(start, 0, table);
  const rest = Str.slice(start + table.length + 3)(toml);
  return pipe(
    Str.search(rest, /^\[/mu),
    Option.match({
      onNone: () => rest,
      onSome: (next) => Str.slice(0, next)(rest),
    }),
  );
};

describe('varlock', () => {
  const { aggregate, byPath, file } = render(
    withSecrets(preset('web'), 'varlock'),
  );
  const schema = file('.env.schema').content;

  it('declares every aggregated var with its decorators', () => {
    assert.include(
      schema,
      '# @defaultSensitive=false @defaultRequired=infer @currentEnv=$APP_ENV',
    );
    for (const v of allEnvVars(aggregate)) {
      assert.match(schema, new RegExp(`^${v.key}=`, 'mu'), v.key);
      const end = pipe(
        schema,
        Str.indexOf(`\n${v.key}=`),
        Option.getOrElse(() => -1),
      );
      const block = Str.slice(0, end)(schema);
      const from = pipe(
        block,
        Str.lastIndexOf('\n# @'),
        Option.getOrElse(() => -1),
      );
      const decorators = Str.slice(from + 3)(block);
      assert.include(decorators, v.required ? '@required' : '@optional');
      if (v.sensitive) assert.include(decorators, '@sensitive');
    }
    assert.isFalse(byPath.has('secretspec.toml'));
  });

  it('never commits a secret value', () => {
    for (const v of Arr.filter(allEnvVars(aggregate), (x) => x.sensitive)) {
      assert.match(schema, new RegExp(`^${v.key}=$`, 'mu'), v.key);
    }
  });

  it('installs varlock from the catalog at the root', () => {
    const root = parseJson(file('package.json'));
    assert.strictEqual(record(root.devDependencies).varlock, 'catalog:');
    assert.include(aggregate.catalog, 'varlock');
    assert.include(file('.gitignore').content, '.env.local');
  });
});

describe('secretspec', () => {
  const { aggregate, byPath, file } = render(
    withSecrets(preset('full'), 'secretspec'),
  );
  const toml = file('secretspec.toml').content;

  it('declares every aggregated var in the default profile', () => {
    assert.include(toml, '[project]\nname = "sample-full"\nrevision = "1.0"');
    const defaults = tomlTable(toml, 'profiles.default');
    for (const v of allEnvVars(aggregate)) {
      assert.match(
        defaults,
        new RegExp(`^${v.key} = \\{ description = `, 'mu'),
      );
    }
    assert.isFalse(byPath.has('.env.schema'));
  });

  it('pins APP_ENV per stage profile', () => {
    for (const stage of ['development', 'staging', 'production']) {
      assert.include(
        tomlTable(toml, `profiles.${stage}`),
        `default = "${stage}"`,
      );
    }
  });

  it('puts the secretspec CLI in the nix shell', () => {
    assert.include(aggregate.nixPackages, 'secretspec');
    assert.match(file('flake.nix').content, /^\s+secretspec$/mu);
  });
});

describe('env package', () => {
  it('exports one Config per var, redacting secrets', () => {
    const { aggregate, file } = render(preset('web'));
    const index = file('packages/env/src/index.ts').content;
    for (const v of allEnvVars(aggregate)) {
      assert.include(index, `export const ${camel(v.key)} = `, v.key);
      if (v.sensitive) {
        assert.match(
          index,
          new RegExp(`Config\\.Redacted\\(\\s*'${v.key}',?\\s*\\)`, 'u'),
        );
      }
    }
    assert.include(index, 'Config.withDefault');
    const manifest = parseJson(file('packages/env/package.json'));
    assert.deepStrictEqual(manifest.exports, {
      '.': './src/index.ts',
      './package.json': './package.json',
    });
  });

  it('is generated with secrets off as long as something reads env', () => {
    const { byPath } = render(withSecrets(preset('web'), 'none'));
    assert.isTrue(byPath.has('packages/env/src/index.ts'));
    assert.isFalse(byPath.has('.env.schema'));
    assert.isFalse(byPath.has('secretspec.toml'));
  });

  it('is skipped when nothing reads env', () => {
    const { aggregate, byPath } = render(preset('minimal'));
    assert.deepStrictEqual(aggregate.env, []);
    assert.isFalse(byPath.has('packages/env/package.json'));
  });
});
