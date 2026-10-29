import { defineConfig } from 'vitest/config';

// One project per package with tests. The cli suites need Bun APIs
// (Bun.Glob) and oxlint's RuleTester needs node, so the root `test` script
// runs the cli project under `bun --bun` and the rest under node.
export default defineConfig({
  test: {
    projects: [
      'packages/cli',
      'packages/oxfmt-config',
      'packages/oxlint-config',
      'packages/oxlint-plugins',
      'packages/spanoptic',
    ],
  },
});
