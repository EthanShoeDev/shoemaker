import {
  Array as Arr,
  Console,
  Effect,
  FileSystem,
  Option,
  Path,
  String as Str,
} from 'effect';
import {
  Argument,
  CliError,
  Command,
  Flag,
  Prompt,
  TerminalCapabilities,
} from 'effect/cli';

import { CONFIG_PATH } from '../config/load.ts';
import { renderConfigFile } from '../config/render.ts';
import {
  type App,
  type AppKind,
  type Features,
  type Infra,
  type InfraProvider,
  type Package,
  decodeConfig,
  defaultConfig,
} from '../config/schema.ts';
import { applyPlan, writeFile, writeLock } from '../engine/apply.ts';
import { cliVersion } from '../engine/meta.ts';
import { makePlan, nextLock } from '../engine/plan.ts';
import { runInherit } from '../engine/process.ts';
import { makeRepo } from '../engine/repo-live.ts';
import { renderSummary } from '../engine/report.ts';
import { renderFiles } from '../engine/sync.ts';
import { fail, style } from './shared.ts';

const APP_KINDS: ReadonlyArray<AppKind> = [
  'tanstack-start',
  'foldkit',
  'expo',
  'effect-api',
  'effect-cli',
];

const APP_DESCRIPTIONS: Readonly<Record<AppKind, string>> = {
  'tanstack-start': 'TanStack Start web app',
  foldkit: 'Foldkit site',
  expo: 'Expo mobile app',
  'effect-api': 'Effect HTTP API',
  'effect-cli': 'Effect CLI',
};

const DEFAULT_APP_NAME: Readonly<Record<AppKind, string>> = {
  'tanstack-start': 'web',
  foldkit: 'site',
  expo: 'mobile',
  'effect-api': 'api',
  'effect-cli': 'cli',
};

const PROVIDERS: ReadonlyArray<InfraProvider> = ['cloudflare', 'aws'];
const EXTRAS = ['changesets', 'agents', 'vscode'] as const;
const KEBAB = /^[a-z][a-z0-9-]*$/u;

const isAppKind = (value: string): value is AppKind =>
  Arr.some(APP_KINDS, (kind) => kind === value);
const isProvider = (value: string): value is InfraProvider =>
  Arr.some(PROVIDERS, (provider) => provider === value);

const invalid = (option: string, value: string, expected: string) =>
  CliError.InvalidValue.make({ option, value, expected, kind: 'flag' });

const splitList = (value: string) =>
  Str.trim(value) === '' || Str.trim(value) === 'none'
    ? []
    : Arr.filter(
        Arr.map(Str.split(value, ','), (item) => Str.trim(item)),
        (item) => item !== '',
      );

const unused = (base: string, used: ReadonlySet<string>) => {
  let candidate = base;
  let n = 2;
  while (used.has(candidate)) {
    candidate = `${base}-${n}`;
    n += 1;
  }
  return candidate;
};

// The first app of a kind gets the kind's default name; repeats get `-2`, ...
export const nameApps = (
  requested: ReadonlyArray<{ readonly kind: AppKind; readonly name?: string }>,
  taken: ReadonlyArray<string> = [],
): ReadonlyArray<App> => {
  const used = new Set(taken);
  return Arr.map(requested, ({ kind, name }) => {
    // An explicit name is kept as is; a clash is reported by the caller.
    const candidate = name ?? unused(DEFAULT_APP_NAME[kind], used);
    used.add(candidate);
    return { kind, name: candidate };
  });
};

const kebab = (label: string, allowBlank: boolean) => (value: string) =>
  (allowBlank && value === '') || KEBAB.test(value)
    ? Effect.succeed(value)
    : Effect.fail(`${label} must be kebab-case (a-z, 0-9, -)`);

// `--apps tanstack-start,effect-api:server`
const parseApps = (value: string) =>
  Effect.forEach(splitList(value), (entry) => {
    const [kind, name] = Str.split(entry, ':');
    return isAppKind(kind) && (name === undefined || KEBAB.test(name))
      ? Effect.succeed(name === undefined ? { kind } : { kind, name })
      : Effect.fail(
          invalid(
            'apps',
            entry,
            `<kind>[:<name>], kind one of ${Arr.join(APP_KINDS, ', ')}`,
          ),
        );
  }).pipe(Effect.map((requested) => nameApps(requested)));

const toPackages = (names: ReadonlyArray<string>): ReadonlyArray<Package> =>
  Arr.map(names, (name) => ({ name, kind: 'library' }));

