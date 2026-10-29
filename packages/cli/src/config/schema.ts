import { Schema } from 'effect';

// The wizard answers persisted in a repo's `shoemaker.config.ts`. Everything
// that is "set in stone" (oxlint, oxfmt, jscpd, knip, nix, bun, Effect) is not
// modelled here: it is always generated. Only per-project structural choices
// live in this schema, so `shoemaker sync` can re-render a repo from it.

export const AppKind = Schema.Literals([
  'tanstack-start',
  'foldkit',
  'expo',
  'effect-api',
  'effect-cli',
]);
export type AppKind = typeof AppKind.Type;

export const PackageKind = Schema.Literals(['library']);
export type PackageKind = typeof PackageKind.Type;

export const TaskRunner = Schema.Literals(['turbo', 'nx']);
export type TaskRunner = typeof TaskRunner.Type;

export const SecretsManager = Schema.Literals([
  'varlock',
  'secretspec',
  'none',
]);
export type SecretsManager = typeof SecretsManager.Type;

// Where the root alchemy.run.ts deploys the apps shoemaker scaffolds. `none`
// still generates the Stack, for resources added by hand.
export const DeployTarget = Schema.Literals(['cloudflare', 'aws', 'none']);
export type DeployTarget = typeof DeployTarget.Type;

// Where alchemy keeps deploy state. `local` is the gitignored `.alchemy/`
// folder; the remote stores are created on first use, even by a plan.
export const StateStore = Schema.Literals(['local', 'cloudflare', 'aws']);
export type StateStore = typeof StateStore.Type;

export const Ci = Schema.Literals(['github', 'none']);
export type Ci = typeof Ci.Type;

const KebabName = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9-]*$/u));

export const App = Schema.Struct({
  name: KebabName,
  kind: AppKind,
});
export type App = typeof App.Type;

export const Package = Schema.Struct({
  name: KebabName,
  kind: PackageKind,
});
export type Package = typeof Package.Type;

export const Infra = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('none') }),
  Schema.Struct({
    kind: Schema.Literal('alchemy'),
    deploy: DeployTarget,
    state: StateStore,
  }),
]);
export type Infra = typeof Infra.Type;

export const Features = Schema.Struct({
  changesets: Schema.Boolean,
  agents: Schema.Boolean,
  vscode: Schema.Boolean,
});
export type Features = typeof Features.Type;

export const ShoemakerConfig = Schema.Struct({
  // Repo name (kebab-case). Root package.json `name`.
  name: KebabName,
  // npm scope for workspace packages, without the `@` (e.g. `listening`).
  scope: KebabName,
  description: Schema.String,
  apps: Schema.Array(App),
  packages: Schema.Array(Package),
  taskRunner: TaskRunner,
  secrets: SecretsManager,
  infra: Infra,
  ci: Ci,
  features: Features,
  // Extra nixpkgs attribute names added to the default dev shell.
  nixPackages: Schema.Array(Schema.String),
  // Repo-relative paths shoemaker must never write, even if a generator emits them.
  unmanaged: Schema.Array(Schema.String),
});
export type ShoemakerConfig = typeof ShoemakerConfig.Type;

export const defaultConfig = (name: string): ShoemakerConfig => ({
  name,
  scope: name,
  description: '',
  apps: [],
  packages: [],
  taskRunner: 'turbo',
  secrets: 'varlock',
  infra: { kind: 'none' },
  ci: 'github',
  features: { changesets: false, agents: true, vscode: true },
  nixPackages: [],
  unmanaged: [],
});

export const decodeConfig = Schema.decodeUnknownEffect(ShoemakerConfig);
