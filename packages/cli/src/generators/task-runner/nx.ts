import { Array as Arr, pipe, Record as Rec, String as Str } from 'effect';

import type { GeneratedFile, Renderer } from '../../engine/types.ts';
import { workspaces } from '../root/workspaces.ts';
import { owned } from '../shared.ts';
import { type Jsonc, jsonc } from './jsonc.ts';
import type { TaskDef } from './model.ts';
import { isAggregate, mergeTasks, parseRef } from './refs.ts';

// Translates the turbo-syntax TaskDef graph to nx:
// - `^x` -> `{ dependencies: true, target: x }`, `//#x` -> the root project.
// - `with` has no nx equivalent; aggregates become `nx:noop` targets whose
//   `dependsOn` is the fan-out.
// - `transit` exists only to pull dependency hashes into turbo; nx gets the
//   same effect from the `^default` input, so the target is dropped.
// - nx targetDefaults never create a target, so every project gets
//   project.json stubs for the aggregates, filled in from targetDefaults.

type NxDependsOn =
  | string
  | { readonly target: string; readonly dependencies: true }
  | { readonly target: string; readonly projects: ReadonlyArray<string> };

const TRANSIT = 'transit';
const NX_JSON = { json: true };

const mapDependsOn = (
  refs: ReadonlyArray<string>,
  rootProject: string,
  inRoot: boolean,
) =>
  Arr.flatMap(refs, (ref): ReadonlyArray<NxDependsOn> => {
    const parsed = parseRef(ref);
    if (parsed.task === TRANSIT) return [];
    if (parsed.kind === 'dependencies') {
      return [{ dependencies: true, target: parsed.task }];
    }
    if (parsed.kind === 'self') return [parsed.task];
    if (parsed.kind === 'package') {
      return [{ projects: [parsed.pkg], target: parsed.task }];
    }
    return inRoot
      ? [parsed.task]
      : [{ projects: [rootProject], target: parsed.task }];
  });

const mapInput = (input: string, inRoot: boolean) => {
  const base = inRoot ? '{workspaceRoot}' : '{projectRoot}';
  const negated = Str.startsWith('!')(input);
  const path = negated ? Str.slice(1)(input) : input;
  if (path === '$TURBO_DEFAULT$')
    return inRoot ? '{workspaceRoot}/**/*' : 'default';
  const mapped = Str.startsWith('$TURBO_ROOT$/')(path)
    ? `{workspaceRoot}/${Str.slice('$TURBO_ROOT$/'.length)(path)}`
    : `${base}/${path}`;
  return negated ? `!${mapped}` : mapped;
};

const nxTarget = (task: TaskDef, rootProject: string) => {
  const inRoot = task.root === true;
  const readsDependencies = (task.dependsOn ?? []).includes(`^${TRANSIT}`);
  const dependsOn = mapDependsOn(
    [...(task.dependsOn ?? []), ...(task.with ?? [])],
    rootProject,
    inRoot,
  );
  // Root tasks are whole-repo checkers, so their default input is every file,
  // not just the files no package owns.
  const declared =
    task.inputs === undefined
      ? inRoot
        ? ['{workspaceRoot}/**/*']
        : undefined
      : Arr.map(task.inputs, (input) => mapInput(input, inRoot));
  const inputs = [
    ...(declared ?? (readsDependencies ? ['default'] : [])),
    ...(readsDependencies ? ['^default'] : []),
    ...Arr.map(task.env ?? [], (env) => ({ env })),
  ];
  const aggregate = isAggregate(task);
  const cache = !aggregate && task.cache !== false && task.persistent !== true;
  return {
    ...(aggregate ? { executor: 'nx:noop' } : {}),
    ...(inRoot && !aggregate
      ? { executor: 'nx:run-script', options: { script: task.name } }
      : {}),
    ...(dependsOn.length > 0 ? { dependsOn } : {}),
    ...(inputs.length > 0 && !aggregate ? { inputs } : {}),
    ...(task.outputs === undefined
      ? {}
      : {
          outputs: Arr.map(
            task.outputs,
            (output) => `{projectRoot}/${Str.replace(/\/\*\*$/u, '')(output)}`,
          ),
        }),
    ...(aggregate ? {} : { cache }),
    ...(task.persistent === true ? { continuous: true } : {}),
  };
};

const targets = (
  tasks: ReadonlyArray<TaskDef>,
  rootProject: string,
): Record<string, Jsonc> =>
  pipe(
    tasks,
    Arr.filter((task) => task.name !== TRANSIT),
    Arr.map((task) => [task.name, nxTarget(task, rootProject)] as const),
    Rec.fromEntries,
  );

export const nxRenderer: Renderer = (ctx, aggregate) => {
  if (ctx.config.taskRunner !== 'nx') return [];
  const rootProject = ctx.config.name;
  const tasks = mergeTasks(aggregate.tasks);
  const shared = Arr.filter(
    tasks,
    (task) => task.package === undefined && task.root !== true,
  );
  const rootTasks = Arr.filter(tasks, (task) => task.root === true);
  const aggregates = pipe(
    shared,
    Arr.filter(isAggregate),
    Arr.map((task) => task.name),
  );

  const nxJson = owned(
    'nx.json',
    jsonc(
      {
        $schema: './node_modules/nx/schemas/nx-schema.json',
        neverConnectToCloud: true,
        analytics: false,
        namedInputs: {
          default: ['{projectRoot}/**/*', 'sharedGlobals'],
          sharedGlobals: [
            '{workspaceRoot}/bunfig.toml',
            '{workspaceRoot}/patches/**/*',
            { env: 'APP_ENV' },
          ],
          production: [
            'default',
            '!{projectRoot}/**/*.md',
            '!{projectRoot}/test/**/*',
            '!{projectRoot}/**/*.test.ts',
          ],
        },
        targetDefaults: targets(shared, rootProject),
      },
      NX_JSON,
    ),
  );

  const rootJson = owned(
    'project.json',
    jsonc(
      {
        $schema: './node_modules/nx/schemas/project-schema.json',
        name: rootProject,
        targets: targets(rootTasks, rootProject),
      },
      NX_JSON,
    ),
  );

  const byPackage = Map.groupBy(
    Arr.filter(tasks, (task) => task.package !== undefined),
    (task) => task.package ?? '',
  );
  const known = workspaces(ctx, aggregate);
  for (const pkg of byPackage.keys()) {
    if (!Arr.some(known, (w) => w.name === pkg)) {
      throw new Error(`Task override for unknown workspace package ${pkg}`);
    }
  }
  const projects: ReadonlyArray<GeneratedFile> = Arr.map(known, (workspace) =>
    owned(
      `${workspace.dir}/project.json`,
      jsonc(
        {
          $schema: '../../node_modules/nx/schemas/project-schema.json',
          name: workspace.name,
          targets: {
            ...Rec.fromEntries(
              Arr.map(aggregates, (name) => [name, {}] as const),
            ),
            ...targets(byPackage.get(workspace.name) ?? [], rootProject),
          },
        },
        NX_JSON,
      ),
    ),
  );
  return [nxJson, rootJson, ...projects];
};
