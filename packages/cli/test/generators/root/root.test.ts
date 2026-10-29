import { assert, describe, it } from '@effect/vitest';
import {
  Array as Arr,
  pipe,
  Predicate,
  Record as Rec,
  String as Str,
} from 'effect';

import { makeContext } from '../../../src/engine/generate.ts';
import type { FileStrategy } from '../../../src/engine/types.ts';
import { workspaces } from '../../../src/generators/root/workspaces.ts';
import { effectFamily, versions } from '../../../src/versions.ts';
import { parseJson, preset, presetNames, record, render } from './fixtures.ts';

const dependencyFields = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
];

describe.each(presetNames)('root files (%s preset)', (name) => {
  const config = preset(name);
  const { files, aggregate, byPath, file } = render(config);

  it('emits every repo-wide file with its sync strategy', () => {
    const expected: ReadonlyArray<readonly [string, FileStrategy]> = [
      ['package.json', 'json-merge'],
      ['tsconfig.json', 'owned'],
      ['oxlint.config.ts', 'managed'],
      ['oxfmt.config.ts', 'managed'],
      ['knip.ts', 'managed'],
      ['.jscpd.json', 'owned'],
      ['vitest.config.ts', 'owned'],
      ['flake.nix', 'managed'],
      ['.envrc', 'owned'],
      ['.gitignore', 'managed'],
      ['README.md', 'seed'],
      ['AGENTS.md', 'managed'],
      ['CLAUDE.md', 'owned'],
      ['.vscode/settings.json', 'owned'],
      ['.vscode/extensions.json', 'owned'],
    ];
    for (const [path, strategy] of expected) {
      assert.strictEqual(file(path).strategy, strategy, path);
    }
  });

  it('emits optional files only when their feature is chosen', () => {
    assert.strictEqual(
      byPath.has('.github/workflows/ci.yml'),
      config.ci === 'github',
    );
    assert.strictEqual(
      byPath.has('.changeset/config.json'),
      config.features.changesets,
    );
    assert.strictEqual(
      byPath.has('bunfig.toml'),
      Arr.some(config.apps, (app) => app.kind === 'expo'),
    );
  });

  it('pins every catalog: spec of every generated package.json', () => {
    const root = parseJson(file('package.json'));
    const catalog = record(record(root.workspaces).catalog);
    const missing = pipe(
      files,
      Arr.filter((f) => Str.endsWith('package.json')(f.path)),
      Arr.flatMap((f) => {
        const manifest = parseJson(f);
        return Arr.flatMap(dependencyFields, (field) =>
          pipe(
            Rec.toEntries(record(manifest[field])),
            Arr.filter(
              ([dep, spec]) => spec === 'catalog:' && !(dep in catalog),
            ),
            Arr.map(([dep]) => `${f.path}: ${dep}`),
          ),
        );
      }),
    );
    assert.deepStrictEqual(missing, []);
    for (const [dep, version] of Rec.toEntries(catalog)) {
      assert.notStrictEqual(version, 'latest', dep);
    }
  });

  it('keeps the root free of internal workspace dependencies', () => {
    const root = parseJson(file('package.json'));
    assert.strictEqual(Rec.keys(root)[0], 'name');
    assert.strictEqual(root.packageManager, 'bun@1.4.4');
    const internal = Arr.flatMap(dependencyFields, (field) =>
      Arr.filter(
        Rec.toEntries(record(root[field])),
        ([dep, spec]) =>
          spec === 'workspace:*' || Str.startsWith(`@${config.scope}/`)(dep),
      ),
    );
    assert.deepStrictEqual(internal, []);
  });

  it('overrides the whole effect family to the effect pin', () => {
    const overrides = record(parseJson(file('package.json')).overrides);
    for (const name of effectFamily) {
      assert.strictEqual(overrides[name], versions.effect, name);
    }
    assert.strictEqual(overrides.effect, '4.0.6');
  });

  it('balances every managed region', () => {
    for (const f of Arr.filter(files, (g) => g.strategy === 'managed')) {
      const begins = Arr.map(
        [...Str.matchAll(/shoemaker:begin (\S+)/gu)(f.content)],
        (m) => m[1],
      );
      const ends = Arr.map(
        [...Str.matchAll(/shoemaker:end (\S+)/gu)(f.content)],
        (m) => m[1],
      );
      assert.isAbove(begins.length, 0, f.path);
      assert.deepStrictEqual(begins, ends, f.path);
    }
  });

  it('lists every generated workspace as a vitest project', () => {
    const generatedDirs = Arr.sort(
      pipe(
        files,
        Arr.map(
          (f) =>
            /^((?:apps|packages)\/[^/]+)\/package\.json$/u.exec(f.path)?.[1],
        ),
        Arr.filter(Predicate.isNotUndefined),
      ),
      Str.Order,
    );
    const known = Arr.sort(
      Arr.map(workspaces(makeContext(config)), (w) => w.dir),
      Str.Order,
    );
    assert.deepStrictEqual(known, generatedDirs);
    const vitest = file('vitest.config.ts').content;
    for (const dir of known) assert.include(vitest, `'${dir}'`);
  });

  it('puts every contributed nix package in the dev shell', () => {
    const flake = file('flake.nix').content;
    for (const pkg of ['bun', 'nodejs_24', ...aggregate.nixPackages]) {
      assert.match(flake, new RegExp(`^\\s+${pkg}$`, 'mu'));
    }
  });
});

describe('knip config', () => {
  it('ignores @foldkit/devtools only in foldkit workspaces, with a reason', () => {
    const full = render(preset('full')).file('knip.ts').content;
    assert.match(
      full,
      /'apps\/site': \{\n\s+entry: \['src\/main\.ts'\],\n\s+\/\/ .+\n\s+ignoreDependencies: \['@foldkit\/devtools'\],/u,
    );
    const web = render(preset('web')).file('knip.ts').content;
    assert.notInclude(web, '@foldkit/devtools');
  });
});

describe('lint config flags', () => {
  it('derives framework flags from the apps', () => {
    const web = render(preset('web')).file('oxlint.config.ts').content;
    assert.include(web, 'tanstackRouter: true');
    assert.include(web, 'web: true');
    const minimal = render(preset('minimal')).file('oxlint.config.ts').content;
    assert.notInclude(minimal, 'react: true');
    assert.include(minimal, "scope: 'sample-minimal'");
  });

  it('turns the env rule on only with varlock', () => {
    // web uses varlock; minimal and full (secretspec) do not.
    assert.include(
      render(preset('web')).file('oxlint.config.ts').content,
      'varlock: true',
    );
    for (const name of ['minimal', 'full'] as const) {
      assert.notInclude(
        render(preset(name)).file('oxlint.config.ts').content,
        'varlock',
      );
    }
  });
});
