import playwright from 'eslint-plugin-playwright';
import testingLibrary from 'eslint-plugin-testing-library';
import type { ScopedConfigItem } from 'oxlint-flat-config';

import {
  declarationFiles,
  e2eFiles,
  routeFiles,
  testFiles,
  testingLibraryFiles,
  toolingFiles,
  vendoredFiles,
} from './globs.ts';
import { everyRuleOf } from './helpers.ts';

/** Ambient declaration files are scripts by design. */
export const declarationOverride = (
  files: Array<string> = declarationFiles,
): ScopedConfigItem => ({
  name: 'shoebox/dts',
  files,
  rules: {
    // An `export {}` would turn `declare module` blocks into augmentations and
    // make their globals file-local.
    'import/unambiguous': 'off',
  },
});

/** Test files: fixtures, doubles and harness output. */
export const testOverride = ({
  files = testFiles,
  react = false,
}: { files?: Array<string>; react?: boolean } = {}): ScopedConfigItem => ({
  name: 'shoebox/tests',
  files,
  rules: {
    // Mock callbacks are often empty.
    'no-empty-function': 'off',
    // `await import()` after vi.mock is the standard load; the reason is always the same.
    'dynamic-import/no-unexplained-dynamic-import': 'off',
    // Unique fixture ids are not the behaviour under test.
    'effecttsgo/crypto-random-uuid': 'off',
    // Same as crypto-random-uuid.
    'effecttsgo/crypto-random-uuid-in-effect': 'off',
    // Same as crypto-random-uuid.
    'effecttsgo/global-random': 'off',
    // Playwright specs and canaries talk to the server directly.
    'effecttsgo/global-fetch': 'off',
    // Shared suites take any layer and fixtures mint arbitrary-error effects.
    'effecttsgo/any-unknown-in-error-context': 'off',
    // Harness, perf and spec output goes to the runner's console.
    'effecttsgo/global-console': 'off',
    // Fixtures are literal dates; timing assertions read the wall clock.
    'effecttsgo/global-date-in-effect': 'off',
    // Each case provides its own layers.
    'effecttsgo/strict-effect-provide': 'off',
    // Fixtures spell out tagged records and third-party error shapes structurally.
    'anti-slop-effect/no-manual-tagged-construction': 'off',
    ...(react
      ? {
          // Playwright's `use()` and other non-hook `use*` helpers.
          'react/rules-of-hooks': 'off',
          // Test doubles record what they render into module-level probes.
          'react/globals': 'off',
          // Same as react/globals.
          'react/immutability': 'off',
        }
      : {}),
  },
});

/** Tool configs and plugins loaded by other tools; see toolingFiles. */
export const toolingOverride = (
  files: Array<string> = toolingFiles,
): ScopedConfigItem => ({
  name: 'shoebox/node-tooling',
  files,
  rules: {
    // Tooling touches the filesystem and child processes directly.
    'effecttsgo/node-builtin-import': 'off',
    // A CLI's report is its stdout.
    'effecttsgo/global-console': 'off',
    // Plain fetch outside Effect code in one-off scripts; Effect code still
    // goes through HttpClient (global-fetch-in-effect).
    'effecttsgo/global-fetch': 'off',
    // Scripts stamp reports and file names with the wall clock; nothing
    // replays them under a TestClock.
    'effecttsgo/global-date-in-effect': 'off',
    // Scripts read the environment directly; there is no app runtime to own it.
    'env-access/no-raw-env-access': 'off',
    // Scripts load optional SDKs on demand; the reason is the same everywhere.
    'dynamic-import/no-unexplained-dynamic-import': 'off',
    // Report rows are ad-hoc tagged literals.
    'anti-slop-effect/no-manual-tagged-construction': 'off',
  },
});

/**
 * Vendored upstream code keeps the upstream's form, even where it trips a
 * rule of ours: a refresh must stay a diff against upstream, so the lint
 * config absorbs the difference rather than the vendored file.
 */
