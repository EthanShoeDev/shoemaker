import { String as Str } from 'effect';

import { commandWord } from '../checks/workspace.ts';

// Script rewrites shared by the oxlint/oxfmt config migrations.

const TYPE_AWARE_FLAGS =
  /\s--(?:type-aware|type-check|report-unused-disable-directives(?:-severity(?:=\S+|\s+\w+)?)?)(?=\s|$)/gu;

export const dropTypeAwareFlags = (command: string) =>
  Str.replaceAll(TYPE_AWARE_FLAGS, '')(command);

// Points `tool` at `config` (relative to the package dir): replaces a `-c`
// pointing at an rc file, or adds one.
export const pointAtConfig = (
  command: string,
  tool: string,
  packageDir: string,
  config: string,
  rc: RegExp,
) => {
  const prefix =
    packageDir === ''
      ? ''
      : Str.repeat(Str.split(packageDir, '/').length)('../');
  const target = `${prefix}${config}`;
  const word = commandWord(tool);
  if (!word.test(command)) return command;
  const withC = Str.replaceAll(
    new RegExp(
      String.raw`(-c|--config)(\s+|=)(?:\S*/)?${rc.source}(?=\s|$)`,
      'gu',
    ),
    `$1$2${target}`,
  )(command);
  if (withC !== command || /\s(?:-c|--config)[\s=]/u.test(command))
    return withC;
  return Str.replaceAll(
    new RegExp(word.source, 'gu'),
    `$1${tool} -c ${target}`,
  )(command);
};
