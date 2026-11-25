import { defineKnipConfig } from 'shoemaker-knip-config';

export default defineKnipConfig({
  ignore: [
    // Reference clones of the repos shoemaker standardizes; read-only.
    '.external/**',
    // RuleTester fixture repo: its package.json files and modules exist only
    // to be resolved by the path-based rules under test.
    'packages/oxlint-plugins/test/fixtures/**',
  ],
  workspaces: {
    '.': {
      // Root scripts run by path from package.json, turbo and CI.
      entry: ['*.ts', 'scripts/**/*.ts'],
      // scripts/publish-package.ts spawns the pinned npm for trusted
      // publishing; knip does not see binaries run from child processes.
      ignoreDependencies: ['npm'],
    },
    // Not imported: pinned so installs of the published package resolve
    // @effect/platform-bun's `^` range to the same version as `effect`.
    'packages/cli': { ignoreDependencies: ['@effect/platform-node-shared'] },
    'packages/edgehog': {
      // Run by path: the recorder, the Worker it bundles, the benchmark, and
      // what a test runs under Bun.
      entry: [
        'scripts/record-sentry.ts',
        'scripts/sentry/worker.ts',
        'bench/local.ts',
        'bench/scratch/alchemy.run.ts',
        'bench/scratch/drive.ts',
        'test/support/bun-smoke.ts',
        'test/workers/{run,plain,kept,alchemy}.ts',
      ],
    },
    'packages/spanoptic': {
      ignoreDependencies: ['@effect/platform-node-shared'],
    },
  },
});
