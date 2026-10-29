import { Array as Arr, pipe, Record as Rec, String as Str } from 'effect';

import type { GeneratedFile, Renderer } from '../../engine/types.ts';
import { workspaces } from '../root/workspaces.ts';
import { hasApp, owned } from '../shared.ts';
import { commented, type Jsonc, jsonc } from './jsonc.ts';
import type { TaskDef } from './model.ts';
import { mergeTasks, taskKey } from './refs.ts';

// The schema turbo ships matches the installed version and needs no network,
// so VS Code never asks to trust a remote schema host.
const schemaFrom = (dir: string) =>
  `${dir === '.' ? './' : Str.repeat(Str.split(dir, '/').length)('../')}node_modules/turbo/schema.json`;

const HEADER = `Task-inheritance pattern:
  "^task"        -> run \`task\` in all DEPENDENCY packages first
  "task"         -> run \`task\` in the SAME package first
  "//#task"      -> a root-only task (defined in root package.json)
  "pkg#task"     -> \`task\` in one named package
Leaf commands every package shares are task \`command\`s (argv, no shell),
defined here once instead of copied into each package.json. A package script
of the same name overrides one; \`"command": null\` in a package's turbo.jsonc
opts the package out. Other leaf commands are package scripts. Aggregates
(\`lint\`, \`lint:check\`) have neither: they only fan out through \`dependsOn\`,
so turbo is never called from a script.
A package turbo.jsonc inherits each root task: scalar fields carry over, and
an array field it sets replaces the root's array.
@see https://turborepo.dev/docs/reference/package-configurations#inheritance-behavior
The root depends on no internal package: turbo hashes the source of every
internal package the root depends on into the global hash, so one such
dependency misses cache for every task in the repo.
@see https://turborepo.dev/docs/crafting-your-repository/caching#root-workspace-dependencies`;

// Turbo spawns a `command` directly, without node_modules/.bin on PATH;
// `bun run` resolves the binary the way a package script would.
export const turboCommand = (argv: ReadonlyArray<string>) => [
  'bun',
  'run',
  ...argv,
];

// Cached leaf tasks only print logs on a miss; `transit` has no script.
const quietLogs = (task: TaskDef) =>
  task.root !== true &&
  task.name !== 'transit' &&
  task.cache !== false &&
  task.persistent !== true;

const turboTask = (task: TaskDef): Jsonc => {
  const body: Record<string, Jsonc | undefined> = {
    command:
      task.command === undefined ? undefined : turboCommand(task.command),
    dependsOn: task.dependsOn,
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
  // Apps and declared env vars read the environment, so APP_ENV (which picks
  // the env file every package loads) keys the cache.
  const readsEnv = ctx.config.apps.length > 0 || aggregate.env.length > 0;
  const declaredEnv = pipe(
    aggregate.env,
    Arr.map((v) => v.key),
    Arr.filter((key) => key !== 'APP_ENV'),
  );
  const commands = Arr.some(tasks, (task) => task.command !== undefined);
  const github = ctx.config.ci === 'github';

  const root = owned(
    'turbo.jsonc',
    jsonc({
      $schema: schemaFrom('.'),
      ui: 'tui',
      futureFlags: {
        experimentalTaskCommand: commands
          ? commented(
              'Task `command` is experimental; it lets every package share one\ndefinition of a leaf command instead of a copied script.',
              true,
            )
          : undefined,
        affectedUsingTaskInputs: commented(
          '`--affected` selects only the tasks whose `inputs` match the diff,\nnot every task in a changed package.',
          true,
        ),
        githubActionsRemoteBaseRefFallback: github
          ? commented(
              'actions/checkout leaves the PR base only as `origin/<base>`; without\nthis `--affected` cannot resolve it and runs every task.',
              true,
            )
          : undefined,
      },
      cacheMaxSize: commented(
        'Bounds the local cache, which CI also restores between runs.',
        '2GB',
      ),
      globalPassThroughEnv: commented(
        "Declared vars are read at run time (ports, deploy stages, secrets), not\nbaked into outputs, so they reach tasks without keying the cache. Vite's\nbuild-time VITE_* vars are hashed by turbo's framework inference. NIX_*\npasses through by default.",
        ['TMPDIR', ...declaredEnv],
      ),
      globalEnv: readsEnv ? ['APP_ENV'] : undefined,
      globalDependencies: [
        ...(hasApp(ctx.config, 'expo') ? ['bunfig.toml'] : []),
        'patches/**',
      ],
      tasks: commented(HEADER, tasksObject(ordered, taskKey)),
    }),
  );

  const dirs = new Map(
    Arr.map(workspaces(ctx), (w) => [w.name, w.dir] as const),
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
          $schema: schemaFrom(dir),
          extends: ['//'],
          tasks: tasksObject(pkgTasks, (task) => task.name),
        }),
      ),
    );
  }
  return [root, ...overrides];
};
