import { defineConfig } from 'vitest/config';

// One project per package with tests. The cli suites need Bun APIs
// (Bun.semver) and oxlint's RuleTester needs node, so the root `test` script
// runs the cli project under `bun --bun` and the rest under node.
//
// That is also why the root catalog holds vitest at exactly 5.1.0. 5.1.1's
// fork-pool watchdog calls `child.channel?.unref()`; Bun (still on 1.4.5)
// gives a forked child an empty `channel` stub with no `ref`/`unref`, so the
// call throws and the cli suite dies before its first test. Generated repos
// run vitest under node and take ^5.1.1 (versions.ts).
// - vitest-dev/vitest#12037: reported against 5.1.1 + Bun 1.4.5; closed as a
//   Bun bug.
// - oven-sh/bun#33593: the missing `channel` methods; open since 2026-07.
//   Fix PRs #33595, #36405 and #45662 all closed unmerged.
// Lift the hold once #33593 ships: `bun --bun vitest run --project cli` on
// vitest 5.1.1 must start.
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
