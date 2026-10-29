import {
  Array as Arr,
  Console,
  Effect,
  Option,
  Order,
  pipe,
  Predicate,
  Record as Rec,
  String as Str,
} from 'effect';

import {
  allDeps,
  allManifests,
  dirOf,
  invokes,
  isRecord,
  parseJsonc,
  scopeFor,
  type Workspace,
} from '../checks/workspace.ts';
import type { Repo } from '../engine/repo.ts';
import { versions } from '../versions.ts';
import { MigrationId } from './ids.ts';
import { dropTypeAwareFlags, pointAtConfig } from './oxlint-scripts.ts';
import { addRootDevDep, rewriteScripts, workspaceEditor } from './shared.ts';
import {
  collectComments,
  objectLiteral,
  quote,
  toTs,
  type Comments,
} from './ts-literal.ts';
import type { Migration } from './types.ts';

const ROOT_RCS = ['.oxlintrc.json', '.oxlintrc.jsonc'];
const SHARED = '@shoe-box-tools/oxlint-config';

// Plugins oxlint ships plus the jsPlugins defineShoeboxConfig registers. A
// rule from any other plugin would fail to resolve once its jsPlugins entry
// is gone, so it is listed for the user instead of kept.
const KNOWN_PLUGINS = new Set([
  'eslint',
  'typescript',
  'unicorn',
  'oxc',
  'import',
  'jsdoc',
  'node',
  'promise',
  'vitest',
  'jest',
  'react',
  'react-perf',
  'jsx-a11y',
  'nextjs',
  'vue',
  'regexp',
  'disable-comments',
  'env-access',
  'import-boundaries',
  'dynamic-import',
  'anti-slop',
  'anti-slop-effect',
  'route-active',
  'backdrop-filter',
  '@tanstack/query',
  'playwright',
  'testing-library',
  'effect',
]);
// Covered upstream now (anti-slop, @effect/tsgo presets).
const RETIRED = new Set(['unknown-cast', 'prefer-effect']);

const pluginOf = (rule: string) =>
  Option.match(Str.lastIndexOf('/')(rule), {
    onNone: () => 'eslint',
    onSome: (slash) => Str.slice(0, slash)(rule),
  });

const toError = (severity: unknown): unknown => {
  if (severity === 'warn' || severity === 1) return 'error';
  if (Arr.isArray(severity) && severity.length > 0) {
    const items: ReadonlyArray<unknown> = severity;
    const [level, ...rest] = items;
    return [toError(level), ...rest];
  }
  return severity;
};

const strings = (value: unknown) =>
  Arr.isArray(value) ? Arr.filter(value, Predicate.isString) : [];

interface Dropped {
  readonly retired: Array<string>;
  readonly unknown: Array<string>;
}

const cleanRules = (rules: unknown, dropped: Dropped) =>
  Rec.fromEntries(
    Arr.flatMap(
      Rec.toEntries(isRecord(rules) ? rules : {}),
      ([rule, severity]) => {
        const plugin = pluginOf(rule);
        if (RETIRED.has(plugin)) {
          dropped.retired.push(rule);
          return [];
        }
        if (!KNOWN_PLUGINS.has(plugin)) {
          dropped.unknown.push(rule);
          return [];
        }
        return [[rule, toError(severity)] as const];
      },
    ),
  );

const detectFlags = (workspace: Workspace) => {
  const deps = Arr.map(allManifests(workspace), (m) =>
    Rec.keys(allDeps(m.pkg)),
  );
  const any = (test: (dep: string) => boolean) =>
    Arr.some(deps, (list) => Arr.some(list, test));
  return {
    react: any((d) => d === 'react'),
    tanstackRouter: any(
      (d) => d === '@tanstack/react-router' || d === '@tanstack/react-start',
    ),
    tanstackQuery: any((d) => d === '@tanstack/react-query'),
    playwright: any((d) => d === '@playwright/test'),
    testingLibrary: any((d) => Str.startsWith('@testing-library/')(d)),
    web: any(
      (d) => d === 'react-dom' || d === 'vite' || d === '@tanstack/react-start',
    ),
  };
};

