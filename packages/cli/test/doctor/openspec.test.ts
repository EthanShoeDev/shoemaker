import { assert, describe, it } from '@effect/vitest';
import { Effect } from 'effect';

import { openspec } from '../../src/doctor/agents.ts';
import { openspecSkillFiles } from '../../src/generators/openspec/index.ts';
import { failures, jsonFiles, runCheck } from './helpers.ts';

const good = Effect.map(
  jsonFiles({
    'package.json': {
      name: 'repo',
      devDependencies: { '@fission-ai/openspec': 'catalog:' },
    },
  }),
  (manifests) => ({
    ...manifests,
    ...openspecSkillFiles,
    'openspec/config.yaml': 'schema: spec-driven\nskillsScope: project\n',
  }),
);

describe('openspec doctor check', () => {
  it.effect('ignores a repo that does not use OpenSpec', () =>
    Effect.gen(function* () {
      const found = yield* runCheck(openspec, {});
      assert.deepStrictEqual(found, []);
    }),
  );

  it.effect('passes a project-scoped setup', () =>
    Effect.gen(function* () {
      const files = yield* good;
      const found = yield* failures(openspec, files);
      assert.deepStrictEqual(found, []);
    }),
  );

  it.effect('fails without project scope, the CLI or current skills', () =>
    Effect.gen(function* () {
      const files = yield* good;
      const found = yield* failures(openspec, {
        ...files,
        'package.json': '{ "name": "repo" }',
        'openspec/config.yaml': 'schema: spec-driven\n# skillsScope: project\n',
        '.claude/skills/openspec-propose/SKILL.md': 'old\n',
      });
      assert.lengthOf(found, 3);
      assert.include(
        found[2]?.message ?? '',
        '.claude/skills/openspec-propose/SKILL.md',
      );
    }),
  );
});
