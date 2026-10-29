import { defineConfig } from 'oxlint';
import { defineShoeboxConfig } from 'shoe-box-oxlint-config';

export default defineConfig(
  defineShoeboxConfig({
    scope: 'shoe-box',
    ignorePatterns: [
      // Reference clones of the repos shoebox standardizes; read-only.
      '.external/**',
      // The vendored anti-slop plugin (packages/oxlint-plugins/src/vendor/anti-slop/UPSTREAM.md)
      // is linted upstream; its own rules flag the patterns it is written with.
      'packages/oxlint-plugins/src/vendor/**',
    ],
    overrides: [
      {
        // Rule options and package.json manifests arrive as untyped JSON, and
        // the published config and plugin packages deliberately carry no
        // effect dependency, so effect/Schema is not there to decode them with.
        files: [
          'packages/oxlint-plugins/**',
          'packages/oxlint-config/**',
          'packages/oxfmt-config/**',
          'packages/knip-config/**',
        ],
        rules: {
          // `typeof` is the only narrowing available without effect/Schema.
          'anti-slop/no-runtime-typeof': 'off',
          // Native array methods are all there is without effect/Array.
          'effecttsgo/prefer-effect-array': 'off',
          // Native Object.keys/entries are all there is without effect/Record.
          'effecttsgo/prefer-effect-record': 'off',
          // Native string methods are all there is without effect/String.
          'effecttsgo/prefer-effect-string': 'off',
        },
      },
      {
        // The config factory resolves plugin paths with node:url at load time,
        // inside oxlint's Node host; there is no Effect runtime there.
        files: ['packages/oxlint-config/**'],
        rules: {
          // node:url's fileURLToPath turns import.meta.resolve into a path.
          'effecttsgo/node-builtin-import': 'off',
        },
      },
      {
        // The e2e harness is a linear Bun shell script that drives the CLI's
        // internals (generate, renderConfigFile) before anything is published.
        files: [
          'scripts/e2e/**',
          'scripts/lib/**',
          'scripts/publish-manifest.ts',
        ],
        rules: {
          // Reaching into packages/cli/src is the point: it tests unpublished code.
          'import-boundaries/no-cross-package-relative-imports': 'off',
          // Sequential shell steps; an Effect runtime adds nothing here.
          'effecttsgo/async-function': 'off',
          // The exit code is the harness's whole output contract for CI.
          'unicorn/no-process-exit': 'off',
        },
      },
    ],
  }),
);
