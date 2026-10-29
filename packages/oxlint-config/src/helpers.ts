import { fileURLToPath } from 'node:url';

import { presets as effectTsgoPresets } from '@effect/tsgo/oxlint-presets';
import type { ExternalPluginEntry, OxlintConfig } from 'oxlint';

export type OxlintRules = NonNullable<OxlintConfig['rules']>;

/**
 * Every rule of a jsPlugin at `error`. jsPlugins rules are not covered by
 * `categories`, so each plugin's full rule set is derived like this, and the
 * ones we reject are turned off after the spread with a reason.
 */
export const everyRuleOf = (prefix: string, plugin: { rules?: object }) =>
  Object.fromEntries(
    Object.keys(plugin.rules ?? {}).map((rule) => [
      `${prefix}/${rule}`,
      'error' as const,
    ]),
  );

/**
 * Effect diagnostics are reported by oxlint (via the `effect-tsgo patch
 * --oxlint` prepare step), not by the language service, so the whole rule set
 * lands at `error`. The map is the union of EVERY preset, not just
 * `recommended`: the effect-native (global-date, process-env, …), style,
 * antipattern, correctness and maintainers rules are not in `recommended`, so
 * deriving from it alone leaves them silently off. Deriving it keeps new rules
 * enforced when @effect/tsgo is upgraded rather than landing at a preset's
 * `warn`.
 */
export const effectTsgoRules = Object.fromEntries(
  Object.values(effectTsgoPresets)
    .flatMap((preset) => Object.keys(preset.rules ?? {}))
    .map((rule) => [rule, 'error' as const]),
);

/**
 * @effect/vitest test blocks and their modifiers; vitest rules only know the
 * built-in `it`/`test`. Bare `it` is listed because `layer(…)('…', (it) => …)`
 * rebinds it as a parameter the rule cannot resolve. Local aliases of `it` are
 * not listed: import `it` from @effect/vitest under its own name.
 */
export const effectVitestTestBlocks = [
  'it',
  'it.effect',
  'it.live',
  'it.scoped',
  'it.scopedLive',
].flatMap((block) => [
  block,
  ...['each', 'skip', 'skipIf', 'runIf', 'only', 'fails'].map(
    (modifier) => `${block}.${modifier}`,
  ),
]);

/**
 * A jsPlugins entry resolved from THIS package, so the consumer's
 * oxlint.config.ts works without listing the plugin packages as its own
 * dependencies (oxlint resolves bare specifiers from the config file). The
 * explicit name keeps the rule prefix stable: a path has no package name for
 * oxlint to derive the prefix from.
 */
export const resolvedPlugin = (
  name: string,
  specifier: string,
): ExternalPluginEntry => ({
  name,
  specifier: fileURLToPath(import.meta.resolve(specifier)),
});
