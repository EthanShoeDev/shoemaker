import { Array as Arr } from 'effect';

import type { Generator } from '../../engine/types.ts';
import type { TaskDef } from './model.ts';

const oxlintInputs = [
  '$TURBO_DEFAULT$',
  '!**/*.md',
  '$TURBO_ROOT$/oxlint.config.ts',
];
const rootTsInputs = ['*.ts', 'tsconfig.json'];
const manifests = [
  'package.json',
  'apps/*/package.json',
  'packages/*/package.json',
];

const packageTasks: ReadonlyArray<TaskDef> = [
  {
    name: 'transit',
    dependsOn: ['^transit'],
    comment:
      'Tests, typecheck and type-aware lint read workspace sources, not build\noutput, so they depend on this no-op instead of `^build`: dependency\nhashes still flow in, nothing gets built.',
  },
  {
    name: 'build',
    dependsOn: ['^build'],
    outputs: ['dist/**', '.output/**'],
  },
  {
    name: 'dev',
    dependsOn: ['^build'],
    cache: false,
    persistent: true,
  },
  {
    name: 'typecheck',
    dependsOn: ['^transit'],
    inputs: ['$TURBO_DEFAULT$', '!**/*.md'],
  },
  {
    name: 'test',
    dependsOn: ['^transit'],
  },
  {
    name: 'clean',
    cache: false,
  },
  {
    name: 'oxlint:check',
    dependsOn: ['^transit'],
    inputs: oxlintInputs,
    comment:
      'oxlint runs per package so an edit re-lints only the packages whose\nsources or type dependencies changed. Type-aware rules read dependency\ntypes, so the `^transit` edge carries their hashes.',
  },
  {
    name: 'oxlint:fix',
    dependsOn: ['^transit'],
    inputs: oxlintInputs,
  },
  {
    name: 'lint:check',
    with: ['oxlint:check', 'typecheck', '//#lint:check:root'],
    comment:
      "`lint` and `lint:check` have no script on purpose: a task with a command\nstops its `with` tasks when it exits (turborepo#14163), which would cancel\na package's typecheck as soon as its oxlint finished.",
  },
  {
    name: 'lint',
    with: ['oxlint:fix', 'typecheck', '//#lint:root'],
  },
];

const rootChecks = [
  'typecheck',
  'oxlint:check',
  'oxfmt:check',
  'jscpd:check',
  'knip:check',
  'catalog:check',
  'effect-versions:check',
  'nix:fmt:check',
];

const rootFixes = [
  'typecheck',
  'oxlint:fix',
  'oxfmt:fix',
  'jscpd:check',
  'knip:fix:danger',
  'catalog:fix',
  'effect-versions:check',
  'nix:fmt:fix',
];

const root = (task: Omit<TaskDef, 'root'>): TaskDef => ({
  ...task,
  root: true,
});

const rootTasks: ReadonlyArray<TaskDef> = [
  root({
    name: 'lint:check:root',
    with: Arr.map(rootChecks, (name) => `//#${name}`),
    comment:
      '=== Root-only tasks (bodies live in root package.json scripts) ===\nRepo-wide checkers. Packages reach them through `lint:check`; CI runs\n`//#lint:check:root` directly so they run even when no package changed.',
  }),
  root({ name: 'lint:root', with: Arr.map(rootFixes, (name) => `//#${name}`) }),
  root({
    name: 'typecheck',
    inputs: rootTsInputs,
    comment:
      'The root package checks only root-level files (configs); every package\nchecks itself.',
  }),
  root({ name: 'oxlint:check', inputs: rootTsInputs }),
  root({ name: 'oxlint:fix', inputs: rootTsInputs }),
  root({ name: 'oxfmt:check' }),
  root({ name: 'oxfmt:fix', cache: false }),
  root({ name: 'jscpd:check' }),
  root({
    name: 'knip:check',
    comment:
      '`knip:fix:danger` deletes what knip believes is dead; a missing entry in\nknip.ts makes it delete live code, so review its diff like a codemod.',
  }),
  root({ name: 'knip:fix:danger', cache: false }),
  root({ name: 'catalog:check', inputs: manifests }),
  root({ name: 'catalog:fix', cache: false }),
  root({ name: 'effect-versions:check', inputs: ['bun.lock'] }),
  root({ name: 'nix:fmt:check', inputs: ['flake.nix', 'flake.lock'] }),
  root({ name: 'nix:fmt:fix', cache: false }),
];

export const baseTasks: Generator = (ctx) => ({
  tasks: [...packageTasks, ...rootTasks],
  catalog: [ctx.config.taskRunner],
  gitignore:
    ctx.config.taskRunner === 'nx' ? ['.nx/cache', '.nx/workspace-data'] : [],
});
