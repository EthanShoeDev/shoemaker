import { defineConfig } from 'vitest/config';

// One project per package with tests, all under node: oxlint's RuleTester needs
// it. The cli's e2e suite spawns the CLI under bun, as users run it.
export default defineConfig({
  test: {
    projects: [
      'packages/admin',
      'packages/cli',
      'packages/edgehog',
      'packages/oxfmt-config',
      'packages/oxlint-config',
      'packages/oxlint-plugins',
      'packages/spanoptic',
    ],
  },
});
