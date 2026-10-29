import { fileURLToPath } from 'node:url';

import * as BunChildProcessSpawner from '@effect/platform-bun/BunChildProcessSpawner';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { expect, layer } from '@effect/vitest';
import { Effect, FileSystem, Layer, Path, Stream } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';

import type { ShoeboxConfigOptions } from '../src/index.ts';

const entry = JSON.stringify(
  fileURLToPath(new URL('../src/index.ts', import.meta.url)),
);
const oxlintBin = fileURLToPath(
  new URL('bin/oxlint', import.meta.resolve('oxlint/package.json')),
);

// The Bun layers re-export @effect/platform-node-shared, so they run under
// vitest's node host too.
const services = BunChildProcessSpawner.layer.pipe(
  Layer.provideMerge(Layer.mergeAll(BunFileSystem.layer, BunPath.layer)),
);

const envRead = 'export const port = process.env.PORT;\n';
const backdrop = "export const overlay = 'fixed inset-0 backdrop-blur-sm';\n";
const unexplainedImport = "export const lazy = () => import('./other.ts');\n";
const reactIssues = [
  'export const List = ({ items }: { items: Array<string> }) => (',
  '  <ul>{items.map((item, i) => <li key={i}>{item}</li>)}<input autoFocus /></ul>',
  ');',
  '',
].join('\n');

const expectLoaded = (output: string) => {
  expect(output).not.toMatch(/failed to (load|parse)|unknown rule|not found/iu);
};

// Runs the real oxlint binary with `config` (the body of oxlint.config.ts)
// over `files`, so plugin resolution, rule names, option schemas and override
// order are checked by oxlint itself rather than by a reimplementation.
const lint = Effect.fnUntraced(function* (
  name: string,
  config: string,
  files: Record<string, string>,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const dir = yield* fs.makeTempDirectoryScoped({
    prefix: `shoebox-oxlint-config-${name}-`,
  });
  yield* fs.writeFileString(path.join(dir, 'oxlint.config.ts'), config);
  for (const [file, source] of Object.entries(files)) {
    yield* fs.makeDirectory(path.dirname(path.join(dir, file)), {
      recursive: true,
    });
    yield* fs.writeFileString(path.join(dir, file), source);
  }
  const handle = yield* spawner.spawn(
    ChildProcess.make(
      process.execPath,
      // `-f unix` pins the `file:line:col` format reportsAt parses; oxlint
      // otherwise picks its reporter from the environment (agents get a
      // compact one, terminals the graphical one).
      [
        oxlintBin,
        '-f',
        'unix',
        '-c',
        'oxlint.config.ts',
        ...Object.keys(files),
      ],
      { cwd: dir },
    ),
  );
  const [stdout, stderr, status] = yield* Effect.all(
    [
      handle.stdout.pipe(Stream.decodeText, Stream.mkString),
      handle.stderr.pipe(Stream.decodeText, Stream.mkString),
      handle.exitCode,
    ],
    { concurrency: 3 },
  );
  const output = `${stdout}${stderr}`;
  expectLoaded(output);
  return { status: Number(status), output };
});

const facade = (options: ShoeboxConfigOptions) =>
  `import { defineShoeboxConfig } from ${entry};\n` +
  `export default defineShoeboxConfig(${JSON.stringify(options)});\n`;

/** `file:line` → every rule reported there. */
const reportsAt = (output: string, file: string) =>
  output
    .split('\n')
    .filter((line) => line.startsWith(`${file}:`))
    // unix format: `file:line:col: message [Error/plugin(rule)]`
    .map((line) => line.replace(/^.*\[\w+\/([^\]]+)\]$/u, '$1'));