// Repo-relative form of a path written relative to `dir`.
const resolveIn = (dir: string, relative: string) => {
  const parts: Array<string> = [];
  for (const part of Str.split(`${dir}/${relative}`, '/')) {
    if (part === '..') parts.pop();
    else if (part !== '.' && part !== '') parts.push(part);
  }
  return Arr.join(parts, '/');
};

// A gitignore-style pattern of a nested config, made relative to the root.
// Without a `/` (trailing aside) it matched at any depth below `dir`.
const prefixIgnore = (dir: string, pattern: string) => {
  const negation = Str.startsWith('!')(pattern) ? '!' : '';
  const body = Str.slice(negation.length)(pattern);
  return pipe(body, Str.replace(/\/$/u, ''), Str.includes('/'))
    ? `${negation}${dir}/${Str.replace(/^\.?\//u, '')(body)}`
    : `${negation}${dir}/**/${body}`;
};

// An override glob of a nested config; oxlint matches one without a `/` at
// any depth.
const prefixGlob = (dir: string, pattern: string) =>
  Str.includes('/')(pattern)
    ? `${dir}/${Str.replace(/^\.\//u, '')(pattern)}`
    : `${dir}/**/${pattern}`;

// Keys a nested config can carry over. `plugins` / `jsPlugins` are dropped as
// at the root (the shared config loads its own); `extends` only when it
// points at the root config being replaced.
const NESTED_KEYS = new Set([
  '$schema',
  'extends',
  'plugins',
  'jsPlugins',
  'rules',
  'env',
  'globals',
  'ignorePatterns',
  'overrides',
]);

interface NestedResult {
  readonly overrides: ReadonlyArray<Record<string, unknown>>;
  readonly ignorePatterns: ReadonlyArray<string>;
  // Keys oxlint.config.ts cannot express; the file is kept for them.
  readonly kept: ReadonlyArray<string>;
}

// Nested configs that only `extends` the root (wisely's per-package files)
// carry nothing; otherwise rules/env/globals become a root override scoped
// to the dir, its overrides and ignores get the dir prefixed, and anything
// else keeps the file alive.
const nestedToRoot = (
  dir: string,
  value: unknown,
  rootRc: string,
  dropped: Dropped,
): NestedResult => {
  if (!isRecord(value)) {
    return { overrides: [], ignorePatterns: [], kept: ['(not a JSON object)'] };
  }
  const kept = Arr.filter(Rec.keys(value), (key) => !NESTED_KEYS.has(key));
  const extended = Arr.isArray(value.extends) ? value.extends : [];
  if (
    value.extends !== undefined &&
    !Arr.every(
      extended,
      (entry) => Predicate.isString(entry) && resolveIn(dir, entry) === rootRc,
    )
  ) {
    kept.push('extends');
  }
  const overrides: Array<Record<string, unknown>> = [];
  const rules = cleanRules(value.rules, dropped);
  const scoped: Record<string, unknown> = { files: [`${dir}/**`] };
  if (Rec.keys(rules).length > 0) scoped.rules = rules;
  for (const key of ['env', 'globals'] as const) {
    if (isRecord(value[key])) scoped[key] = value[key];
  }
  if (Rec.keys(scoped).length > 1) overrides.push(scoped);
  const nestedOverrides = Arr.isArray(value.overrides) ? value.overrides : [];
  for (const override of nestedOverrides) {
    if (!isRecord(override) || !Arr.isArray(override.files)) {
      if (!kept.includes('overrides')) kept.push('overrides');
      continue;
    }
    const { excludeFiles } = override;
    overrides.push({
      ...override,
      files: Arr.map(strings(override.files), (glob) => prefixGlob(dir, glob)),
      ...(Arr.isArray(excludeFiles)
        ? {
            excludeFiles: Arr.map(strings(excludeFiles), (glob) =>
              prefixGlob(dir, glob),
            ),
          }
        : {}),
      ...(override.rules === undefined
        ? {}
        : { rules: cleanRules(override.rules, dropped) }),
    });
  }
  return {
    overrides,
    ignorePatterns: Arr.map(strings(value.ignorePatterns), (pattern) =>
      prefixIgnore(dir, pattern),
    ),
    kept,
  };
};

