import { Array as Arr, pipe, Record as Rec } from 'effect';

import type { GeneratedFile, Renderer } from '../../engine/types.ts';
import { hasEnvPackage, workspaces } from '../root/workspaces.ts';
import { hasApp, owned } from '../shared.ts';
import { commented, type Jsonc, jsonc } from './jsonc.ts';
import type { TaskDef } from './model.ts';
import { mergeTasks, taskKey } from './refs.ts';

const HEADER = `Task-inheritance pattern:
  "^task"        -> run \`task\` in all DEPENDENCY packages first
  "with": [...]  -> run these tasks in parallel for the SAME package
  "//#task"      -> a root-only task (defined in root package.json)
Package scripts are leaf commands. Aggregates (\`lint\`, \`lint:check\`) have
no script: they only fan out, so turbo is never called from a script.
Turbo uses shallow extend: a package overriding a task must copy the whole
definition, it is not merged with the root one.
The root depends on no internal package: turbo hashes the source of every
internal package the root depends on into the global hash, so one such
dependency misses cache for every task in the repo.
@see https://turborepo.dev/docs/crafting-your-repository/caching#root-workspace-dependencies`;

// Cached leaf tasks only print logs on a miss; `transit` has no script.
const quietLogs = (task: TaskDef) =>
  task.root !== true &&
  task.name !== 'transit' &&
  task.cache !== false &&
  task.persistent !== true;

const turboTask = (task: TaskDef): Jsonc => {
  const body: Record<string, Jsonc | undefined> = {
    dependsOn: task.dependsOn,
    with: task.with,
    inputs: task.inputs,
    outputs: task.outputs,
    env: task.env,
    cache: task.cache,
    persistent: task.persistent,
    outputLogs: quietLogs(task) ? 'new-only' : undefined,
  };
  return task.comment === undefined ? body : commented(task.comment, body);
};

const tasksObject = (
  tasks: ReadonlyArray<TaskDef>,
  key: (task: TaskDef) => string,
) =>
  Rec.fromEntries(
    Arr.map(tasks, (task) => [key(task), turboTask(task)] as const),
  );

export const turboRenderer: Renderer = (ctx, aggregate) => {
  if (ctx.config.taskRunner !== 'turbo') return [];
  const tasks = mergeTasks(aggregate.tasks);
  const shared = Arr.filter(tasks, (task) => task.package === undefined);
  const ordered = [
    ...Arr.filter(shared, (task) => task.root !== true),
    ...Arr.filter(shared, (task) => task.root === true),
  ];
  const envPackage = hasEnvPackage(ctx.config, aggregate);
  const plainEnv = pipe(
    aggregate.env,
    Arr.filter((v) => !v.sensitive),
    Arr.map((v) => v.key),
  );
  const secretEnv = pipe(
    aggregate.env,
    Arr.filter((v) => v.sensitive),
    Arr.map((v) => v.key),
  );

  const root = owned(
    'turbo.jsonc',
    jsonc({
      $schema: 'https://turborepo.dev/schema.json',
      ui: 'tui',
      globalPassThroughEnv: ['NIX_*', 'TMPDIR', ...secretEnv],
      globalEnv: envPackage ? ['APP_ENV', ...plainEnv] : undefined,
      globalDependencies: [
        ...(hasApp(ctx.config, 'expo') ? ['bunfig.toml'] : []),
        'patches/**',
      ],
      tasks: commented(HEADER, tasksObject(ordered, taskKey)),
    }),
  );

  const dirs = new Map(
    Arr.map(workspaces(ctx, aggregate), (w) => [w.name, w.dir] as const),
  );
  const byPackage = Map.groupBy(
    Arr.filter(tasks, (task) => task.package !== undefined),
    (task) => task.package ?? '',
  );
  const overrides: Array<GeneratedFile> = [];
  for (const [pkg, pkgTasks] of byPackage) {
    const dir = dirs.get(pkg);
    if (dir === undefined) {
      throw new Error(`Task override for unknown workspace package ${pkg}`);
    }
    overrides.push(
      owned(
        `${dir}/turbo.jsonc`,
        jsonc({
          $schema: 'https://turborepo.dev/schema.json',
          extends: ['//'],
          tasks: tasksObject(pkgTasks, (task) => task.name),
        }),
      ),
    );
  }
  return [root, ...overrides];
};
