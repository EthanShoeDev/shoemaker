import { Array as Arr, String as Str, TextDiff } from 'effect';

import type { Action, Plan, PlannedFile } from './plan.ts';

export interface Style {
  readonly red: (text: string) => string;
  readonly green: (text: string) => string;
  readonly yellow: (text: string) => string;
  readonly cyan: (text: string) => string;
  readonly dim: (text: string) => string;
  readonly bold: (text: string) => string;
}

const ansi = (code: number) => (text: string) =>
  `\u001B[${code}m${text}\u001B[0m`;

export const makeStyle = (colors: boolean): Style => {
  const plain = (text: string) => text;
  return colors
    ? {
        red: ansi(31),
        green: ansi(32),
        yellow: ansi(33),
        cyan: ansi(36),
        dim: ansi(2),
        bold: ansi(1),
      }
    : {
        red: plain,
        green: plain,
        yellow: plain,
        cyan: plain,
        dim: plain,
        bold: plain,
      };
};

const ORDER: ReadonlyArray<Action> = [
  'create',
  'update',
  'conflict',
  'untracked',
  'unchanged',
  'skip',
];

const COLOR: Readonly<Record<Action, keyof Style>> = {
  create: 'green',
  update: 'cyan',
  conflict: 'red',
  untracked: 'yellow',
  unchanged: 'dim',
  skip: 'dim',
};

const label = (action: Action, style: Style) =>
  style[COLOR[action]](Str.padEnd(9)(action));

export const countActions = (plan: Plan) => {
  const counts: Record<Action, number> = {
    create: 0,
    update: 0,
    unchanged: 0,
    conflict: 0,
    untracked: 0,
    skip: 0,
  };
  for (const file of plan.files) counts[file.action] += 1;
  return counts;
};

// One line per file that needs attention, then the totals. Unchanged and
// skipped files are only counted unless `verbose`, except a skip with a
// reason (a seed the user deleted), which is worth a line.
export const renderSummary = (
  plan: Plan,
  style: Style,
  options: { readonly verbose?: boolean } = {},
) => {
  const lines: Array<string> = [];
  for (const action of ORDER) {
    const quiet = action === 'unchanged' || action === 'skip';
    const shown = Arr.filter(
      plan.files,
      (f) =>
        f.action === action &&
        (!quiet || options.verbose === true || f.reason !== undefined),
    );
    for (const file of shown) {
      const note = file.forced === true ? ' (forced)' : '';
      const reason =
        file.reason !== undefined && file.forced !== true
          ? style.dim(` - ${file.reason}`)
          : '';
      lines.push(`  ${label(action, style)} ${file.path}${note}${reason}`);
    }
  }
  for (const orphan of plan.orphans) {
    lines.push(
      `  ${style.dim('orphan   ')} ${orphan}${style.dim(' - no longer generated; left in place')}`,
    );
  }
  const counts = countActions(plan);
  const totals = Arr.join(
    Arr.map(
      Arr.filter(ORDER, (action) => counts[action] > 0),
      (action) => `${counts[action]} ${action}`,
    ),
    ', ',
  );
  lines.push(totals === '' ? 'Nothing to sync.' : totals);
  return Arr.join(lines, '\n');
};

export const renderDiff = (file: PlannedFile, style: Style) => {
  // TextDiff is experimental, but the diff is display-only: churn costs nothing.
  // oxlint-disable-next-line effecttsgo/experimental-api-usage -- display-only diff
  const edits = TextDiff.lines(file.before ?? '', file.after);
  // oxlint-disable-next-line effecttsgo/experimental-api-usage -- display-only diff
  const diff = TextDiff.unified(edits, {
    fromFile: file.before === undefined ? '/dev/null' : `a/${file.path}`,
    toFile: `b/${file.path}`,
    context: 3,
  });
  const styled = Arr.map(Str.split(Str.trimEnd(diff), '\n'), (line) =>
    Str.startsWith('+++')(line) || Str.startsWith('---')(line)
      ? style.bold(line)
      : Str.startsWith('@@')(line)
        ? style.cyan(line)
        : Str.startsWith('+')(line)
          ? style.green(line)
          : Str.startsWith('-')(line)
            ? style.red(line)
            : line,
  );
  return Arr.join(styled, '\n');
};

// Diffs for updates and for what blocked files would become. New files are
// already listed in the summary; their full text only with `verbose`.
export const renderDiffs = (
  plan: Plan,
  style: Style,
  options: { readonly verbose?: boolean } = {},
) =>
  Arr.join(
    Arr.map(
      Arr.filter(
        plan.files,
        (f) =>
          (f.action === 'create' && options.verbose === true) ||
          f.action === 'update' ||
          f.action === 'conflict' ||
          f.action === 'untracked',
      ),
      (f) => renderDiff(f, style),
    ),
    '\n\n',
  );
