import { BunServices } from '@effect/platform-bun';
import { assert, describe, it } from '@effect/vitest';
import { Array as Arr, Effect, FileSystem, Option, Path, Schema } from 'effect';

import { shoemakerFamily, versions } from '../src/versions.ts';

const ChangesetConfig = Schema.fromJsonString(
  Schema.Struct({ fixed: Schema.Array(Schema.Array(Schema.String)) }),
);
const Manifest = Schema.fromJsonString(
  Schema.Struct({ name: Schema.String, version: Schema.String }),
);

const readRepo = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = path.resolve(import.meta.dirname, '../../..');
  const config = yield* Schema.decodeEffect(ChangesetConfig)(
    yield* fs.readFileString(path.join(root, '.changeset/config.json')),
  );
  const dirs = yield* fs.readDirectory(path.join(root, 'packages'));
  const manifests = yield* Effect.forEach(dirs, (dir) =>
    Effect.flatMap(
      fs.readFileString(path.join(root, 'packages', dir, 'package.json')),
      Schema.decodeEffect(Manifest),
    ),
  );
  return { config, manifests };
}).pipe(Effect.provide(BunServices.layer));

// Releases bump the fixed group's package.json versions and nothing else, so
// the range generated repos get must follow them.
describe('shoemaker family versions', () => {
  it.effect('match the changesets fixed group', () =>
    Effect.gen(function* () {
      const { config } = yield* readRepo;
      const group = Option.getOrThrow(
        Arr.findFirst(config.fixed, Arr.contains('shoemaker')),
      );
      assert.sameMembers([...group], [...shoemakerFamily]);
    }),
  );

  it.effect('admit every package version in the group', () =>
    Effect.gen(function* () {
      const { manifests } = yield* readRepo;
      for (const name of shoemakerFamily) {
        const { version } = Option.getOrThrow(
          Arr.findFirst(manifests, (pkg) => pkg.name === name),
        );
        assert.isTrue(
          Bun.semver.satisfies(version, versions[name]),
          `${name}@${version} is outside ${versions[name]}`,
        );
      }
    }),
  );
});
