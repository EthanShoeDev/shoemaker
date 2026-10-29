import {
  Array as Arr,
  Console,
  Effect,
  FileSystem,
  Option,
  Path,
} from 'effect';
import { Argument, Command, Flag } from 'effect/cli';

import { insertListEntry } from '../config/edit.ts';
import { CONFIG_PATH, loadConfig } from '../config/load.ts';
import { renderConfigFile, renderInlineEntry } from '../config/render.ts';
import {
  type App,
  AppKind,
  type Package,
  type ShoeboxConfig,
  decodeConfig,
} from '../config/schema.ts';
import { ensureCleanTree, writeFile } from '../engine/apply.ts';
import { canonicalJson } from '../engine/json.ts';
import { nameApps } from './init.ts';
import { type CommandFailed, cwdFlag, fail, resolveRoot } from './shared.ts';
import { runSync } from './sync.ts';

const shared = {
  allowDirty: Flag.Boolean('allow-dirty').pipe(
    Flag.withDescription(
      'Write even when the git tree has uncommitted changes',
    ),
    Flag.withDefault(false),
  ),
  cwd: cwdFlag,
};

const takenNames = (config: ShoeboxConfig) => [
  ...Arr.map(config.apps, (app) => app.name),
  ...Arr.map(config.packages, (pkg) => pkg.name),
];

type Addition =
  | { readonly key: 'apps'; readonly entry: App }
  | { readonly key: 'packages'; readonly entry: Package };

const withAddition = (config: ShoeboxConfig, addition: Addition) =>
  addition.key === 'apps'
    ? { ...config, apps: [...config.apps, addition.entry] }
    : { ...config, packages: [...config.packages, addition.entry] };

// shoebox.config.ts is the user's file: re-rendering it is only safe when it
// is exactly what shoebox renders; otherwise the entry is spliced into its
// array literal and the result re-loaded to prove it decodes to `next`. On
// any doubt the original bytes go back and false is returned.
const writeConfig = Effect.fnUntraced(function* (
  root: string,
  current: ShoeboxConfig,
  next: ShoeboxConfig,
  addition: Addition,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const source = yield* fs.readFileString(path.join(root, CONFIG_PATH));
  if (source === renderConfigFile(current)) {
    yield* writeFile(root, CONFIG_PATH, renderConfigFile(next));
    return true;
  }
  const edited = insertListEntry(source, addition.key, addition.entry);
  if (edited === undefined) return false;
  yield* writeFile(root, CONFIG_PATH, edited);
  const reloaded = yield* loadConfig(root).pipe(Effect.option);
  if (
    Option.isSome(reloaded) &&
    canonicalJson(reloaded.value) === canonicalJson(next)
  ) {
    return true;
  }
  yield* writeFile(root, CONFIG_PATH, source);
  return false;
});

// load -> add an entry -> write shoebox.config.ts -> sync. The clean-tree
// check runs before the config write, which would otherwise make the tree
// dirty.
const updateConfig = Effect.fnUntraced(function* (
  input: { readonly cwd: string; readonly allowDirty: boolean },
  pick: (config: ShoeboxConfig) => Effect.Effect<Addition, CommandFailed>,
) {
  const root = yield* resolveRoot(input.cwd);
  const config = yield* loadConfig(root);
  const addition = yield* pick(config);
  const next = yield* decodeConfig(withAddition(config, addition)).pipe(
    Effect.catchTag('SchemaError', (issue) => fail(issue.message)),
  );
  if (!input.allowDirty) yield* ensureCleanTree(root);
  if (!(yield* writeConfig(root, config, next, addition))) {
    yield* Console.log(
      `${CONFIG_PATH} has hand-written parts shoebox cannot edit safely, so it was left untouched.\nAdd this entry to its \`${addition.key}\` array, then run \`shoebox sync\`:\n\n  ${renderInlineEntry(addition.entry)},`,
    );
    return yield* fail(`${CONFIG_PATH} not updated`);
  }
  yield* Console.log(`Updated ${CONFIG_PATH}`);
  yield* runSync({ root, dryRun: false, force: [], allowDirty: true });
});

const addApp = Command.make(
  'app',
  {
    kind: Argument.Literals('kind', AppKind.literals).pipe(
      Argument.withDescription('App kind'),
    ),
    name: Argument.String('name').pipe(
      Argument.withDescription('App name (default: from the kind)'),
      Argument.optional,
    ),
    ...shared,
  },
  (input) =>
    updateConfig(input, (config) => {
      const taken = takenNames(config);
      const [app] = nameApps(
        [
          Option.match(input.name, {
            onNone: () => ({ kind: input.kind }),
            onSome: (name) => ({ kind: input.kind, name }),
          }),
        ],
        taken,
      );
      if (app === undefined || taken.includes(app.name)) {
        return fail(
          `An app or package named ${app?.name ?? ''} already exists`,
        );
      }
      return Effect.succeed({ key: 'apps', entry: app } as const);
    }),
).pipe(Command.withDescription('Add an app to shoebox.config.ts and sync'));

const addPackage = Command.make(
  'package',
  {
    name: Argument.String('name').pipe(
      Argument.withDescription('Library package name (kebab-case)'),
    ),
    ...shared,
  },
  (input) =>
    updateConfig(input, (config) =>
      takenNames(config).includes(input.name)
        ? fail(`An app or package named ${input.name} already exists`)
        : Effect.succeed({
            key: 'packages',
            entry: { name: input.name, kind: 'library' },
          } as const),
    ),
).pipe(Command.withDescription('Add a library package and sync'));

export const addCommand = Command.make('add').pipe(
  Command.withDescription('Add an app or package to the repo'),
  Command.withSubcommands([addApp, addPackage]),
);
