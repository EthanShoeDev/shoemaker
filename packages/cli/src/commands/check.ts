import { Array as Arr, Console, Effect, Option } from 'effect';
import { Argument, Command, Flag } from 'effect/cli';

import { repoChecks } from '../checks/index.ts';
import { makeRepo } from '../engine/repo-live.ts';
import { applyChanges, cwdFlag, fail, resolveRoot, style } from './shared.ts';

const listChecks = Effect.gen(function* () {
  const s = yield* style;
  for (const check of repoChecks) {
    yield* Console.log(`  ${check.name} ${s.dim(`- ${check.description}`)}`);
  }
});

export const runCheck = Effect.fnUntraced(function* (input: {
  readonly name: Option.Option<string>;
  readonly list: boolean;
  readonly fix: boolean;
  readonly cwd: string;
}) {
  const s = yield* style;
  if (input.list) return yield* listChecks;
  if (Option.isNone(input.name)) {
    yield* listChecks;
    return yield* fail('Pass a check name.');
  }
  const name = input.name.value;
  const found = Arr.findFirst(repoChecks, (c) => c.name === name);
  if (Option.isNone(found)) {
    yield* Console.error(`Unknown check ${name}. Available:`);
    yield* listChecks;
    return yield* fail(`Unknown check ${name}`);
  }
  const check = found.value;

  const root = yield* resolveRoot(input.cwd);
  const repo = yield* makeRepo(root);
  let result = yield* check.run(repo, { fix: input.fix });
  if (input.fix && result.fixes.length > 0) {
    yield* applyChanges(root, result.fixes);
    // Re-run so the exit code reflects the fixed repo.
    result = yield* check.run(repo, { fix: false });
  }
  if (result.report !== '') yield* Console.log(result.report);
  if (!result.ok) {
    if (!input.fix && result.fixes.length > 0) {
      yield* Console.log(s.dim(`Fixable: shoemaker check ${name} --fix`));
    }
    return yield* fail(`check ${name} failed`);
  }
});

export const checkCommand = Command.make(
  'check',
  {
    name: Argument.String('name').pipe(
      Argument.withDescription('Check to run (see --list)'),
      Argument.optional,
    ),
    list: Flag.Boolean('list').pipe(
      Flag.withDescription('List available checks'),
      Flag.withDefault(false),
    ),
    fix: Flag.Boolean('fix').pipe(
      Flag.withDescription('Apply the check fixes'),
      Flag.withDefault(false),
    ),
    cwd: cwdFlag,
  },
  runCheck,
).pipe(
  Command.withDescription(
    'Run a repo checker (catalog, effect-versions, ...); exits 1 on failure',
  ),
);
