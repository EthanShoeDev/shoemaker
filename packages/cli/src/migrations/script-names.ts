import { Array as Arr, Option, pipe, String as Str } from 'effect';

// `<tool>:check` / `<tool>:fix` naming. Returns the preferred name for a
// drifted script, or undefined when the name is already fine.

// Flags that make a command write files. (deadnix `-f` is `--fail`, so short
// flags are not guessed.)
const FIX_FLAG =
  /(?:^|\s)(?:--fix\b|--fix-dangerously\b|--write\b|--edit\b|-e\b)/u;
const FMT_CHECK = /--check\b|--\s+-c\b/u;

const fmtTool = (command: string) => {
  if (/\bnix\b|nix-fmt/u.test(command)) return 'nix:fmt';
  if (/\boxfmt\b/u.test(command)) return 'oxfmt';
  if (/\bprettier\b/u.test(command)) return 'prettier';
  if (/\bbiome\b/u.test(command)) return 'biome';
  return 'fmt';
};

// When `lint:python` runs ruff, the script is named after the tool.
const TOOLS = [
  'oxlint',
  'oxfmt',
  'eslint',
  'prettier',
  'biome',
  'ruff',
  'jscpd',
  'knip',
  'statix',
  'deadnix',
  'shellcheck',
  'tsc',
];
const toolOf = (base: string, command: string) => {
  const [first, ...rest] = Str.split(base, ':');
  if (TOOLS.includes(first) || first === 'nix') return base;
  return Option.match(
    Arr.findFirst(TOOLS, (name) =>
      new RegExp(`(?:^|[\\s/])${name}(?=\\s|$)`, 'u').test(command),
    ),
    {
      onNone: () => base,
      onSome: (tool) => Arr.join([tool, ...rest], ':'),
    },
  );
};

export const renameScript = (name: string, command: string) => {
  // Aggregates belong to the task runner; a root `lint` script is left alone.
  if (name === 'lint' || name === 'lint:check' || name === 'lint:fix')
    return undefined;
  if (Str.startsWith('lint:')(name)) {
    const base = toolOf(
      pipe(name, Str.slice('lint:'.length), Str.replace(/-check$/u, ':check')),
      command,
    );
    if (/(?:^|:)(?:check|fix)(?::|$)/u.test(base)) return base;
    return `${base}:${FIX_FLAG.test(command) ? 'fix' : 'check'}`;
  }
  if (/^fmt(?::|$)/u.test(name)) {
    const check = Str.includes('check')(name) || FMT_CHECK.test(command);
    return `${fmtTool(command)}:${check ? 'check' : 'fix'}`;
  }
  if (name === 'nix:fmt') return 'nix:fmt:fix';
  if (name === 'knip:fix') return 'knip:fix:danger';
  return undefined;
};
