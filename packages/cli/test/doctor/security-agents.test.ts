import { assert, describe, it } from '@effect/vitest';
import { Array as Arr, Effect } from 'effect';

import { agentsMd } from '../../src/doctor/agents.ts';
import {
  mcpSecrets,
  rawEnvAccess,
  secretKind,
  secretsManager,
} from '../../src/doctor/security.ts';
import { failures, json, runCheck } from './helpers.ts';

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
      const found = yield* failures(mcpSecrets, {
        '.mcp.json': json({
          mcpServers: {
            betterstack: {
              type: 'http',
              headers: { Authorization: `Bearer ${TOKEN}` },
            },
          },
        }),
      });
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
      const tokenFile = json({
        mcpServers: { x: { headers: { Authorization: `Bearer ${TOKEN}` } } },
      });
      assert.lengthOf(
        yield* failures(mcpSecrets, {
          '.mcp.json': tokenFile,
          '.gitignore': '.mcp.json\n',
        }),
        0,
      );
      assert.lengthOf(
        yield* failures(mcpSecrets, {
          '.mcp.json': json({
            mcpServers: { x: { command: 'bunx', args: ['mcp'] } },
          }),
        }),
        0,
      );
    }),
  );

  it.effect('secrets-manager is required once the repo reads env', () =>
    Effect.gen(function* () {
      assert.lengthOf(
        yield* failures(secretsManager, {
          'apps/api/src/main.ts': 'process.env.PORT',
        }),
        1,
      );
      assert.lengthOf(
        yield* failures(secretsManager, {
          'apps/api/src/main.ts': 'process.env.PORT',
          'secretspec.toml': '',
        }),
        0,
      );
      assert.lengthOf(
        yield* failures(secretsManager, {
          'apps/api/src/main.ts': 'export {}',
        }),
        0,
      );
    }),
  );

  it.effect('raw-env-access counts reads outside env/config/test files', () =>
    Effect.gen(function* () {
      const found = yield* failures(rawEnvAccess, {
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
});
