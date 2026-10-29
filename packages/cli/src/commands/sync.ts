import { Array as Arr, Console, Effect } from 'effect';
import { Command, Flag } from 'effect/cli';

import { loadConfig } from '../config/load.ts';
import type { ShoeboxConfig } from '../config/schema.ts';
import { applyPlan, ensureCleanTree, writeLock } from '../engine/apply.ts';
import { LOCK_PATH, renderLock } from '../engine/lock.ts';
import { cliVersion } from '../engine/meta.ts';
import { isBlocked, isWrite, nextLock } from '../engine/plan.ts';
import { renderDiffs, renderSummary } from '../engine/report.ts';
import { planRepo } from '../engine/sync.ts';
import { cwdFlag, fail, resolveRoot, style } from './shared.ts';

export interface SyncOptions {
  readonly root: string;
  readonly dryRun: boolean;
  // Dry run that fails when anything would change: drift detection for CI.
  readonly check?: boolean;
  readonly force: ReadonlyArray<string>;
  readonly allowDirty: boolean;
  readonly verbose?: boolean;
  // Skip loading shoebox.config.ts (adopt passes the inferred config).
  readonly config?: ShoeboxConfig;
}

// Plans, prints and (unless dry-run) applies. Fails when conflicts or
// untracked files are left unresolved, so scripts see a non-zero exit.
export const runSync = Effect.fnUntraced(function* (options: SyncOptions) {
  const s = yield* style;
  const config = options.config ?? (yield* loadConfig(options.root));
  const { repo, lock, plan } = yield* planRepo(options.root, config, {
    force: options.force,
  });
  const verbose = options.verbose === true ? { verbose: true } : {};
  yield* Console.log(renderSummary(plan, s, verbose));
  const blocked = Arr.filter(plan.files, isBlocked);

  if (options.dryRun || options.check === true) {
    const diffs = renderDiffs(plan, s, verbose);
    if (diffs !== '') yield* Console.log(`\n${diffs}`);
  } else {
    if (Arr.some(plan.files, isWrite) && !options.allowDirty) {
      yield* ensureCleanTree(options.root);
    }
    yield* applyPlan(options.root, plan);
    const next = nextLock(lock, plan, cliVersion);
    if ((yield* repo.read(LOCK_PATH)) !== renderLock(next)) {
      yield* writeLock(options.root, next);
    }
  }

  if (blocked.length > 0) {
    yield* Console.log(
      s.yellow(
        `\n${blocked.length} file(s) not synced. Merge them by hand, or take the generated version with --force '<glob>'.`,
      ),
    );
    return yield* fail('unresolved conflicts');
  }
  if (options.check === true && Arr.some(plan.files, isWrite)) {
    return yield* fail(
      'repo has drifted from shoebox.config.ts; run `shoe-box sync`',
    );
  }
  return plan;
});

export const syncCommand = Command.make(
  'sync',
  {
    dryRun: Flag.Boolean('dry-run').pipe(
      Flag.withDescription('Print the plan and diffs without writing'),
      Flag.withDefault(false),
    ),
    check: Flag.Boolean('check').pipe(
      Flag.withDescription(
        'Dry run that exits 1 when any file would change (CI drift check)',
      ),
      Flag.withDefault(false),
    ),
    force: Flag.String('force').pipe(
      Flag.withDescription(
        'Take the generated version for conflicting files matching this glob (repeatable)',
      ),
      Flag.atLeast(0),
    ),
    allowDirty: Flag.Boolean('allow-dirty').pipe(
      Flag.withDescription(
        'Write even when the git tree has uncommitted changes',
      ),
      Flag.withDefault(false),
    ),
    verbose: Flag.Boolean('verbose').pipe(
      Flag.withDescription(
        'List unchanged and skipped files, and diff new files too',
      ),
      Flag.withDefault(false),
    ),
    cwd: cwdFlag,
  },
  Effect.fnUntraced(function* (input) {
    const root = yield* resolveRoot(input.cwd);
    yield* runSync({ ...input, root });
  }),
).pipe(
  Command.withDescription(
    'Re-render the repo from shoebox.config.ts and apply safe changes',
  ),
);
