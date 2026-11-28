import { assert, describe, it } from '@effect/vitest';
import { Array as Arr, Effect, String as Str } from 'effect';

import { secretsBackend } from '../../src/doctor/secrets-backend.ts';
import { envSchema } from '../../src/generators/secrets/varlock.ts';
import { failures } from './helpers.ts';

const VALUE = 'do-not-print-me';

const messages = (files: Readonly<Record<string, string>>) =>
  failures(secretsBackend, files).pipe(Effect.map(Arr.map((f) => f.message)));

const expectFailures = Effect.fn(function* (
  files: Readonly<Record<string, string>>,
  expected: ReadonlyArray<string>,
) {
  const found = yield* messages(files);
  assert.deepStrictEqual(found, expected);
});

const schema = (plugin: string) => `# @defaultSensitive=false
${plugin}
# @initInfisical(
#   projectId=p, environment=remap($APP_ENV, development, dev),
#   siteUrl=$INFISICAL_DOMAIN, clientSecret=$INFISICAL_CLIENT_SECRET
# )
# ---

# @optional
APP_ENV=development

# @required @sensitive
API_KEY=

# @optional @sensitive @internal
INFISICAL_DOMAIN=

# @optional @sensitive @internal
INFISICAL_CLIENT_SECRET=
`;
const REMOTE = schema('# @plugin(@varlock/infisical-plugin@2.1.3)');

describe('secrets-backend with varlock', () => {
  it.effect('needs a remote plugin once a secret is declared', () =>
    Effect.gen(function* () {
      yield* expectFailures({ '.env.schema': REMOTE }, []);
      for (const plugin of ['', '# @plugin(@varlock/keepass-plugin)']) {
        yield* expectFailures({ '.env.schema': schema(plugin) }, [
          'varlock has no remote plugin for API_KEY',
        ]);
      }
      yield* expectFailures(
        {
          '.env.schema': '# @defaultSensitive=false\n# ---\n\nPORT=3000\n',
        },
        [],
      );
      // varlock's own default is sensitive.
      yield* expectFailures(
        {
          '.env.schema': '# ---\n\nAPI_KEY=\n\n# @public\nPORT=1\n',
        },
        ['varlock has no remote plugin for API_KEY'],
      );
    }),
  );

  it.effect("accepts a nested schema's root plugin", () =>
    expectFailures(
      {
        '.env.schema': REMOTE,
        'apps/api/.env.schema':
          '# @defaultSensitive=false\n# ---\n\n# @sensitive\nTOKEN=\n',
      },
      [],
    ),
  );

  it.effect('does not take the generated example for a plugin', () =>
    Effect.gen(function* () {
      const generated = envSchema('demo', [
        {
          key: 'API_KEY',
          description: 'A key',
          required: true,
          sensitive: true,
        },
      ]);
      yield* expectFailures({ '.env.schema': generated }, [
        'varlock has no remote plugin for API_KEY',
      ]);
    }),
  );

  it.effect('takes nothing from the example for the store credential', () =>
    expectFailures(
      {
        '.env.schema': envSchema('demo', [
          {
            key: 'PORT',
            description: 'A port',
            required: false,
            sensitive: false,
          },
        ]),
        '.env.local': 'INFISICAL_DOMAIN=https://example.com\nPORT=4000\n',
      },
      [],
    ),
  );

  it.effect('reads decorators where varlock does', () =>
    Effect.gen(function* () {
      const none = '# @defaultSensitive=false\n# ---\n\n';
      // A post-value comment carries decorators.
      yield* expectFailures({ '.env.schema': `${none}TOKEN= # @sensitive\n` }, [
        'varlock has no remote plugin for TOKEN',
      ]);
      // A regular comment line, or one cut off by a divider, does not.
      yield* expectFailures(
        {
          '.env.schema': `${none}# not @sensitive at all\nPORT=\n\n# @sensitive\n# ---\nHOST=\n`,
        },
        [],
      );
      // A plugin after another decorator on the same line.
      yield* expectFailures(
        {
          '.env.schema':
            '# @defaultSensitive=false @plugin(@varlock/infisical-plugin)\n# ---\n\n# @sensitive\nTOKEN=\n',
        },
        [],
      );
    }),
  );

  it.effect('finds secrets in gitignored dotenv files, by name only', () =>
    Effect.gen(function* () {
      const found = yield* messages({
        '.gitignore': '.env.local\n',
        '.env.schema': REMOTE,
        '.env.local': `APP_ENV=staging\nAPI_KEY=${VALUE}\n`,
        '.env.production.local': `export API_KEY="${VALUE}"\n`,
        '.env.test': `API_KEY=${VALUE}\n`,
      });
      assert.deepStrictEqual(found, [
        '.env.local holds secrets: API_KEY',
        '.env.production.local holds secrets: API_KEY',
      ]);
      assert.notInclude(Arr.join(found, ' '), VALUE);
      // Encrypted on this device is still not in the remote store.
      yield* expectFailures(
        {
          '.env.schema': REMOTE,
          '.env.local': 'API_KEY=varlock("local:abc")\n',
        },
        ['.env.local holds secrets: API_KEY'],
      );
      yield* expectFailures(
        {
          '.env.schema': REMOTE,
          '.env.local': 'API_KEY=\nOTHER=1\n',
        },
        [],
      );
    }),
  );

  it.effect(
    "keeps the store's own credential out of files, even encrypted",
    () =>
      Effect.gen(function* () {
        for (const value of [VALUE, 'varlock("local:abc")']) {
          yield* expectFailures(
            {
              '.env.schema': REMOTE,
              '.env.local': `INFISICAL_CLIENT_SECRET=${value}\n`,
            },
            [
              ".env.local holds the store's own credential: INFISICAL_CLIENT_SECRET",
            ],
          );
        }
        yield* expectFailures(
          {
            '.env.schema': REMOTE,
            '.env.local': 'INFISICAL_CLIENT_SECRET=\n',
          },
          [],
        );
      }),
  );
});

