import { assert, describe, it } from '@effect/vitest';
import { Array as Arr, Effect } from 'effect';

import {
  agentsMd,
  cloudflareObservabilityMcp,
} from '../../src/doctor/agents.ts';
import {
  mcpSecrets,
  rawEnvAccess,
  secretKind,
  secretsManager,
} from '../../src/doctor/security.ts';
import { failures, jsonFiles, runCheck } from './helpers.ts';

const TOKEN = 'abcDEF123456ghiJKL789';

describe('security doctor checks', () => {
  it('secretKind recognises literal secrets but not references', () => {
    assert.strictEqual(
      secretKind('Authorization', `Bearer ${TOKEN}`),
      'a literal bearer token',
    );
    assert.isUndefined(
      // oxlint-disable-next-line eslint/no-template-curly-in-string -- a literal env reference is the input under test
      secretKind('Authorization', 'Bearer ${BETTERSTACK_TOKEN}'),
    );
    assert.strictEqual(
      secretKind('arg', `--access-token=${TOKEN}`),
      'a secret in a CLI argument',
    );
    // oxlint-disable-next-line eslint/no-template-curly-in-string -- a literal env reference is the input under test
    assert.isUndefined(secretKind('arg', '--access-token=${SENTRY_TOKEN}'));
    assert.strictEqual(
      secretKind('OPENAI_API_KEY', `sk-${TOKEN}${TOKEN}`),
      'an API key',
    );
    assert.isUndefined(
      secretKind(
        'GOOGLE_APPLICATION_CREDENTIALS',
        '{env:HOME}/.config/gcloud/creds.json',
      ),
    );
    assert.isUndefined(secretKind('url', 'https://mcp.example.com/token'));
  });

  it.effect('mcp-secrets fails on a committed token without printing it', () =>
    Effect.gen(function* () {
      const files = yield* jsonFiles({
        '.mcp.json': {
          mcpServers: {
            betterstack: {
              type: 'http',
              headers: { Authorization: `Bearer ${TOKEN}` },
            },
          },
        },
      });
      const found = yield* failures(mcpSecrets, files);
      assert.lengthOf(found, 1);
      assert.include(found[0]?.message ?? '', 'SECURITY: .mcp.json');
      assert.include(
        found[0]?.message ?? '',
        'mcpServers.betterstack.headers.Authorization',
      );
      assert.notInclude(
        Arr.join(
          Arr.map(found, (f) => `${f.message} ${f.fix ?? ''}`),
          '\n',
        ),
        TOKEN,
      );
    }),
  );

  it.effect('mcp-secrets passes when the file is gitignored or clean', () =>
    Effect.gen(function* () {
      const tokenFile = yield* jsonFiles({
        '.mcp.json': {
          mcpServers: { x: { headers: { Authorization: `Bearer ${TOKEN}` } } },
        },
      });
      const ignoredTokenFailures = yield* failures(mcpSecrets, {
        ...tokenFile,
        '.gitignore': '.mcp.json\n',
      });
      assert.lengthOf(ignoredTokenFailures, 0);
      const tokenless = yield* jsonFiles({
        '.mcp.json': {
          mcpServers: { x: { command: 'bunx', args: ['mcp'] } },
        },
      });
      const tokenlessFailures = yield* failures(mcpSecrets, tokenless);
      assert.lengthOf(tokenlessFailures, 0);
    }),
  );

  it.effect('secrets-manager is required once the repo reads env', () =>
    Effect.gen(function* () {
      const missingManagerFailures = yield* failures(secretsManager, {
        'apps/api/src/main.ts': 'process.env.PORT',
      });
      assert.lengthOf(missingManagerFailures, 1);
      const withManagerFailures = yield* failures(secretsManager, {
        'apps/api/src/main.ts': 'process.env.PORT',
        'secretspec.toml': '',
      });
      assert.lengthOf(withManagerFailures, 0);
      const noEnvFailures = yield* failures(secretsManager, {
        'apps/api/src/main.ts': 'export {}',
      });
      assert.lengthOf(noEnvFailures, 0);
    }),
  );

  it.effect('raw-env-access counts reads outside env/config/test files', () =>
    Effect.gen(function* () {
      const found = yield* failures(rawEnvAccess, {
        '.env.schema': '',
        'apps/api/src/main.ts':
          'const a = process.env.A;\nconst b = process.env.B;\n',
        'packages/env/src/index.ts': 'process.env.A',
        'vite.config.ts': 'process.env.A',
        'apps/api/test/a.test.ts': 'process.env.A',
      });
      assert.include(
        found[0]?.message ?? '',
        '2 raw process.env/Bun.env reads in 1 file(s): apps/api/src/main.ts (2)',
      );
      // Without varlock, raw access is not a finding.
      const rawEnvFailures = yield* failures(rawEnvAccess, {
        'apps/api/src/main.ts': 'process.env.A',
      });
      assert.lengthOf(rawEnvFailures, 0);
    }),
  );
});

describe('agents doctor check', () => {
  it.effect('AGENTS.md + CLAUDE.md -> @AGENTS.md', () =>
    Effect.gen(function* () {
      const good = yield* runCheck(agentsMd, {
        'AGENTS.md': '# x',
        'CLAUDE.md': '@AGENTS.md\n',
      });
      assert.isTrue(Arr.every(good, (f) => f.ok));
      const bad = yield* failures(agentsMd, { 'CLAUDE.md': '# Guidance\n' });
      assert.deepStrictEqual(
        Arr.map(bad, (f) => f.message),
        ['no AGENTS.md', 'CLAUDE.md is not `@AGENTS.md`'],
      );
      assert.include(bad[0]?.fix ?? '', 'move CLAUDE.md to AGENTS.md');
    }),
  );

  it.effect(
    'cloudflare-observability-mcp wants the server only where Workers deploy',
    () =>
      Effect.gen(function* () {
        const pkg = (deps: Record<string, string>) => ({
          name: 'x',
          devDependencies: deps,
        });
        const aws = yield* jsonFiles({
          'package.json': pkg({ '@alchemy.run/aws': '2.0.0' }),
        });
        const awsObservabilityFailures = yield* runCheck(
          cloudflareObservabilityMcp,
          aws,
        );
        assert.lengthOf(awsObservabilityFailures, 0);
        const otherServer = yield* jsonFiles({
          'package.json': pkg({ wrangler: '4.0.0' }),
          '.mcp.json': { mcpServers: { other: { type: 'http' } } },
        });
        const missing = yield* failures(
          cloudflareObservabilityMcp,
          otherServer,
        );
        assert.lengthOf(missing, 1);
        assert.strictEqual(missing[0]?.path, '.mcp.json');
        const cloudflare = yield* jsonFiles({
          'package.json': pkg({ '@alchemy.run/cloudflare': '2.0.0' }),
          '.mcp.json': {
            mcpServers: {
              cf: {
                type: 'http',
                url: 'https://observability.mcp.cloudflare.com/mcp',
              },
            },
          },
        });
        const found = yield* runCheck(cloudflareObservabilityMcp, cloudflare);
        assert.isTrue(found.length === 1 && found[0]?.ok === true);
      }),
  );
});