layer(services)('defineShoeboxConfig under oxlint', (it) => {
  it.effect(
    'loads the minimal config and reports through the custom plugins',
    () =>
      Effect.gen(function* () {
        const { status, output } = yield* lint(
          'minimal',
          facade({ scope: 'probe' }),
          {
            'probe.tsx': envRead + backdrop,
          },
        );
        expect(output).toContain('env-access(no-raw-env-access)');
        expect(output).toContain('Read it through Effect `Config`');
        // web is off, so the backdrop-filter plugin is neither loaded nor enabled.
        expect(output).not.toContain('backdrop-filter');
        expect(status).toBe(1);
      }),
  );

  it.effect('loads every optional plugin when every flag is on', () =>
    Effect.gen(function* () {
      const { status, output } = yield* lint(
        'everything',
        facade({
          scope: 'probe',
          react: true,
          tanstackRouter: true,
          tanstackQuery: true,
          playwright: true,
          testingLibrary: true,
          web: true,
        }),
        { 'probe.tsx': envRead + backdrop },
      );
      expect(output).toContain('env-access(no-raw-env-access)');
      expect(output).toContain('backdrop-filter(no-backdrop-filter)');
      expect(status).toBe(1);
    }),
  );

  // flat-config enables every built-in plugin, so only the category's plugin
  // list keeps React rules out of a repo without React.
  it.effect('reports react and jsx-a11y rules only with react on', () =>
    Effect.gen(function* () {
      const files = { 'list.tsx': reactIssues };
      const without = yield* lint(
        'no-react',
        facade({ scope: 'probe' }),
        files,
      );
      expect(without.output).not.toMatch(/\b(react|react-perf|jsx-a11y)\(/u);

      const withReact = yield* lint(
        'react',
        facade({ scope: 'probe', react: true }),
        files,
      );
      expect(withReact.output).toContain('react(no-array-index-key)');
      expect(withReact.output).toContain('jsx-a11y(no-autofocus)');
    }),
  );

  it.effect(
    'applies project rules after the shared rules and before the shared overrides',
    () =>
      Effect.gen(function* () {
        const { output } = yield* lint(
          'project-rules',
          facade({
            scope: 'probe',
            rules: {
              'env-access/no-raw-env-access': 'off',
              'dynamic-import/no-unexplained-dynamic-import': 'error',
            },
          }),
          {
            'probe.ts': envRead + unexplainedImport,
            'probe.test.ts': unexplainedImport,
          },
        );
        expect(reportsAt(output, 'probe.ts')).not.toContain(
          'env-access(no-raw-env-access)',
        );
        expect(reportsAt(output, 'probe.ts')).toContain(
          'dynamic-import(no-unexplained-dynamic-import)',
        );
        // The shared test override still wins, as it did over oxlint's root rules.
        expect(reportsAt(output, 'probe.test.ts')).not.toContain(
          'dynamic-import(no-unexplained-dynamic-import)',
        );
      }),
  );

  it.effect(
    'keeps oxlint glob semantics for oxlint-style overrides and ignores',
    () =>
      Effect.gen(function* () {
        const { output } = yield* lint(
          'project-globs',
          facade({
            scope: 'probe',
            ignorePatterns: ['skipped.ts'],
            overrides: [
              {
                files: ['*.ts'],
                excludeFiles: ['keep.ts'],
                rules: { 'env-access/no-raw-env-access': 'off' },
              },
            ],
          }),
          {
            'deep/nested/probe.ts': envRead,
            'deep/keep.ts': envRead,
            'deep/skipped.ts': envRead,
          },
        );
        // A glob without `/` matches at any depth in oxlint, and still does here.
        expect(reportsAt(output, 'deep/nested/probe.ts')).not.toContain(
          'env-access(no-raw-env-access)',
        );
        expect(reportsAt(output, 'deep/keep.ts')).toContain(
          'env-access(no-raw-env-access)',
        );
        expect(output).not.toContain('deep/skipped.ts');
      }),
  );
});

layer(services)('shoeboxPreset with the composer', (it) => {
  it.effect('overrides and removes blocks by name', () =>
    Effect.gen(function* () {
      const { output } = yield* lint(
        'composer',
        `import { composer, shoeboxPreset } from ${entry};\n` +
          "export default await composer(shoeboxPreset({ scope: 'probe' }))\n" +
          "  .override('shoebox/custom', { rules: { 'env-access/no-raw-env-access': 'off' } })\n" +
          "  .remove('shoebox/tests');\n",
        {
          'probe.ts': envRead,
          'probe.test.ts': unexplainedImport,
        },
      );
      expect(reportsAt(output, 'probe.ts')).not.toContain(
        'env-access(no-raw-env-access)',
      );
      // Without shoebox/tests, the dynamic-import off for tests is gone.
      expect(reportsAt(output, 'probe.test.ts')).toContain(
        'dynamic-import(no-unexplained-dynamic-import)',
      );
    }),
  );
});