const renderConfig = (input: {
  readonly source: string;
  readonly rc: Readonly<Record<string, unknown>>;
  readonly comments: Comments;
  readonly scope: string;
  readonly flags: Readonly<Record<string, boolean>>;
  readonly nestedDirs: ReadonlyArray<string>;
  readonly nestedOverrides: ReadonlyArray<Record<string, unknown>>;
  readonly nestedIgnores: ReadonlyArray<string>;
  readonly keptFiles: ReadonlyArray<readonly [string, ReadonlyArray<string>]>;
  readonly dropped: Dropped;
}) => {
  const { rc, comments, dropped } = input;
  const entries: Array<readonly [string, string, ReadonlyArray<string>?]> = [
    ['scope', quote(input.scope)],
  ];
  for (const [flag, on] of Rec.toEntries(input.flags)) {
    if (on) entries.push([flag, 'true']);
  }

  // A root ignore of a dir that had its own config (`apps/**`) only existed
  // because that config linted it; with one config it would hide the code.
  const ignores = Arr.filter(
    strings(rc.ignorePatterns),
    (pattern) =>
      !(
        Str.endsWith('/**')(pattern) &&
        Arr.some(input.nestedDirs, (dir) =>
          Str.startsWith(Str.slice(0, -2)(pattern))(`${dir}/`),
        )
      ),
  );
  const ignoreIndexes = Arr.flatMap(
    strings(rc.ignorePatterns),
    (pattern, index) => (ignores.includes(pattern) ? [index] : []),
  );
  if (ignores.length > 0 || input.nestedIgnores.length > 0) {
    const kept = new Map(
      Arr.map(
        ignoreIndexes,
        (from, to) =>
          [
            `ignorePatterns\0${to}`,
            comments.get(`ignorePatterns\0${from}`) ?? [],
          ] as const,
      ),
    );
    entries.push([
      'ignorePatterns',
      toTs([...ignores, ...input.nestedIgnores], kept, ['ignorePatterns'], 2),
      comments.get('ignorePatterns') ?? [],
    ]);
  }

  const overrides = [
    ...Arr.flatMap(
      Arr.isArray(rc.overrides) ? rc.overrides : [],
      (override: unknown) =>
        isRecord(override)
          ? [
              {
                ...override,
                ...(override.rules === undefined
                  ? {}
                  : { rules: cleanRules(override.rules, dropped) }),
              },
            ]
          : [],
    ),
    ...(isRecord(rc.env) || isRecord(rc.globals)
      ? [
          {
            files: ['**/*'],
            ...(isRecord(rc.env) ? { env: rc.env } : {}),
            ...(isRecord(rc.globals) ? { globals: rc.globals } : {}),
          },
        ]
      : []),
    ...input.nestedOverrides,
    // oxlint reads settings only at the root; a flat item without `files`
    // is merged there.
    ...(isRecord(rc.settings)
      ? [{ name: 'project/settings', settings: rc.settings }]
      : []),
  ];
  if (overrides.length > 0)
    entries.push([
      'overrides',
      toTs(overrides, comments, ['overrides'], 2),
      comments.get('overrides') ?? [],
    ]);

  const rules = cleanRules(rc.rules, dropped);
  if (Rec.keys(rules).length > 0)
    entries.push([
      'rules',
      toTs(rules, comments, ['rules'], 2),
      comments.get('rules') ?? [],
    ]);

  const notes = [
    `// Migrated from ${input.source} by \`shoebox migrate ${MigrationId.oxlintrcToTs}\`.`,
  ];
  const extended = strings(rc.extends);
  if (extended.length > 0)
    notes.push(
      `// Replaced extends (the shared config covers them): ${Arr.join(extended, ', ')}.`,
    );
  const offCategories = pipe(
    Rec.toEntries(isRecord(rc.categories) ? rc.categories : {}),
    Arr.filter(([, level]) => level === 'off'),
    Arr.map(([category]) => category),
  );
  if (offCategories.length > 0)
    notes.push(
      `// Categories that were off are now at error: ${Arr.join(offCategories, ', ')}.`,
    );
  if (dropped.retired.length > 0)
    notes.push(
      `// Dropped retired rules (covered upstream): ${Arr.join(new Set(dropped.retired), ', ')}.`,
    );
  if (dropped.unknown.length > 0) {
    notes.push(
      `// TODO: rules from plugins the shared config does not load were dropped;`,
      `// re-add their jsPlugins via an override if still wanted: ${Arr.join(new Set(dropped.unknown), ', ')}.`,
    );
  }
  for (const [file, keys] of input.keptFiles) {
    notes.push(
      `// TODO: ${file} was kept: its ${Arr.join(keys, ', ')} could not be carried`,
      `// over (oxlint reads settings, options and categories only at the root).`,
      `// Fold them in by hand, then delete it.`,
    );
  }
  return Arr.join(
    [
      `import { defineShoeboxConfig } from '${SHARED}';`,
      '',
      ...notes,
      `export default defineShoeboxConfig(${objectLiteral(entries)});`,
      '',
    ],
    '\n',
  );
};

