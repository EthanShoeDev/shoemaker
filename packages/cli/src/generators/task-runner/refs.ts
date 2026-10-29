import { Option, pipe, String as Str } from 'effect';

import type { TaskDef } from './model.ts';

// A `dependsOn` entry in turbo syntax, parsed so the nx renderer and
// the tests can reason about it.
export type TaskRef =
  | { readonly kind: 'dependencies'; readonly task: string }
  | { readonly kind: 'self'; readonly task: string }
  | { readonly kind: 'root'; readonly task: string }
  | { readonly kind: 'package'; readonly pkg: string; readonly task: string };

export const parseRef = (ref: string): TaskRef => {
  if (Str.startsWith('^')(ref)) {
    return { kind: 'dependencies', task: Str.slice(1)(ref) };
  }
  if (Str.startsWith('//#')(ref)) {
    return { kind: 'root', task: Str.slice(3)(ref) };
  }
  // `@scope/pkg#task`: the scope's `@` never contains `#`.
  const hash = pipe(
    ref,
    Str.indexOf('#'),
    Option.filter((index) => index > 0),
  );
  if (Option.isSome(hash)) {
    return {
      kind: 'package',
      pkg: Str.slice(0, hash.value)(ref),
      task: Str.slice(hash.value + 1)(ref),
    };
  }
  return { kind: 'self', task: ref };
};

// The turbo key a task is defined under in the root turbo.jsonc.
export const taskKey = (task: TaskDef) =>
  task.root === true ? `//#${task.name}` : task.name;

const union = (
  a: ReadonlyArray<string> | undefined,
  b: ReadonlyArray<string> | undefined,
) =>
  a === undefined && b === undefined
    ? undefined
    : [...new Set([...(a ?? []), ...(b ?? [])])];

// Two generators may contribute the same task (an app adding outputs to
// `build`): arrays union, later scalars win.
export const mergeTasks = (tasks: ReadonlyArray<TaskDef>) => {
  const byKey = new Map<string, TaskDef>();
  for (const task of tasks) {
    const key = `${task.package ?? ''}|${taskKey(task)}`;
    const prev = byKey.get(key);
    if (prev === undefined) {
      byKey.set(key, task);
      continue;
    }
    const dependsOn = union(prev.dependsOn, task.dependsOn);
    const inputs = union(prev.inputs, task.inputs);
    const outputs = union(prev.outputs, task.outputs);
    const env = union(prev.env, task.env);
    byKey.set(key, {
      ...prev,
      ...task,
      ...(dependsOn === undefined ? {} : { dependsOn }),
      ...(inputs === undefined ? {} : { inputs }),
      ...(outputs === undefined ? {} : { outputs }),
      ...(env === undefined ? {} : { env }),
    });
  }
  return [...byKey.values()];
};

// Aggregates (`lint`, `lint:check`, `//#lint:root`) have no script: they
// only fan out through `dependsOn`.
export const isAggregate = (task: TaskDef) => task.aggregate === true;