export const vendoredOverride = (
  files: Array<string> = vendoredFiles,
): ScopedConfigItem => ({
  name: 'shoebox/vendored',
  files,
  rules: {
    // `Provider.effect(…, Effect.gen(…))` bodies that only build closures.
    'require-yield': 'off',
    // `Effect.fail(new TaggedError(…))`.
    'effecttsgo/unnecessary-fail-yieldable-error': 'off',
    // `.pipe(spawner.spawn)`.
    'effecttsgo/return-effect-in-gen': 'off',
    // Nested combinator calls in upstream form.
    'effecttsgo/missed-pipeable-opportunity': 'off',
    // `import` after an `export … from` block.
    'import/first': 'off',
    // `process.env` in upstream credential providers.
    'env-access/no-raw-env-access': 'off',
    // `Redacted.Redacted<string>`.
    'typescript/no-unnecessary-type-arguments': 'off',
    // Upstream passes methods unbound.
    'typescript/unbound-method': 'off',
    // Overload pairs.
    'typescript/unified-signatures': 'off',
    // `typeof x === 'string'` narrowing in upstream code.
    'anti-slop/no-runtime-typeof': 'off',
    // `(value: object)` helpers.
    'anti-slop/no-object-parameters': 'off',
    // `error._tag === …` predicates in `Effect.retry` while-clauses.
    'anti-slop-effect/no-manual-tag-comparison': 'off',
    // `Effect.catchIf((e) => e._tag === …)` in upstream form.
    'anti-slop-effect/no-manual-effect-error-tag': 'off',
    // Upstream fetchers call fetch inside Effect code.
    'effecttsgo/global-fetch-in-effect': 'off',
    // `node:crypto` hashes in upstream resource ids.
    'effecttsgo/node-builtin-import': 'off',
    // `new SomeError({ … })` for Schema.TaggedErrorClass errors.
    'effecttsgo/new-schema-class': 'off',
    // Upstream erases requirements with `as Effect.Effect<…>`.
    'effecttsgo/unsafe-effect-type-assertion': 'off',
    // `import { X } …; export { X }` re-exports.
    'unicorn/prefer-export-from': 'off',
    // In-place `.sort()` on freshly built arrays.
    'unicorn/no-array-sort': 'off',
  },
});

/** Playwright specs: every eslint-plugin-playwright rule at error. */
export const playwrightOverride = (
  files: Array<string> = e2eFiles,
): ScopedConfigItem => ({
  name: 'shoebox/playwright',
  files,
  rules: {
    // `test`/`expect` come from @playwright/test, not vitest.
    'vitest/prefer-importing-vitest-globals': 'off',
    // Playwright test and `toPass` callbacks are Promise-based; there is no Effect runner.
    'effecttsgo/async-function': 'off',
    ...everyRuleOf('playwright', playwright),
    // expect.soft everywhere would let a failed step keep driving the page.
    'playwright/require-soft-assertions': 'off',
    // Timeouts are tuned per call; a constant per value adds nothing.
    'playwright/no-magic-timeouts': 'off',
    // Suites are selected by project and testMatch, not tags.
    'playwright/require-tags': 'off',
    // Same as vitest/require-top-level-describe.
    'playwright/require-top-level-describe': 'off',
    // Same as vitest/max-expects.
    'playwright/max-expects': 'off',
    // Custom elements and structural selectors have no role/text handle.
    'playwright/no-raw-locators': 'off',
    // `.first()`/`.nth()` address repeated rows and cards.
    'playwright/no-nth-methods': 'off',
    // Same as vitest/no-conditional-in-test.
    'playwright/no-conditional-in-test': 'off',
    // Same as vitest/no-conditional-expect.
    'playwright/no-conditional-expect': 'off',
    // Setup projects and flows end in navigation or state, not an expect.
    'playwright/prefer-ending-with-an-expect': 'off',
    // `test.skip(condition, reason)` gates environment-dependent suites.
    'playwright/no-skipped-test': 'off',
    // `test.slow()` triples the timeout for the flows that need it.
    'playwright/no-slowed-test': 'off',
    // Same as vitest/prefer-lowercase-title.
    'playwright/prefer-lowercase-title': 'off',
    // Same as vitest/prefer-strict-equal.
    'playwright/prefer-strict-equal': 'off',
    // Same as vitest/expect-expect.
    'playwright/expect-expect': 'off',
    // Same as vitest/require-hook.
    'playwright/require-hook': 'off',
    // Same as vitest/no-hooks.
    'playwright/no-hooks': 'off',
    // Same as vitest/require-to-throw-message.
    'playwright/require-to-throw-message': 'off',
  },
});

/** Testing Library component tests: every rule at error. */
export const testingLibraryOverride = (
  files: Array<string> = testingLibraryFiles,
): ScopedConfigItem => ({
  name: 'shoebox/testing-library',
  files,
  rules: {
    ...everyRuleOf('testing-library', testingLibrary),
    // Conflicts with prefer-explicit-assert, which we keep.
    'testing-library/prefer-implicit-assert': 'off',
  },
});

/** TanStack Router file routes. */
export const routesOverride = (
  files: Array<string> = routeFiles,
): ScopedConfigItem => ({
  name: 'shoebox/routes',
  files,
  rules: {
    // File routes export `Route` beside their component by contract; the
    // router plugin, not React Fast Refresh, owns their hot reload.
    'react/only-export-components': 'off',
  },
});
