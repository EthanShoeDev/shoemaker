import { assert, describe, it } from '@effect/vitest';
import { Effect } from 'effect';

import { openspec } from '../../src/doctor/agents.ts';
import { openspecSkillFiles } from '../../src/generators/openspec/index.ts';
import { OPENSPEC_SKILLS_VERSION } from '../../src/generators/openspec/skills.gen.ts';
import { failures, jsonFiles, runCheck } from './helpers.ts';

const rootWith = (spec: string, catalog = OPENSPEC_SKILLS_VERSION) => ({
  name: 'repo',
  workspaces: { packages: [], catalog: { '@fission-ai/openspec': catalog } },
  devDependencies: { '@fission-ai/openspec': spec },
});

const good = Effect.map(
  jsonFiles({ 'package.json': rootWith('catalog:') }),
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

  it.effect('fails on a CLI older than the skills, not a raised one', () =>
    Effect.gen(function* () {
      const files = yield* good;
      for (const root of [rootWith('catalog:', '^1.0.0'), rootWith('0.0.1')]) {
        const manifests = yield* jsonFiles({ 'package.json': root });
        const found = yield* failures(openspec, { ...files, ...manifests });
        assert.lengthOf(found, 1);
        assert.include(found[0]?.message ?? '', OPENSPEC_SKILLS_VERSION);
      }
      const raised = yield* jsonFiles({
        'package.json': rootWith('catalog:', '^99.0.0'),
      });
      const accepted = yield* failures(openspec, { ...files, ...raised });
      assert.deepStrictEqual(accepted, []);
      const nested = yield* jsonFiles({
        'package.json': { name: 'repo', workspaces: ['apps/*'] },
        'apps/web/package.json': {
          name: 'web',
          devDependencies: { '@fission-ai/openspec': OPENSPEC_SKILLS_VERSION },
        },
      });
      const found = yield* failures(openspec, { ...files, ...nested });
      assert.include(found[0]?.message ?? '', 'not a root dependency');
    }),
  );
});
