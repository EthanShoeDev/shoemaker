import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import type { ShoeboxConfigOptions } from '../src/index.ts';

const entry = JSON.stringify(
  fileURLToPath(new URL('../src/index.ts', import.meta.url)),
);
const oxlintBin = path.join(
  path.dirname(fileURLToPath(import.meta.resolve('oxlint/package.json'))),
  'bin',
  'oxlint',
);
const root = mkdtempSync(path.join(tmpdir(), 'shoebox-oxlint-config-'));

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

const envRead = 'export const port = process.env.PORT;\n';
const backdrop = "export const overlay = 'fixed inset-0 backdrop-blur-sm';\n";
const unexplainedImport = "export const lazy = () => import('./other.ts');\n";
const reactIssues = [
  'export const List = ({ items }: { items: Array<string> }) => (',
  '  <ul>{items.map((item, i) => <li key={i}>{item}</li>)}<input autoFocus /></ul>',
  ');',
  '',
].join('\n');

// Runs the real oxlint binary with `config` (the body of oxlint.config.ts)
// over `files`, so plugin resolution, rule names, option schemas and override
// order are checked by oxlint itself rather than by a reimplementation.
const lint = (name: string, config: string, files: Record<string, string>) => {
  const dir = path.join(root, name);
  mkdirSync(dir);
  writeFileSync(path.join(dir, 'oxlint.config.ts'), config);
  for (const [file, source] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), source);
  }
  const result = spawnSync(
    process.execPath,
    // `-f unix` pins the `file:line:col` format reportsAt parses; oxlint
    // otherwise picks its reporter from the environment (agents get a
    // compact one, terminals the graphical one).
    [oxlintBin, '-f', 'unix', '-c', 'oxlint.config.ts', ...Object.keys(files)],
    { cwd: dir, encoding: 'utf-8' },
  );
  const output = `${result.stdout}${result.stderr}`;
  expect(output).not.toMatch(/failed to (load|parse)|unknown rule|not found/iu);
  return { status: result.status, output };
};

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

describe('defineShoeboxConfig under oxlint', () => {
  it('loads the minimal config and reports through the custom plugins', () => {
    const { status, output } = lint('minimal', facade({ scope: 'probe' }), {
      'probe.tsx': envRead + backdrop,
    });
    expect(output).toContain('env-access(no-raw-env-access)');
    expect(output).toContain('`@probe/env`');
    // web is off, so the backdrop-filter plugin is neither loaded nor enabled.
    expect(output).not.toContain('backdrop-filter');
    expect(status).toBe(1);
  });

  it('loads every optional plugin when every flag is on', () => {
    const { status, output } = lint(
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
  });

  // flat-config enables every built-in plugin, so only the category's plugin
  // list keeps React rules out of a repo without React.
  it('reports react and jsx-a11y rules only with react on', () => {
    const files = { 'list.tsx': reactIssues };
    const without = lint('no-react', facade({ scope: 'probe' }), files);
    expect(without.output).not.toMatch(/\b(react|react-perf|jsx-a11y)\(/u);

    const withReact = lint(
      'react',
      facade({ scope: 'probe', react: true }),
      files,
    );
    expect(withReact.output).toContain('react(no-array-index-key)');
    expect(withReact.output).toContain('jsx-a11y(no-autofocus)');
  });

  it('applies project rules after the shared rules and before the shared overrides', () => {
    const { output } = lint(
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
  });

  it('keeps oxlint glob semantics for oxlint-style overrides and ignores', () => {
    const { output } = lint(
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
  });
});

describe('shoeboxPreset with the composer', () => {
  it('overrides and removes blocks by name', () => {
    const { output } = lint(
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
  });
});