const findRootRc = Effect.fnUntraced(function* (repo: Repo) {
  for (const path of ROOT_RCS) {
    const text = yield* repo.read(path);
    if (text !== undefined) return { path, text };
  }
  return undefined;
});

const RC = /\.oxlintrc\.jsonc?/u;

export const oxlintrcToTs: Migration = {
  id: MigrationId.oxlintrcToTs,
  description:
    'Convert .oxlintrc.json(c) (root and nested) into oxlint.config.ts using defineShoeboxConfig, warn -> error, and point scripts at it',
  applies: Effect.fnUntraced(function* (repo) {
    return (
      (yield* findRootRc(repo)) !== undefined &&
      !(yield* repo.exists('oxlint.config.ts'))
    );
  }),
  run: Effect.fnUntraced(function* (repo) {
    const rootRc = yield* findRootRc(repo);
    const context = yield* workspaceEditor(repo);
    if (rootRc === undefined || context === undefined) return [];
    const { workspace, editor } = context;
    const rc = parseJsonc(rootRc.text);
    if (!isRecord(rc)) return [];

    const dropped: Dropped = { retired: [], unknown: [] };
    const nested = Arr.sort(
      Arr.filter(
        [
          ...(yield* repo.glob('**/.oxlintrc.json')),
          ...(yield* repo.glob('**/.oxlintrc.jsonc')),
        ],
        Str.includes('/'),
      ),
      Order.String,
    );
    const nestedOverrides: Array<Record<string, unknown>> = [];
    const nestedIgnores: Array<string> = [];
    const keptFiles: Array<readonly [string, ReadonlyArray<string>]> = [];
    for (const path of nested) {
      const result = nestedToRoot(
        dirOf(path),
        parseJsonc((yield* repo.read(path)) ?? ''),
        rootRc.path,
        dropped,
      );
      nestedOverrides.push(...result.overrides);
      nestedIgnores.push(...result.ignorePatterns);
      // Deleting it would lose what could not be carried over.
      if (result.kept.length > 0) {
        keptFiles.push([path, result.kept]);
        yield* Console.log(
          `  note: kept ${path}: its ${Arr.join(result.kept, ', ')} could not be carried into oxlint.config.ts (see the TODO there)`,
        );
      } else {
        editor.set(path, undefined);
      }
    }

    editor.set(rootRc.path, undefined);
    editor.set(
      'oxlint.config.ts',
      renderConfig({
        source: rootRc.path,
        rc,
        comments: collectComments(rootRc.text),
        scope: scopeFor(workspace),
        flags: detectFlags(workspace),
        nestedDirs: Arr.map(nested, (path) => dirOf(path)),
        nestedOverrides,
        nestedIgnores,
        keptFiles,
        dropped,
      }),
    );

    rewriteScripts(editor, workspace, (command, _name, manifest) =>
      invokes(command, 'oxlint')
        ? pointAtConfig(
            dropTypeAwareFlags(command),
            'oxlint',
            manifest.dir,
            'oxlint.config.ts',
            RC,
          )
        : command,
    );
    addRootDevDep(editor, workspace, SHARED, versions[SHARED]);
    return editor.changes();
  }),
};
