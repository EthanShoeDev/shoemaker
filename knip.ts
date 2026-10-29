import { defineKnipConfig } from 'shoe-box-knip-config';

export default defineKnipConfig({
  ignore: [
    // Reference clones of the repos shoebox standardizes; read-only.
    '.external/**',
    // RuleTester fixture repo: its package.json files and modules exist only
    // to be resolved by the path-based rules under test.
    'packages/oxlint-plugins/test/fixtures/**',
  ],
  workspaces: {
    '.': {
      // Root scripts run by path from package.json, turbo and CI.
      entry: ['*.ts', 'scripts/**/*.ts'],
    },
  },
});
