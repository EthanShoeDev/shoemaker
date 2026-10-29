import { pathToFileURL } from 'node:url';

import { Effect, FileSystem, Path, Schema, String as Str } from 'effect';

import { sha256 } from '../engine/hash.ts';
import { decodeConfig } from './schema.ts';

export const CONFIG_PATH = 'shoemaker.config.ts';

export class ConfigError extends Schema.TaggedError<
  ConfigError,
  { readonly brand: unique symbol }
>()('ConfigError', { message: Schema.String }) {}

const DEFINE_IMPORT =
  /import\s*\{\s*defineConfig\s*\}\s*from\s*['"]shoemaker\/config['"];?/u;

const describe = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const importDefault = Effect.fnUntraced(function* (
  file: string,
  source: string,
) {
  // The query string defeats the module cache after `add` rewrites the file;
  // keyed by content, as two loads can land in the same millisecond.
  const url = `${pathToFileURL(file).href}?v=${Str.slice(0, 16)(sha256(source))}`;
  return yield* Effect.tryPromise({
    // dynamic-import -- shoemaker.config.ts is user code located at runtime
    try: (): Promise<{ readonly default?: unknown }> => import(url),
    catch: (error) =>
      ConfigError.make({
        message: `Could not load ${file}: ${describe(error)}`,
      }),
  }).pipe(Effect.map((module) => module.default));
});

// Before `bun install` the repo cannot resolve `shoemaker/config`.
// `defineConfig` is the identity, so load a copy with the import inlined.
const importStandalone = Effect.fnUntraced(function* (source: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const dir = yield* fs.makeTempDirectoryScoped({
    prefix: 'shoemaker-config-',
  });
  const file = path.join(dir, CONFIG_PATH);
  yield* fs.writeFileString(
    file,
    Str.replace(
      DEFINE_IMPORT,
      'const defineConfig = <T,>(config: T): T => config;',
    )(source),
  );
  return yield* importDefault(file, source);
}, Effect.scoped);

export const configExists = Effect.fnUntraced(function* (root: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  return yield* fs.exists(path.join(root, CONFIG_PATH));
});

export const loadConfig = Effect.fnUntraced(function* (root: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const file = path.resolve(root, CONFIG_PATH);
  const exists = yield* fs.exists(file);
  if (!exists) {
    return yield* ConfigError.make({
      message: `No ${CONFIG_PATH} in ${path.resolve(root)}. Run \`shoemaker init\` or \`shoemaker adopt\` first.`,
    });
  }
  const source = yield* fs.readFileString(file);
  const loaded = yield* importDefault(file, source).pipe(
    Effect.catchTag('ConfigError', (error) =>
      DEFINE_IMPORT.test(source)
        ? importStandalone(source)
        : Effect.fail(error),
    ),
  );
  return yield* decodeConfig(loaded).pipe(
    Effect.mapError((error) =>
      ConfigError.make({ message: `Invalid ${file}:\n${error.message}` }),
    ),
  );
});