const parseLibraries = (value: string) => {
  const names = splitList(value);
  return Option.match(
    Arr.findFirst(names, (name) => !KEBAB.test(name)),
    {
      onNone: () => Effect.succeed(toPackages(names)),
      onSome: (bad) =>
        Effect.fail(invalid('libraries', bad, 'kebab-case package names')),
    },
  );
};

// `--infra none`, `--infra alchemy` (cloudflare) or `--infra alchemy:cloudflare,aws`
const parseInfra = (value: string) => {
  const [kind, list] = Str.split(value, ':');
  if (kind === 'none' && list === undefined) {
    return Effect.succeed<Infra>({ kind: 'none', providers: [] });
  }
  const providers = list === undefined ? ['cloudflare'] : splitList(list);
  return kind === 'alchemy' &&
    providers.length > 0 &&
    Arr.every(providers, isProvider)
    ? Effect.succeed<Infra>({
        kind: 'alchemy',
        providers: Arr.filter(providers, isProvider),
      })
    : Effect.fail(
        invalid('infra', value, 'none | alchemy | alchemy:<cloudflare,aws>'),
      );
};

const toFeatures = (extras: ReadonlyArray<string>): Features => ({
  changesets: extras.includes('changesets'),
  agents: extras.includes('agents'),
  vscode: extras.includes('vscode'),
});

const parseExtras = (value: string) => {
  const extras = splitList(value);
  return Option.match(
    Arr.findFirst(extras, (extra) => !Arr.some(EXTRAS, (e) => e === extra)),
    {
      onNone: () => Effect.succeed(toFeatures(extras)),
      onSome: (bad) =>
        Effect.fail(
          invalid('extras', bad, `${Arr.join(EXTRAS, ', ')} or none`),
        ),
    },
  );
};

const appsPrompt = Prompt.MultiSelect({
  message: 'Apps',
  choices: Arr.map(APP_KINDS, (kind) => ({
    title: kind,
    value: kind,
    description: APP_DESCRIPTIONS[kind],
  })),
}).pipe(
  Prompt.flatMap((kinds) =>
    kinds.length === 0
      ? Prompt.succeed<ReadonlyArray<App>>([])
      : Prompt.all(
          Arr.map(nameApps(Arr.map(kinds, (kind) => ({ kind }))), (app) =>
            Prompt.String({
              message: `Name for the ${app.kind} app`,
              default: app.name,
              validate: kebab('App name', false),
            }).pipe(Prompt.map((name): App => ({ kind: app.kind, name }))),
          ),
        ),
  ),
);

const infraPrompt = Prompt.Select({
  message: 'Infra',
  choices: [
    { title: 'none', value: 'none' as const },
    { title: 'alchemy', value: 'alchemy' as const, description: 'alchemy v2' },
  ],
}).pipe(
  Prompt.flatMap((kind) =>
    kind === 'none'
      ? Prompt.succeed<Infra>({ kind: 'none', providers: [] })
      : Prompt.MultiSelect({
          message: 'Alchemy providers',
          min: 1,
          choices: Arr.map(PROVIDERS, (provider) => ({
            title: provider,
            value: provider,
            selected: provider === 'cloudflare',
          })),
        }).pipe(
          Prompt.map((providers): Infra => ({ kind: 'alchemy', providers })),
        ),
  ),
);

// effect 4.0.6's withFallbackPrompt prompts even without a TTY, so gate it on
// TerminalCapabilities (which `--yes` switches off): failing with
// MissingOption lets the trailing Flag.optional fall back to the default.
const ask = <A>(option: string, prompt: Prompt.Prompt<A>) =>
  Effect.gen(function* () {
    const { canPrompt } = yield* TerminalCapabilities.TerminalCapabilities;
    if (!canPrompt) return yield* CliError.MissingOption.make({ option });
    return prompt;
  });

const fallback = <B>(option: string, prompt: Prompt.Prompt<B>) =>
  Flag.withFallbackPrompt(ask(option, prompt));

const defaults = defaultConfig('repo');

