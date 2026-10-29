import { Array as Arr, Console, Effect, Option } from 'effect';
import { Argument, Command, Flag } from 'effect/cli';

import { loadConfig } from '../config/load.ts';
import { ensureCleanTree, writeLock } from '../engine/apply.ts';
import { formatContent, formatFiles } from '../engine/format.ts';
import { emptyLock, type Lock, readLock } from '../engine/lock.ts';
import { cliVersion } from '../engine/meta.ts';
import { rebaseline } from '../engine/plan.ts';
import { makeRepo } from '../engine/repo-live.ts';
import type { Repo } from '../engine/repo.ts';
import { renderDiff } from '../engine/report.ts';
import { renderFiles } from '../engine/sync.ts';
import { migrations, withChanges } from '../migrations/index.ts';
import type { Migration } from '../migrations/types.ts';
import { applyChanges, cwdFlag, fail, resolveRoot, style } from './shared.ts';

export const runMigrate = Effect.fnUntraced(function* (input: {
  readonly id: Option.Option<string>;
  readonly list: boolean;
  readonly dryRun: boolean;
  readonly allowDirty: boolean;
  readonly cwd: string;
}) {
  const s = yield* style;
  const root = yield* resolveRoot(input.cwd);
  const repo = yield* makeRepo(root);
  const lock = (yield* readLock(repo)) ?? emptyLock(cliVersion);
  const applied = new Set(lock.migrations);

  if (input.list) {
    for (const migration of migrations) {
      const status = applied.has(migration.id)
        ? s.dim('applied')
        : (yield* migration.applies(repo))
          ? s.yellow('pending')
          : s.dim('n/a    ');
      yield* Console.log(
        `  ${status} ${migration.id} ${s.dim(`- ${migration.description}`)}`,
      );
    }
    if (migrations.length === 0) yield* Console.log('No migrations defined.');
    return;
  }

  let selected: ReadonlyArray<Migration>;
  if (Option.isSome(input.id)) {
    const found = Arr.findFirst(
      migrations,
      (m) => m.id === input.id.pipe(Option.getOrUndefined),
    );
    if (Option.isNone(found)) {
      return yield* fail(
        `Unknown migration ${input.id.value}. See \`shoebox migrate --list\`.`,
      );
    }
    const migration = found.value;
    if (applied.has(migration.id)) {
      yield* Console.log(`${migration.id} is already applied.`);
      return;
    }
    if (!(yield* migration.applies(repo))) {
      yield* Console.log(`${migration.id} does not apply to this repo.`);
      return;
    }
    selected = [migration];
  } else {
    selected = yield* Effect.filter(
      Arr.filter(migrations, (m) => !applied.has(m.id)),
      (m) => m.applies(repo),
    );
  }

  if (selected.length === 0) {
    yield* Console.log('No pending migrations.');
    return;
  }
  if (!input.dryRun && !input.allowDirty) yield* ensureCleanTree(root);

  const ran: Array<string> = [];
  // Content before the first migration touched each path, for rebaselining.
  const originals = new Map<string, string | undefined>();
  // Several migrations edit the same files (package.json), so each one runs
  // against the result of the previous: on disk when applying, through an
  // overlay when dry-running. `applies` is re-checked for the same reason.
  let view = repo;
  for (const migration of selected) {
    if (!(yield* migration.applies(view))) {
      yield* Console.log(
        s.dim(`${migration.id} no longer applies after earlier migrations.`),
      );
      continue;
    }
    yield* Console.log(
      `${s.bold(migration.id)} ${s.dim(`- ${migration.description}`)}`,
    );
    // Formatted like sync output, so a migrated repo passes oxfmt:check and
    // the first `shoebox sync` afterwards is not a formatting diff.
    const changes = yield* Effect.forEach(
      yield* migration.run(view),
      (change) =>
        change.content === undefined
          ? Effect.succeed(change)
          : Effect.map(
              formatContent(change.path, change.content),
              (content) => ({
                ...change,
                content,
              }),
            ),
    );
    for (const change of changes) {
      const before = yield* view.read(change.path);
      if (!originals.has(change.path)) originals.set(change.path, before);
      if (!input.dryRun) continue;
      yield* Console.log(
        change.content === undefined
          ? `  ${s.red('delete')} ${change.path}`
          : renderDiff(
              {
                path: change.path,
                strategy: 'owned',
                action: before === undefined ? 'create' : 'update',
                before,
                after: change.content,
                executable: false,
                generated: {
                  path: change.path,
                  content: change.content,
                  strategy: 'owned',
                },
              },
              s,
            ),
      );
    }
    if (input.dryRun) {
      view = withChanges(view, changes);
    } else {
      yield* applyChanges(root, changes);
      ran.push(migration.id);
    }
  }

  if (ran.length > 0) {
    yield* writeLock(root, {
      ...lock,
      migrations: [...lock.migrations, ...ran],
      files: yield* rebaselined(root, repo, lock, originals),
    });
    yield* Console.log(
      s.green(`Applied ${ran.length} migration(s); recorded in the lock.`),
    );
  }
});

// The generated files, for lock entries written before owned sets were
// recorded. Best effort: without a loadable config those entries keep their
// old baseline and the next sync reports them as it would have before.
const generatedContent = (root: string) =>
  Effect.gen(function* () {
    const files = yield* formatFiles(
      yield* renderFiles(yield* loadConfig(root)),
    );
    return new Map(
      Arr.map(files, (file) => [file.path, file.content] as const),
    );
  }).pipe(Effect.orElseSucceed(() => new Map<string, string>()));

// A migration is shoebox's own edit: a tracked file that matched its baseline
// before the migration gets the migrated content as its new baseline, so the
// next sync does not report it as hand-edited.
const rebaselined = Effect.fnUntraced(function* (
  root: string,
  repo: Repo,
  lock: Lock,
  originals: ReadonlyMap<string, string | undefined>,
) {
  const files = { ...lock.files };
  const needsGenerated = Arr.some([...originals.keys()], (path) => {
    const entry = files[path];
    return (
      entry !== undefined &&
      entry.owned === undefined &&
      (entry.strategy === 'managed' || entry.strategy === 'json-merge')
    );
  });
  const generated = needsGenerated
    ? yield* generatedContent(root)
    : new Map<string, string>();
  for (const [path, before] of originals) {
    const entry = files[path];
    const after = yield* repo.read(path);
    if (entry === undefined || before === undefined || after === undefined) {
      continue;
    }
    const next = rebaseline(entry, path, before, after, generated.get(path));
    if (next !== undefined) files[path] = next;
  }
  return files;
});

export const migrateCommand = Command.make(
  'migrate',
  {
    id: Argument.String('id').pipe(
      Argument.withDescription(
        'Migration id (default: every pending migration)',
      ),
      Argument.optional,
    ),
    list: Flag.Boolean('list').pipe(
      Flag.withDescription('List migrations and whether each is pending'),
      Flag.withDefault(false),
    ),
    dryRun: Flag.Boolean('dry-run').pipe(
      Flag.withDescription('Print the changes without writing'),
      Flag.withDefault(false),
    ),
    allowDirty: Flag.Boolean('allow-dirty').pipe(
      Flag.withDescription(
        'Write even when the git tree has uncommitted changes',
      ),
      Flag.withDefault(false),
    ),
    cwd: cwdFlag,
  },
  runMigrate,
).pipe(Command.withDescription('Run one-shot structural migrations'));
