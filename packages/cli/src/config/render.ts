import { Array as Arr, String as Str } from 'effect';

import type { ShoeboxConfig } from './schema.ts';

// Renders `shoebox.config.ts` in oxfmt's style (single quotes, trailing
// commas, printWidth 80), so a formatter run is a no-op. Objects always
// expand; string arrays stay on one line when they fit.

const PRINT_WIDTH = 80;

const quote = (value: string) => {
  // oxfmt picks the quote needing fewer escapes, single on a tie.
  const singles = Str.split(value, "'").length;
  const doubles = Str.split(value, '"').length;
  const q = doubles < singles ? '"' : "'";
  const escaped = Str.replaceAll(
    '\n',
    '\\n',
  )(Str.replaceAll(q, `\\${q}`)(Str.replaceAll('\\', '\\\\')(value)));
  return `${q}${escaped}${q}`;
};

// One `key: value,` property line (or block) at `indent`.
type Line = (indent: string) => string;

const prop =
  (key: string, value: string): Line =>
  (indent) =>
    `${indent}${key}: ${quote(value)},`;

const bool =
  (key: string, value: boolean): Line =>
  (indent) =>
    `${indent}${key}: ${String(value)},`;

const object =
  (key: string | undefined, lines: ReadonlyArray<Line>): Line =>
  (indent) => {
    const head = key === undefined ? indent : `${indent}${key}: `;
    const inner = `${indent}  `;
    const body = Arr.join(
      Arr.map(lines, (line) => line(inner)),
      '\n',
    );
    return `${head}{\n${body}\n${indent}},`;
  };

const strings =
  (key: string, values: ReadonlyArray<string>): Line =>
  (indent) => {
    const head = `${indent}${key}: `;
    const inline = `[${Arr.join(Arr.map(values, quote), ', ')}]`;
    if (values.length === 0 || head.length + inline.length + 1 <= PRINT_WIDTH) {
      return `${head}${inline},`;
    }
    const items = Arr.map(values, (value) => `${indent}  ${quote(value)},`);
    return `${head}[\n${Arr.join(items, '\n')}\n${indent}],`;
  };

const objects =
  (key: string, items: ReadonlyArray<ReadonlyArray<Line>>): Line =>
  (indent) => {
    const head = `${indent}${key}: `;
    if (items.length === 0) return `${head}[],`;
    const inner = `${indent}  `;
    const rendered = Arr.map(items, (lines) => object(undefined, lines)(inner));
    return `${head}[\n${Arr.join(rendered, '\n')}\n${indent}],`;
  };

// Field order follows the schema so diffs between renders stay small.
const configLines = (config: ShoeboxConfig): ReadonlyArray<Line> => [
  prop('name', config.name),
  prop('scope', config.scope),
  prop('description', config.description),
  objects(
    'apps',
    Arr.map(config.apps, (app) => [
      prop('name', app.name),
      prop('kind', app.kind),
    ]),
  ),
  objects(
    'packages',
    Arr.map(config.packages, (pkg) => [
      prop('name', pkg.name),
      prop('kind', pkg.kind),
    ]),
  ),
  prop('taskRunner', config.taskRunner),
  prop('secrets', config.secrets),
  object('infra', [
    prop('kind', config.infra.kind),
    strings('providers', config.infra.providers),
  ]),
  prop('ci', config.ci),
  object('features', [
    bool('changesets', config.features.changesets),
    bool('agents', config.features.agents),
    bool('vscode', config.features.vscode),
  ]),
  strings('nixPackages', config.nixPackages),
  strings('unmanaged', config.unmanaged),
];

// An `apps` / `packages` entry: multi-line as in renderConfigFile (with its
// trailing comma), or inline for a one-line array.
export const renderEntry = (
  entry: { readonly name: string; readonly kind: string },
  indent: string,
) =>
  object(undefined, [prop('name', entry.name), prop('kind', entry.kind)])(
    indent,
  );

export const renderInlineEntry = (entry: {
  readonly name: string;
  readonly kind: string;
}) => `{ name: ${quote(entry.name)}, kind: ${quote(entry.kind)} }`;

export const renderConfigFile = (config: ShoeboxConfig) =>
  Arr.join(
    [
      "import { defineConfig } from '@shoe-box-tools/cli/config';",
      '',
      'export default defineConfig({',
      ...Arr.map(configLines(config), (line) => line('  ')),
      '});',
      '',
    ],
    '\n',
  );