// Each answer is a flag that falls back to a prompt, and to the default when
// prompting is off (`--yes`, or no TTY). Struct order is prompt order.
const config = {
  directory: Argument.String('directory').pipe(
    Argument.withDescription('Where to create the repo'),
    Argument.withDefault('.'),
  ),
  name: Flag.String('name').pipe(
    Flag.withDescription('Repo name, kebab-case (default: directory name)'),
    fallback(
      'name',
      Prompt.String({
        message: 'Repo name (blank: directory name)',
        validate: kebab('Repo name', true),
      }),
    ),
    Flag.optional,
  ),
  scope: Flag.String('scope').pipe(
    Flag.withDescription(
      'npm scope for workspace packages, without @ (default: name)',
    ),
    fallback(
      'scope',
      Prompt.String({
        message: 'npm scope without @ (blank: repo name)',
        validate: kebab('Scope', true),
      }),
    ),
    Flag.optional,
  ),
  description: Flag.String('description').pipe(
    Flag.withDescription('Root package.json description'),
    fallback('description', Prompt.String({ message: 'Description' })),
    Flag.optional,
  ),
  apps: Flag.String('apps').pipe(
    Flag.withDescription(
      `Comma list of <kind>[:<name>] (${Arr.join(APP_KINDS, ', ')}), or none`,
    ),
    Flag.mapEffect(parseApps),
    fallback('apps', appsPrompt),
    Flag.optional,
  ),
  libraries: Flag.String('libraries').pipe(
    Flag.withDescription(
      'Comma list of library packages under packages/, or none',
    ),
    Flag.mapEffect(parseLibraries),
    fallback(
      'libraries',
      Prompt.String({
        message: 'Libraries under packages/ (comma separated, blank for none)',
      }).pipe(Prompt.map((value) => toPackages(splitList(value)))),
    ),
    Flag.optional,
  ),
  taskRunner: Flag.Literals('task-runner', ['turbo', 'nx']).pipe(
    Flag.withDescription('Task runner (default: turbo)'),
    fallback(
      'task-runner',
      Prompt.Select({
        message: 'Task runner',
        choices: [
          { title: 'turbo', value: 'turbo' as const },
          { title: 'nx', value: 'nx' as const },
        ],
      }),
    ),
    Flag.optional,
  ),
  secrets: Flag.Literals('secrets', ['varlock', 'secretspec', 'none']).pipe(
    Flag.withDescription('Secrets manager (default: varlock)'),
    fallback(
      'secrets',
      Prompt.Select({
        message: 'Secrets',
        choices: [
          { title: 'varlock', value: 'varlock' as const },
          { title: 'secretspec', value: 'secretspec' as const },
          { title: 'none', value: 'none' as const },
        ],
      }),
    ),
    Flag.optional,
  ),
  infra: Flag.String('infra').pipe(
    Flag.withDescription(
      'none | alchemy | alchemy:<cloudflare,aws> (default: none)',
    ),
    Flag.mapEffect(parseInfra),
    fallback('infra', infraPrompt),
    Flag.optional,
  ),
  ci: Flag.Literals('ci', ['github', 'none']).pipe(
    Flag.withDescription('CI provider (default: github)'),
    fallback(
      'ci',
      Prompt.Select({
        message: 'CI',
        choices: [
          { title: 'GitHub Actions', value: 'github' as const },
          { title: 'none', value: 'none' as const },
        ],
      }),
    ),
    Flag.optional,
  ),
  extras: Flag.String('extras').pipe(
    Flag.withDescription(
      'Comma list of changesets, agents, vscode, or none (default: agents,vscode)',
    ),
    Flag.mapEffect(parseExtras),
    fallback(
      'extras',
      Prompt.MultiSelect({
        message: 'Extras',
        choices: Arr.map(EXTRAS, (extra) => ({
          title: extra,
          value: extra,
          selected: defaults.features[extra],
        })),
      }).pipe(Prompt.map(toFeatures)),
    ),
    Flag.optional,
  ),
  nixPackages: Flag.String('nix-packages').pipe(
    Flag.withDescription(
      'Comma list of extra nixpkgs attributes for the dev shell',
    ),
    Flag.map(splitList),
    Flag.optional,
  ),
  unmanaged: Flag.String('unmanaged').pipe(
    Flag.withDescription('Comma list of paths shoebox must never write'),
    Flag.map(splitList),
    Flag.optional,
  ),
  yes: Flag.Boolean('yes').pipe(
    Flag.withAlias('y'),
    Flag.withDescription('Never prompt: use defaults for anything not passed'),
    Flag.withDefault(false),
  ),
  force: Flag.Boolean('force').pipe(
    Flag.withDescription('Write into a non-empty directory, overwriting files'),
    Flag.withDefault(false),
  ),
  git: Flag.Boolean('git').pipe(
    Flag.withDescription('Run git init (--no-git to skip)'),
    Flag.withDefault(true),
  ),
  install: Flag.Boolean('install').pipe(
    Flag.withDescription('Run bun install (--no-install to skip)'),
    Flag.withDefault(true),
  ),
} as const;

