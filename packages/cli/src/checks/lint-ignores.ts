import { Array as Arr, Effect, Order, String as Str } from 'effect';

import type { Repo } from '../engine/repo.ts';
import { sourceFiles } from './sources.ts';
import type { RepoCheck } from './types.ts';

// Report of every lint/format/type disable directive and whether it says why.
// A directive without a reason is the thing reviewers cannot judge.

// Comment syntax is required so regex and string literals do not match. Each
// `reason` regex captures the text that counts as the description.
const DIRECTIVES = [
  {
    name: 'oxlint-disable',
    regex: /\/[/*]\s*oxlint-disable(?:-next-line|-line)?\b(.*)$/u,
    reason: /\s--\s*\S/u,
  },
  {
    name: 'eslint-disable',
    regex: /\/[/*]\s*eslint-disable(?:-next-line|-line)?\b(.*)$/u,
    reason: /\s--\s*\S/u,
  },
  {
    name: 'biome-ignore',
    regex: /\/[/*]\s*biome-ignore(?:-all|-start|-end)?\b(.*)$/u,
    reason: /:\s*\S/u,
  },
  {
    name: 'oxfmt-ignore',
    regex: /\/[/*]\s*oxfmt-ignore\b(.*)$/u,
    reason: /\S/u,
  },
  {
    name: 'prettier-ignore',
    regex: /\/[/*]\s*prettier-ignore\b(.*)$/u,
    reason: /\S/u,
  },
  { name: '@ts-ignore', regex: /\/\/\s*@ts-ignore\b(.*)$/u, reason: /\S/u },
  {
    name: '@ts-expect-error',
    regex: /\/\/\s*@ts-expect-error\b(.*)$/u,
    reason: /\S/u,
  },
  { name: '@ts-nocheck', regex: /\/\/\s*@ts-nocheck\b(.*)$/u, reason: /\S/u },
] as const;

export interface Directive {
  readonly file: string;
  readonly line: number;
  readonly name: string;
  readonly described: boolean;
  readonly text: string;
}

export const findDirectives = (file: string, source: string) =>
  Arr.flatMap(Str.split(source, '\n'), (line, index) => {
    for (const directive of DIRECTIVES) {
      const match = directive.regex.exec(line);
      if (match !== null) {
        // `*/` closes a block comment; it is not a description.
        const rest = Str.replace(/\*\/.*$/u, '')(match[1] ?? '');
        const found: Directive = {
          file,
          line: index + 1,
          name: directive.name,
          described: directive.reason.test(rest),
          text: Str.trim(line),
        };
        return [found];
      }
    }
    return [];
  });

const runLintIgnores = Effect.fnUntraced(function* (repo: Repo) {
  const files = yield* sourceFiles(repo);
  const directives: Array<Directive> = [];
  for (const file of files) {
    const source = yield* repo.read(file);
    if (source !== undefined) directives.push(...findDirectives(file, source));
  }
  const undescribed = Arr.filter(directives, (d) => !d.described);
  const count = (key: (d: Directive) => string) => {
    const counts = new Map<string, number>();
    for (const d of directives)
      counts.set(key(d), (counts.get(key(d)) ?? 0) + 1);
    return Arr.sort(
      [...counts],
      Order.flip(
        Order.mapInput(
          Order.Number,
          (entry: readonly [string, number]) => entry[1],
        ),
      ),
    );
  };

  const lines = [
    '# Lint Ignore Report',
    '',
    `- Scanned files: ${files.length}`,
    `- Directives: ${directives.length}`,
    `- Without a description: ${undescribed.length}`,
    `- Files with directives: ${new Set(Arr.map(directives, (d) => d.file)).size}`,
  ];
  if (directives.length > 0) {
    lines.push(
      '',
      '## By directive',
      '',
      '| Directive | Count |',
      '|---|---|',
      ...Arr.map(
        count((d) => d.name),
        ([name, n]) => `| \`${name}\` | ${n} |`,
      ),
      '',
      '## By file',
      '',
      '| File | Count |',
      '|---|---|',
      ...Arr.map(
        count((d) => d.file),
        ([file, n]) => `| \`${file}\` | ${n} |`,
      ),
      '',
      '## Findings',
      '',
      ...Arr.map(
        Arr.sort(
          directives,
          Order.combine(
            Order.mapInput(
              (a: string, b: string) => Str.localeCompare(b)(a),
              (d: Directive) => d.file,
            ),
            Order.mapInput(Order.Number, (d: Directive) => d.line),
          ),
        ),
        (d) =>
          `- ${d.described ? 'ok  ' : 'MISSING REASON'} \`${d.file}:${d.line}\` ${d.name}: \`${d.text}\``,
      ),
      '',
      'If several ignores share a rule, consider whether the rule should be configured differently;',
      'otherwise fix the code or give each ignore a reason (`-- why` for oxlint/eslint, `: why` for biome).',
    );
  }
  return {
    ok: undescribed.length === 0,
    report: Arr.join(lines, '\n'),
    fixes: [],
  };
});

export const lintIgnoresCheck: RepoCheck = {
  name: 'lint-ignores',
  description:
    'Reports every oxlint/eslint/ts/biome/oxfmt disable directive and whether it has a description',
  run: runLintIgnores,
};
