import { Array as Arr, Effect, Predicate, Record as Rec } from 'effect';

import { invokes, isRecord, parseJsonc } from '../checks/workspace.ts';
import type { Repo } from '../engine/repo.ts';
import { versions } from '../versions.ts';
import { MigrationId } from './ids.ts';
import { pointAtConfig } from './oxlint-scripts.ts';
import { addRootDevDep, rewriteScripts, workspaceEditor } from './shared.ts';
import { collectComments, objectLiteral, quote, toTs } from './ts-literal.ts';
import type { Migration } from './types.ts';

const ROOT_RCS = ['.oxfmtrc.jsonc', '.oxfmtrc.json'];
const SHARED = 'shoe-box-oxfmt-config';

// What defineShoeboxFormat already sets; anything else in the rc is listed
// in a comment rather than silently lost.
const SHARED_OPTIONS: Readonly<Record<string, unknown>> = {
  printWidth: 80,
  tabWidth: 2,
  useTabs: false,
  singleQuote: true,
  jsxSingleQuote: true,
  trailingComma: 'all',
  bracketSpacing: true,
  bracketSameLine: false,
  sortImports: true,
  experimentalSortImports: true,
};
// Mirrors a few of shoe-box-oxfmt-config's sharedIgnorePatterns so the
// migrated file only lists what is specific to the repo (duplicates are
// harmless, so this need not be exhaustive).
const SHARED_IGNORES = new Set([
  '**/*.md',
  '**/*.gen.*',
  '**/*.vendored.*',
  'docs/cloned-repos-as-docs/**',
  '.agents/**',
  '.cursor/**',
  '.opencode/**',
  '.github/skills/**',
]);

const findRootRc = Effect.fnUntraced(function* (repo: Repo) {
  for (const path of ROOT_RCS) {
    const text = yield* repo.read(path);
    if (text !== undefined) return { path, text };
  }
  return undefined;
});

const stylesheetOf = (rc: Readonly<Record<string, unknown>>) => {
  for (const key of ['experimentalTailwindcss', 'sortTailwindcss']) {
    const tailwind = rc[key];
    if (isRecord(tailwind) && Predicate.isString(tailwind.stylesheet))
      return tailwind.stylesheet;
  }
  return Predicate.isString(rc.tailwindStylesheet)
    ? rc.tailwindStylesheet
    : undefined;
};

const render = (
  source: string,
  text: string,
  rc: Readonly<Record<string, unknown>>,
) => {
  const comments = collectComments(text);
  const entries: Array<readonly [string, string, ReadonlyArray<string>?]> = [];
  const stylesheet = stylesheetOf(rc);
  if (stylesheet !== undefined)
    entries.push(['tailwindStylesheet', quote(stylesheet)]);

  const patterns = Arr.isArray(rc.ignorePatterns) ? rc.ignorePatterns : [];
  const kept = Arr.flatMap(patterns, (pattern: unknown, index) =>
    Predicate.isString(pattern) && !SHARED_IGNORES.has(pattern)
      ? [{ pattern, index }]
      : [],
  );
  if (kept.length > 0) {
    const keptComments = new Map(
      Arr.map(
        kept,
        ({ index }, to) =>
          [
            `ignorePatterns\0${to}`,
            comments.get(`ignorePatterns\0${index}`) ?? [],
          ] as const,
      ),
    );
    entries.push([
      'ignorePatterns',
      toTs(
        Arr.map(kept, (k) => k.pattern),
        keptComments,
        ['ignorePatterns'],
        2,
      ),
    ]);
  }

  const differing = Arr.filter(
    Rec.toEntries(rc),
    ([key, value]) =>
      ![
        '$schema',
        'ignorePatterns',
        'experimentalTailwindcss',
        'sortTailwindcss',
        'tailwindStylesheet',
      ].includes(key) &&
      (!Rec.has(SHARED_OPTIONS, key) || SHARED_OPTIONS[key] !== value),
  );
  const notes = [
    `// Migrated from ${source} by \`shoe-box migrate ${MigrationId.oxfmtrcToTs}\`.`,
  ];
  if (differing.length > 0) {
    notes.push(
      '// Not carried over (the shared format decides these):',
      ...Arr.map(
        differing,
        ([key, value]) => `//   ${key}: ${JSON.stringify(value)}`,
      ),
    );
  }
  return Arr.join(
    [
      `import { defineShoeboxFormat } from '${SHARED}';`,
      '',
      ...notes,
      `export default defineShoeboxFormat(${entries.length === 0 ? '' : objectLiteral(entries)});`,
      '',
    ],
    '\n',
  );
};

const RC = /\.oxfmtrc\.jsonc?/u;

export const oxfmtrcToTs: Migration = {
  id: MigrationId.oxfmtrcToTs,
  description:
    'Convert .oxfmtrc.json(c) into oxfmt.config.ts using defineShoeboxFormat (sortImports on), keeping repo ignore patterns',
  applies: Effect.fnUntraced(function* (repo) {
    return (
      (yield* findRootRc(repo)) !== undefined &&
      !(yield* repo.exists('oxfmt.config.ts'))
    );
  }),
  run: Effect.fnUntraced(function* (repo) {
    const rootRc = yield* findRootRc(repo);
    if (rootRc === undefined) return [];
    const rc = parseJsonc(rootRc.text);
    if (!isRecord(rc)) return [];
    const content = render(rootRc.path, rootRc.text, rc);
    const context = yield* workspaceEditor(repo);
    if (context === undefined) {
      return [
        { path: 'oxfmt.config.ts', content },
        { path: rootRc.path, content: undefined },
      ];
    }
    const { workspace, editor } = context;
    editor.set('oxfmt.config.ts', content);
    editor.set(rootRc.path, undefined);
    rewriteScripts(editor, workspace, (command, _name, manifest) =>
      invokes(command, 'oxfmt')
        ? pointAtConfig(command, 'oxfmt', manifest.dir, 'oxfmt.config.ts', RC)
        : command,
    );
    addRootDevDep(editor, workspace, SHARED, versions[SHARED]);
    return editor.changes();
  }),
};
