import { Array as Arr, Effect, Option, Order, String as Str } from 'effect';

import { hasDep } from '../checks/workspace.ts';
import { fail, globAll, listSome, manifestsOf, pass } from './shared.ts';
import type { DoctorCheck, Finding } from './types.ts';

interface Block {
  readonly prelude: string;
  readonly parent: string;
  readonly body: string;
}

// Every `{…}` block in a stylesheet with the selector or at-rule before it
// and the one it sits in. Enough of CSS for token files; comments go first.
const blocksOf = (source: string) => {
  const css = Str.replaceAll(/\/\*[\s\S]*?\*\//gu, '')(source);
  const open: Array<{ readonly prelude: string; readonly start: number }> = [];
  const blocks: Array<Block> = [];
  let from = 0;
  for (let index = 0; index < css.length; index++) {
    const char = css[index];
    if (char === '{') {
      open.push({
        prelude: Str.trim(Str.slice(from, index)(css)),
        start: index + 1,
      });
      from = index + 1;
    } else if (char === '}') {
      const block = open.pop();
      if (block !== undefined) {
        blocks.push({
          prelude: block.prelude,
          parent: open.at(-1)?.prelude ?? '',
          body: Str.slice(block.start, index)(css),
        });
      }
      from = index + 1;
    } else if (char === ';') {
      from = index + 1;
    }
  }
  return blocks;
};

const customProperties = (body: string) =>
  new Set(
    Arr.map(
      [...Str.matchAll(/(--[\w-]+)\s*:/gu)(body)],
      (match) => match[1] ?? '',
    ),
  );

const VARIANT = /^@variant\s+([\w-]+)$/u;

// `@variant <theme> { … }` blocks inside `:root`: Uniwind's theme syntax.
const themesOf = (blocks: ReadonlyArray<Block>) =>
  Arr.flatMap(blocks, (block) => {
    const name = VARIANT.exec(block.prelude)?.[1];
    return name === undefined || block.parent !== ':root'
      ? []
      : [{ name, vars: customProperties(block.body) }];
  });

// Directives web Tailwind accepts and Uniwind cannot parse.
const WEB_ONLY = ['@plugin', '@source', '@custom-variant', '@config'];

const TOKENS = 'packages/theme/tokens.css';

const sorted = (values: Iterable<string>) => Arr.sort(values, Order.String);

const tokenProblems = (path: string, source: string) => {
  const blocks = blocksOf(source);
  const themes = themesOf(blocks);
  const all = new Set(Arr.flatMap(themes, (theme) => [...theme.vars]));
  const problems: Array<Finding> = [];
  for (const theme of themes) {
    const missing = sorted(
      Arr.filter([...all], (name) => !theme.vars.has(name)),
    );
    if (missing.length > 0) {
      problems.push(
        fail(`${path}: theme ${theme.name} is missing ${listSome(missing)}`, {
          path,
          fix: `define ${listSome(missing)} in \`@variant ${theme.name}\`: Uniwind needs every theme to set the same variables`,
        }),
      );
    }
  }
  if (path !== TOKENS) return problems;
  const themeBlocks = Arr.filter(blocks, (block) =>
    /^@theme\b/u.test(block.prelude),
  );
  const declared = new Set(
    Arr.flatMap(themeBlocks, (block) => [...customProperties(block.body)]),
  );
  const undeclared = sorted(
    Arr.filter([...all], (name) => !declared.has(name)),
  );
  if (undeclared.length > 0) {
    problems.push(
      fail(`${path}: ${listSome(undeclared)} not declared in @theme`, {
        path,
        fix: `add \`${undeclared[0] ?? '--color-x'}: unset;\` (and the rest) to @theme so web Tailwind generates their utilities`,
      }),
    );
  }
  const stripped = Str.replaceAll(/\/\*[\s\S]*?\*\//gu, '')(source);
  const webOnly = Arr.filter([...WEB_ONLY, 'source('], (directive) =>
    Str.includes(directive)(stripped),
  );
  if (webOnly.length > 0) {
    problems.push(
      fail(
        `${path} uses ${Arr.join(webOnly, ', ')}, which Uniwind cannot parse`,
        {
          path,
          fix: 'move web-only setup into a web app stylesheet; the shared tokens are compiled for React Native too',
        },
      ),
    );
  }
  return problems;
};

// Uniwind reports a theme missing a variable at bundle time, and an
// undeclared token has no utility on the web.
export const themeTokens: DoctorCheck = {
  id: 'theme-tokens',
  description:
    'Every theme variant sets the same tokens, and the shared tokens stay within what both web Tailwind and Uniwind parse',
  run: Effect.fnUntraced(function* (repo) {
    const files = yield* globAll(repo, ['apps/**/*.css', 'packages/**/*.css']);
    const findings: Array<Finding> = [];
    let themed = 0;
    for (const path of files) {
      const source = yield* repo.read(path);
      if (source === undefined) continue;
      if (themesOf(blocksOf(source)).length === 0 && path !== TOKENS) continue;
      themed++;
      findings.push(...tokenProblems(path, source));
    }
    if (themed === 0 || findings.length > 0) return findings;
    return [
      pass(
        `theme tokens consistent in ${themed} stylesheet${themed === 1 ? '' : 's'}`,
      ),
    ];
  }),
};

// Apps style with Tailwind on the web or Uniwind on native.
const STYLED_BY = ['tailwindcss', 'uniwind'];

export const themeImports: DoctorCheck = {
  id: 'theme-imports',
  description:
    'With a shared theme package, every Tailwind or Uniwind app imports its tokens',
  run: Effect.fnUntraced(function* (repo) {
    const manifests = yield* manifestsOf(repo);
    const theme = Arr.findFirst(
      manifests,
      (manifest) => manifest.path === 'packages/theme/package.json',
    );
    if (Option.isNone(theme) || theme.value.pkg.name === undefined) return [];
    const name = theme.value.pkg.name;
    const apps = Arr.filter(
      manifests,
      (manifest) =>
        Str.startsWith('apps/')(manifest.dir) &&
        Arr.some(STYLED_BY, (dep) => hasDep(manifest.pkg, dep)),
    );
    const findings: Array<Finding> = [];
    for (const app of apps) {
      const sheets = yield* repo.glob(`${app.dir}/**/*.css`);
      let imports = false;
      for (const sheet of sheets) {
        const source = yield* repo.read(sheet);
        if (
          source !== undefined &&
          (Str.includes(`'${name}/`)(source) ||
            Str.includes(`"${name}/`)(source))
        ) {
          imports = true;
        }
      }
      const native = hasDep(app.pkg, 'uniwind');
      const entry = native ? 'tokens.css' : 'web.css';
      if (!imports || !hasDep(app.pkg, name)) {
        findings.push(
          fail(`${app.dir} does not use the shared theme (${name})`, {
            path: app.path,
            fix: `add "${name}": "workspace:*" to its dependencies and \`@import '${name}/${entry}';\` after Tailwind${native ? ' and Uniwind' : ''} in its stylesheet`,
          }),
        );
      }
    }
    return findings.length > 0
      ? findings
      : [
          pass(
            `${apps.length} app${apps.length === 1 ? '' : 's'} share ${name}`,
          ),
        ];
  }),
};

export const themeChecks = [themeTokens, themeImports];