describe('secrets-backend with secretspec', () => {
  const SECRETS = `[profiles.default]
API_KEY = { description = "A key", required = true }
PORT = { description = "A port", default = "3000" }
`;

  it.effect('needs a remote provider', () =>
    Effect.gen(function* () {
      yield* expectFailures({ 'secretspec.toml': SECRETS }, [
        "secretspec.toml names no remote provider, so each machine's own default decides where these live: API_KEY",
      ]);
      const onlyEnv = `${SECRETS}[defaults]\nproviders = ["env"]\n`;
      const found = yield* messages({ 'secretspec.toml': onlyEnv });
      assert.lengthOf(found, 1);
      const remote = `${SECRETS}[profiles.production]
API_KEY = { description = "A key" }
[providers]
env = "env://"
store = { uri = "infisical:///p?env=prod" }
[defaults]
providers = ["env", "store"]
`;
      yield* expectFailures({ 'secretspec.toml': remote }, []);
      yield* expectFailures(
        {
          'secretspec.toml': Str.replace('infisical:', 'dotenv:')(remote),
        },
        ['secretspec.toml keeps secrets in a local provider (dotenv): API_KEY'],
      );
    }),
  );

  it.effect("does not inherit the default profile's providers", () =>
    Effect.gen(function* () {
      const inherited = `${SECRETS}[profiles.default.defaults]
providers = ["infisical:///p"]
[profiles.production]
PORT = { description = "A port", default = "80" }
`;
      const missing = [
        "secretspec.toml names no remote provider, so each machine's own default decides where these live: API_KEY",
      ];
      yield* expectFailures({ 'secretspec.toml': inherited }, missing);
      yield* expectFailures(
        {
          'secretspec.toml': `${inherited}[profiles.production.defaults]\nproviders = ["awsps"]\n`,
        },
        [],
      );
      yield* expectFailures(
        {
          'secretspec.toml': `${inherited}[profiles.production.defaults]\ninherit = false\n`,
        },
        [],
      );
    }),
  );

  it.effect('reads project and per-secret chains and fallback aliases', () =>
    Effect.gen(function* () {
      const project = `[defaults]\nproviders = ["store"]\n[providers]\nstore = "awsps://x"\nboth = { fallback = ["store", "keyring"] }\n${SECRETS}`;
      yield* expectFailures({ 'secretspec.toml': project }, []);
      const own = `${project}TOKEN = { description = "t", providers = ["both"] }\n`;
      yield* expectFailures({ 'secretspec.toml': own }, [
        'secretspec.toml keeps secrets in a local provider (keyring): TOKEN',
      ]);
    }),
  );

  it.effect('finds its keys in dotenv files and reports broken TOML', () =>
    Effect.gen(function* () {
      const remote = `${SECRETS}[defaults]\nproviders = ["infisical:///p"]\n`;
      yield* expectFailures(
        {
          'secretspec.toml': remote,
          '.env': `API_KEY=${VALUE}\nPORT=1\n`,
        },
        ['.env holds secrets: API_KEY'],
      );
      yield* expectFailures({ 'secretspec.toml': 'a = ' }, [
        'secretspec.toml is not valid TOML',
      ]);
    }),
  );

  it.effect('passes without a secrets manager', () => expectFailures({}, []));
});
