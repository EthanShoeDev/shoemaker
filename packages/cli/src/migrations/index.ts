import { addEnvrc } from './add-envrc.ts';
import { catalogCheckToShoebox } from './catalog-check-to-shoebox.ts';
import { lintScriptNames } from './lint-script-names.ts';
import { nixFmtScriptToShoebox } from './nix-fmt-script-to-shoe-box.ts';
import { oxfmtrcToTs } from './oxfmtrc-to-ts.ts';
import { oxlintFlagsToOptions } from './oxlint-flags-to-options.ts';
import { oxlintrcToTs } from './oxlintrc-to-ts.ts';
import { tsgoToTsc } from './tsgo-to-tsc.ts';
import { turboJsonToJsonc } from './turbo-json-to-jsonc.ts';
import type { Migration } from './types.ts';

// Ordered oldest first. Within a date, structural renames run before the
// edits that reference the renamed files.
export const migrations: ReadonlyArray<Migration> = [
  oxlintrcToTs,
  oxlintFlagsToOptions,
  oxfmtrcToTs,
  turboJsonToJsonc,
  lintScriptNames,
  tsgoToTsc,
  addEnvrc,
  catalogCheckToShoebox,
  nixFmtScriptToShoebox,
];

export { planAll, withChanges } from './shared.ts';
