import { assert } from '@effect/vitest';
import {
  Array as Arr,
  Effect,
  FileSystem,
  Path,
  Record as Rec,
  Schema,
  Stream,
  String as Str,
} from 'effect';
import { ChildProcess } from 'effect/process';

export const INSTALL_TIMEOUT = 120_000;

const Specs = Schema.Record(Schema.String, Schema.String);

const Manifest = Schema.Struct({
  name: Schema.String,
  version: Schema.String,
  type: Schema.String,
  dependencies: Schema.optional(Specs),
  optionalDependencies: Schema.optional(Specs),
  peerDependencies: Schema.optional(Specs),
  peerDependenciesMeta: Schema.optional(
    Schema.Record(Schema.String, Schema.Struct({ optional: Schema.Boolean })),
  ),
});

const ManifestJson = Schema.fromJsonString(Manifest);
const RootJson = Schema.fromJsonString(
  Schema.Struct({ workspaces: Schema.Struct({ catalog: Specs }) }),
);
const Json = Schema.fromJsonString(Schema.Unknown);
const decode = Schema.decodeEffect(ManifestJson);
const encode = Schema.encodeEffect(Json);

const isWorkspace = Str.startsWith('workspace:');

const published = (specs: typeof Specs.Type | undefined) =>
  Rec.map(specs ?? {}, (spec, name) =>
    isWorkspace(spec) ? `file:../${name}` : spec,
  );

// What `bun install` puts in a new project that depends on the packages, and
// on `beside` at the versions this repo's catalog pins. The published manifests
// alone decide it, so the packages are those manifests: packing swaps
// package.json in place, which other tests read at the same time. A workspace
// package they need is one of them.
export const installed = Effect.fnUntraced(function* (options: {
  readonly manifests: Arr.NonEmptyReadonlyArray<string>;
  readonly beside: ReadonlyArray<string>;
}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fs.makeTempDirectoryScoped();
  // Each manifest is packages/<name>/package.json.
  const { catalog } = (yield* Effect.flatMap(
    fs.readFileString(
      path.resolve(path.dirname(options.manifests[0]), '../../package.json'),
    ),
    Schema.decodeEffect(RootJson),
  )).workspaces;
  const beside = Rec.fromIterableWith(options.beside, (name) => {
    const version = catalog[name];
    assert.isDefined(version, `${name} is not in the catalog`);
    return [name, version];
  });
  const write = Effect.fnUntraced(function* (dir: string, content: unknown) {
    const text = yield* encode(content);
    yield* fs.makeDirectory(path.join(root, dir), { recursive: true });
    yield* fs.writeFileString(path.join(root, dir, 'package.json'), text);
  });
  const names = yield* Effect.forEach(
    options.manifests,
    Effect.fnUntraced(function* (file) {
      const manifest = yield* Effect.flatMap(fs.readFileString(file), decode);
      const resolved = {
        ...manifest,
        dependencies: published(manifest.dependencies),
        optionalDependencies: published(manifest.optionalDependencies),
        peerDependencies: published(manifest.peerDependencies),
      };
      assert.isFalse(
        Arr.some(
          [
            ...Rec.values(resolved.dependencies),
            ...Rec.values(resolved.optionalDependencies),
            ...Rec.values(resolved.peerDependencies),
          ],
          Str.startsWith('catalog:'),
        ),
        'a spec only this repo can resolve',
      );
      yield* write(manifest.name, resolved);
      return manifest.name;
    }),
    { concurrency: 1 },
  );
  yield* write('project', {
    name: 'project',
    private: true,
    dependencies: {
      ...Rec.fromIterableWith(names, (name) => [name, `file:../${name}`]),
      ...beside,
    },
  });
  const project = path.join(root, 'project');
  const handle = yield* ChildProcess.make(
    'bun',
    ['install', '--ignore-scripts', '--linker=hoisted', '--prefer-offline'],
    { cwd: project },
  );
  const [output, code] = yield* Effect.all(
    [handle.all.pipe(Stream.decodeText, Stream.mkString), handle.exitCode],
    { concurrency: 2 },
  );
  assert.strictEqual(Number(code), 0, output);
  const modules = path.join(project, 'node_modules');
  const found = yield* fs.readDirectory(modules);
  const scoped = yield* Effect.forEach(
    Arr.filter(found, Str.startsWith('@')),
    (scope) =>
      Effect.map(
        fs.readDirectory(path.join(modules, scope)),
        Arr.map((name) => `${scope}/${name}`),
      ),
    { concurrency: 1 },
  );
  return [...found, ...Arr.flatten(scoped)];
}, Effect.scoped);
