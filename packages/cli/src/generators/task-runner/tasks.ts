import { Array as Arr } from 'effect';

import type { GenContext, Generator } from '../../engine/types.ts';
import { workspaces } from '../root/workspaces.ts';
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

// Leaf commands every workspace package runs. Under turbo they are defined
// once, here, instead of copied into every package.json.
export const packageCommands = {
  clean: ['rm', '-rf', 'dist', '.turbo'],
  typecheck: ['tsc', '--noEmit'],
  test: ['vitest', 'run'],
  'oxlint:check': ['oxlint', '-c', '../../oxlint.config.ts', '.'],
  'oxlint:fix': ['oxlint', '-c', '../../oxlint.config.ts', '--fix', '.'],
};

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
    cache: false,
    persistent: true,
    comment:
      'Internal packages export source, so a dev server builds nothing first.',
  },
  {
    name: 'typecheck',
    command: packageCommands.typecheck,
    dependsOn: ['^transit'],
    inputs: ['$TURBO_DEFAULT$', '!**/*.md'],
  },
  {
    name: 'test',
    command: packageCommands.test,
    dependsOn: ['^transit'],
  },
  {
    name: 'clean',
    command: packageCommands.clean,
    cache: false,
  },
  {
    name: 'oxlint:check',
    command: packageCommands['oxlint:check'],
    dependsOn: ['^transit'],
    inputs: oxlintInputs,
    comment:
      'oxlint runs per package so an edit re-lints only the packages whose\nsources or type dependencies changed. Type-aware rules read dependency\ntypes, so the `^transit` edge carries their hashes.',
  },
  {
    name: 'oxlint:fix',
    command: packageCommands['oxlint:fix'],
    inputs: oxlintInputs,
    cache: false,
    comment:
      'Fixers are never cached: a hit on the pre-fix hash would replay the old\nrun and leave the files unfixed.',
  },
  {
    name: 'lint:check',
    aggregate: true,
    dependsOn: ['oxlint:check', 'typecheck', '//#lint:check:root'],
  },
  {
    name: 'lint',
    aggregate: true,
    dependsOn: ['oxlint:fix', 'typecheck', '//#lint:root'],
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

const rootTasks = (ctx: GenContext): ReadonlyArray<TaskDef> => [
  root({
    name: 'lint:check:root',
    aggregate: true,
    dependsOn: Arr.map(rootChecks, (name) => `//#${name}`),
    comment:
      '=== Root-only tasks (bodies live in root package.json scripts) ===\nRepo-wide checkers. Packages reach them through `lint:check`; CI runs\n`//#lint:check:root` directly so they run even when no package changed.',
  }),
  root({
    name: 'lint:root',
    aggregate: true,
    dependsOn: Arr.map(rootFixes, (name) => `//#${name}`),
  }),
  root({
    name: 'typecheck',
    inputs: rootTsInputs,
    comment:
      'The root package checks only root-level files (configs); every package\nchecks itself.',
  }),
  root({ name: 'oxlint:check', inputs: rootTsInputs }),
  root({ name: 'oxlint:fix', inputs: rootTsInputs, cache: false }),
  root({ name: 'oxfmt:check' }),
  root({
    name: 'oxfmt:fix',
    dependsOn: [
      '//#oxlint:fix',
      '//#catalog:fix',
      ...Arr.map(workspaces(ctx), (w) => `${w.name}#oxlint:fix`),
    ],
    cache: false,
    comment:
      'Fixers that write the same files run one after another: oxlint and\ncatalog fixes first, then oxfmt formats what they wrote, then knip. knip\ngoes last so no other fix pulls it in.',
  }),
  root({ name: 'jscpd:check' }),
  root({
    name: 'knip:check',
    comment:
      '`knip:fix:danger` deletes what knip believes is dead; a missing entry in\nknip.ts makes it delete live code, so review its diff like a codemod.',
  }),
  root({ name: 'knip:fix:danger', dependsOn: ['//#oxfmt:fix'], cache: false }),
  root({ name: 'catalog:check', inputs: manifests }),
  root({ name: 'catalog:fix', cache: false }),
  root({ name: 'effect-versions:check', inputs: ['bun.lock'] }),
  root({ name: 'nix:fmt:check', inputs: ['flake.nix', 'flake.lock'] }),
  root({ name: 'nix:fmt:fix', cache: false }),
];

export const baseTasks: Generator = (ctx) => ({
  tasks: [...packageTasks, ...rootTasks(ctx)],
  catalog: [ctx.config.taskRunner],
  gitignore:
    ctx.config.taskRunner === 'nx' ? ['.nx/cache', '.nx/workspace-data'] : [],
});