type InitInput = Command.Command.Config.Infer<typeof config>;

const blankToNone = (value: Option.Option<string>) =>
  Option.filter(value, (v) => Str.trim(v) !== '');

const toKebab = (value: string) =>
  Str.replaceAll(
    /^[^a-z]+|-+$/gu,
    '',
  )(Str.replaceAll(/[^a-z0-9-]+/gu, '-')(Str.toLowerCase(value)));

export const runInit = Effect.fnUntraced(function* (input: InitInput) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const s = yield* style;
  const root = path.resolve(input.directory);

  if ((yield* fs.exists(root)) && !input.force) {
    const entries = Arr.filter(
      yield* fs.readDirectory(root),
      (entry) => entry !== '.git',
    );
    if (entries.length > 0) {
      return yield* fail(
        `${root} is not empty. Use \`shoe-box adopt\` for an existing repo, or pass --force.`,
      );
    }
  }

  const name = Option.getOrElse(blankToNone(input.name), () =>
    toKebab(path.basename(root)),
  );
  const draft = {
    name,
    scope: Option.getOrElse(blankToNone(input.scope), () => name),
    description: Option.getOrElse(
      input.description,
      () => defaults.description,
    ),
    apps: Option.getOrElse(input.apps, () => defaults.apps),
    packages: Option.getOrElse(input.libraries, () => defaults.packages),
    taskRunner: Option.getOrElse(input.taskRunner, () => defaults.taskRunner),
    secrets: Option.getOrElse(input.secrets, () => defaults.secrets),
    infra: Option.getOrElse(input.infra, () => defaults.infra),
    ci: Option.getOrElse(input.ci, () => defaults.ci),
    features: Option.getOrElse(input.extras, () => defaults.features),
    nixPackages: Option.getOrElse(
      input.nixPackages,
      () => defaults.nixPackages,
    ),
    unmanaged: Option.getOrElse(input.unmanaged, () => defaults.unmanaged),
  };
  const shoeboxConfig = yield* decodeConfig(draft).pipe(
    Effect.catch((error) => fail(`Invalid answers:\n${error.message}`)),
  );

  const files = yield* renderFiles(shoeboxConfig);
  yield* fs.makeDirectory(root, { recursive: true });
  const repo = yield* makeRepo(root);
  const plan = yield* makePlan(repo, files, undefined, {
    force: input.force ? ['**'] : [],
  });
  yield* applyPlan(root, plan);
  yield* writeFile(root, CONFIG_PATH, renderConfigFile(shoeboxConfig));
  yield* writeLock(root, nextLock(undefined, plan, cliVersion));
  yield* Console.log(renderSummary(plan, s));
  yield* Console.log(s.green(`Created ${shoeboxConfig.name} in ${root}`));

  if (input.git && !(yield* fs.exists(path.join(root, '.git')))) {
    const code = yield* runInherit('git', ['init', '-q'], root);
    if (code !== 0) yield* Console.error(s.yellow('git init failed; skipped'));
    // Nix flakes only see git-tracked files, so stage everything (no commit)
    // or `nix develop` / `nix fmt` fail on the untracked flake.nix.
    else yield* runInherit('git', ['add', '-A'], root);
  }
  if (input.install) {
    const code = yield* runInherit('bun', ['install'], root);
    if (code !== 0) return yield* fail('bun install failed');
  }

  const relative = path.relative(process.cwd(), root);
  const cd = Str.startsWith('..')(relative) ? root : relative;
  yield* Console.log(
    Arr.join(
      [
        '',
        s.bold('Next steps'),
        ...(cd === '' ? [] : [`  cd ${cd}`]),
        ...(input.install ? [] : ['  bun install']),
        // lint:check is a task-runner aggregate, not a package script.
        shoeboxConfig.taskRunner === 'nx'
          ? `  bunx nx run-many -t lint:check && bunx nx run ${shoeboxConfig.name}:lint:check:root`
          : "  bunx turbo run lint:check '//#lint:check:root'",
        '  bunx shoe-box doctor',
      ],
      '\n',
    ),
  );
});

export const initCommand = Command.make('init', config, runInit).pipe(
  Command.withDescription(
    'Scaffold a new repo. Prompts for anything not passed as a flag; --yes takes defaults.',
  ),
);
