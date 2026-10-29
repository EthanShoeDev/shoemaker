import { Array as Arr, Effect, Option, Schema } from 'effect';

import { makeMemoryRepo } from '../../src/engine/repo-memory.ts';
import type { FileChange } from '../../src/engine/repo.ts';
import type { Migration } from '../../src/migrations/types.ts';

export const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

export const plan = (
  migration: Migration,
  files: Readonly<Record<string, string>>,
) =>
  Effect.gen(function* () {
    const repo = makeMemoryRepo(files);
    const applies = yield* migration.applies(repo);
    const changes = applies ? yield* migration.run(repo) : [];
    return { applies, changes, file: (path: string) => fileIn(changes, path) };
  });

const fileIn = (changes: ReadonlyArray<FileChange>, path: string) =>
  Option.match(
    Arr.findFirst(changes, (c) => c.path === path),
    {
      onNone: () => 'unchanged',
      onSome: (change) => change.content,
    },
  );

const Deps = Schema.Record(Schema.String, Schema.String);
const decodePkg = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({
      scripts: Schema.optional(Deps),
      dependencies: Schema.optional(Deps),
      devDependencies: Schema.optional(Deps),
      peerDependencies: Schema.optional(Deps),
      workspaces: Schema.optional(
        Schema.Union([
          Schema.Array(Schema.String),
          Schema.Struct({ catalog: Schema.optional(Deps) }),
        ]),
      ),
    }),
  ),
);

// The fields tests assert on, defaulted so tests can index them directly.
export const pkgIn = (content: string | undefined) => {
  const pkg = Option.getOrUndefined(decodePkg(content ?? '{}'));
  const workspaces = pkg?.workspaces;
  return {
    scripts: pkg?.scripts ?? {},
    dependencies: pkg?.dependencies ?? {},
    devDependencies: pkg?.devDependencies ?? {},
    peerDependencies: pkg?.peerDependencies ?? {},
    catalog:
      workspaces !== undefined && 'catalog' in workspaces
        ? (workspaces.catalog ?? {})
        : {},
  };
};
