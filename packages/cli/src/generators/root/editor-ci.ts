import type { ShoemakerConfig } from '../../config/schema.ts';
import type { Generator } from '../../engine/types.ts';
import { hasApp, json, owned, seed } from '../shared.ts';
import { jsonc } from '../task-runner/jsonc.ts';

const vscodeSettings = (config: ShoemakerConfig) => ({
  'editor.formatOnSave': true,
  'editor.defaultFormatter': 'oxc.oxc-vscode',
  'editor.codeActionsOnSave': { 'source.fixAll.oxc': 'explicit' },
  'oxc.typeAware': true,
  'oxc.path.oxfmt': 'node_modules/oxfmt/bin/oxfmt',
  '[jsonc]': { 'editor.defaultFormatter': 'oxc.oxc-vscode' },
  '[typescript]': { 'editor.defaultFormatter': 'oxc.oxc-vscode' },
  '[typescriptreact]': { 'editor.defaultFormatter': 'oxc.oxc-vscode' },
  'direnv.restart.automatic': false,
  'js/ts.experimental.useTsgo': true,
  'js/ts.tsdk.path': 'node_modules/typescript/lib',
  'files.watcherExclude': {
    '**/.git/objects/**': true,
    '**/node_modules/**': true,
    '**/.turbo/**': true,
    '**/.nx/**': true,
    '**/.direnv/**': true,
    '**/dist/**': true,
    '**/.output/**': true,
    '**/coverage/**': true,
    '**/result': true,
    '**/docs/cloned-repos-as-docs/**': true,
  },
  ...(hasApp(config, 'tanstack-start')
    ? {
        'tailwindCSS.classAttributes': ['class', 'className'],
        'tailwindCSS.classFunctions': ['cn', 'clsx', 'cva'],
      }
    : {}),
});

const extensions = (config: ShoemakerConfig) => [
  'oxc.oxc-vscode',
  'mkhl.direnv',
  'jnoortheen.nix-ide',
  'effectful-tech.effect-vscode',
  'vitest.explorer',
  'oven.bun-vscode',
  ...(hasApp(config, 'tanstack-start')
    ? ['bradlc.vscode-tailwindcss', 'ms-playwright.playwright']
    : []),
  ...(hasApp(config, 'expo') ? ['expo.vscode-expo-tools'] : []),
  ...(config.taskRunner === 'nx'
    ? ['nrwl.angular-console']
    : ['vercel.turbo-vsc']),
];

export const vscode: Generator = (ctx) =>
  ctx.config.features.vscode
    ? {
        files: [
          owned(
            '.vscode/settings.json',
            jsonc(vscodeSettings(ctx.config), { json: true }),
          ),
          owned(
            '.vscode/extensions.json',
            jsonc({ recommendations: extensions(ctx.config) }, { json: true }),
          ),
        ],
      }
    : {};

const SETUP_ACTION = `name: Setup
description: Install the pinned bun and the frozen lockfile.
runs:
  using: composite
  steps:
    - uses: oven-sh/setup-bun@v2
      with:
        # Keep in lockstep with package.json packageManager and flake.nix.
        bun-version: 1.4.4
    # --frozen-lockfile: CI must never mutate the lockfile. Retried because it
    # reaches the npm registry, which fails independently of the diff.
    - name: Install
      shell: bash
      run: |
        for attempt in 1 2 3; do
          bun install --frozen-lockfile && exit 0
          echo "::warning::bun install attempt $attempt failed; retrying"
          sleep $((attempt * 10))
        done
        exit 1
`;

const lintSteps = (config: ShoemakerConfig) =>
  config.taskRunner === 'nx'
    ? `      - run: bunx nx affected -t lint:check
        env:
          NX_BASE: \${{ github.event_name == 'pull_request' && format('origin/{0}', github.base_ref) || github.event.before }}
          NX_HEAD: \${{ github.sha }}
      - run: bunx nx run ${config.name}:lint:check:root`
    : `      - run: bunx turbo run lint:check '//#lint:check:root' --affected --continue=dependencies-successful`;

const ciWorkflow = (config: ShoemakerConfig) => `name: CI

on:
  push:
    branches: [main]
  pull_request:

concurrency:
  group: ci-\${{ github.ref }}
  cancel-in-progress: true

env:
  TURBO_TELEMETRY_DISABLED: 1
  NX_NO_CLOUD: true

jobs:
  lint:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v4
        with:
          # Affected detection diffs against the base commit.
          fetch-depth: 0
      - uses: ./.github/actions/setup
      # Fails when generated tooling files were hand-edited or the repo is
      # behind shoemaker.config.ts; fix with \`shoemaker sync\`.
      - run: bunx shoemaker sync --check --allow-dirty
${lintSteps(config)}

  test:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v4
      - uses: ./.github/actions/setup
      - run: bun run test
`;

export const ci: Generator = (ctx) =>
  ctx.config.ci === 'github'
    ? {
        files: [
          owned('.github/actions/setup/action.yml', SETUP_ACTION),
          owned('.github/workflows/ci.yml', ciWorkflow(ctx.config)),
        ],
      }
    : {};

const CHANGESET_README = `# Changesets

Run \`bun run changeset\` to describe a change that should ship in the next
release; \`bun run changeset:version\` applies the pending changesets.
See https://github.com/changesets/changesets for the full workflow.
`;

export const changesets: Generator = (ctx) =>
  ctx.config.features.changesets
    ? {
        files: [
          seed(
            '.changeset/config.json',
            json({
              changelog: [
                '@changesets/changelog-github',
                { repo: `EthanShoeDev/${ctx.config.name}` },
              ],
              commit: false,
              fixed: [],
              linked: [],
              access: 'restricted',
              baseBranch: 'main',
              updateInternalDependencies: 'patch',
              ignore: [],
            }),
          ),
          seed('.changeset/README.md', CHANGESET_README),
        ],
      }
    : {};
