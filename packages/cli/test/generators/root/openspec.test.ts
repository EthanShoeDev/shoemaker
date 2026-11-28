import { BunServices } from '@effect/platform-bun';
import { assert, describe, it } from '@effect/vitest';
import {
  Array as Arr,
  Effect,
  FileSystem,
  Path,
  Record as Rec,
  Schema,
  String as Str,
} from 'effect';

import { defaultConfig } from '../../../src/config/schema.ts';
import {
  OPENSPEC_PACKAGE,
  openspecSkillFiles,
} from '../../../src/generators/openspec/index.ts';
import { OPENSPEC_SKILLS_VERSION } from '../../../src/generators/openspec/skills.gen.ts';
import { versions } from '../../../src/versions.ts';
import { record } from '../files.ts';
import { render } from './fixtures.ts';

const RootManifest = Schema.fromJsonString(
  Schema.Struct({
    workspaces: Schema.Struct({
      catalog: Schema.Record(Schema.String, Schema.String),
    }),
  }),
);

const config = defaultConfig('sample');
const { openspec: _on, ...older } = config.features;

describe('openspec', () => {
  it('vendors the skills of the pinned CLI', () => {
    assert.strictEqual(OPENSPEC_SKILLS_VERSION, versions[OPENSPEC_PACKAGE]);
  });

  it.effect('pins the same CLI in this repo, which holds the same skills', () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const text = yield* fs.readFileString(
        path.resolve(import.meta.dirname, '../../../../../package.json'),
      );
      const root = yield* Schema.decodeEffect(RootManifest)(text);
      assert.strictEqual(
        root.workspaces.catalog[OPENSPEC_PACKAGE],
        versions[OPENSPEC_PACKAGE],
      );
    }).pipe(Effect.provide(BunServices.layer)),
  );

  it('writes the skills inside the repo, where both folders match', () => {
    const { file, text } = render(config);
    const paths = Rec.keys(openspecSkillFiles);
    assert.include(paths, '.claude/skills/openspec-propose/SKILL.md');
    for (const path of paths) {
      assert.match(path, /^\.(?:agents|claude)\/skills\/openspec/u);
      assert.strictEqual(file(path).strategy, 'owned', path);
      assert.strictEqual(
        text(Str.replace('.claude/', '.agents/')(path)),
        text(path),
      );
    }
  });

  it('keeps the CLI in project scope', () => {
    const { text, json, file } = render(config);
    assert.include(text('openspec/config.yaml'), 'skillsScope: project\n');
    assert.strictEqual(file('openspec/config.yaml').strategy, 'seed');
    assert.include(text('flake.nix'), 'export OPENSPEC_SKILLS_SCOPE=project');
    assert.include(text('AGENTS.md'), 'shoemaker:begin openspec');
    const root = json('package.json');
    assert.strictEqual(
      record(root.devDependencies)[OPENSPEC_PACKAGE],
      'catalog:',
    );
    assert.strictEqual(
      record(root.scripts).openspec,
      'OPENSPEC_SKILLS_SCOPE=project openspec',
    );
  });

  it('adds nothing when off or absent (a config older than the feature)', () => {
    for (const features of [older, { ...older, openspec: false }]) {
      const { files, text } = render({ ...config, features });
      assert.deepStrictEqual(
        Arr.filter(files, (f) => Str.includes('openspec')(f.path)),
        [],
      );
      for (const path of ['flake.nix', 'AGENTS.md', 'oxlint.config.ts']) {
        assert.notInclude(Str.toLowerCase(text(path)), 'openspec', path);
      }
    }
  });
});
