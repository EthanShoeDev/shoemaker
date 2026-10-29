import type { OxlintConfig, OxlintOverride } from 'oxlint';
import { defineConfig, globalIgnores } from 'oxlint-flat-config';
import type { FlatConfigItem } from 'oxlint-flat-config';

import type { OxlintRules } from './helpers.ts';
import { shoeboxPresetParts } from './preset.ts';
import type { ShoeboxPresetOptions } from './preset.ts';

export type ShoeboxConfigOptions = ShoeboxPresetOptions & {
  /** Appended to the shared ignore patterns (gitignore syntax, as in oxlint). */
  ignorePatterns?: Array<string>;
  /**
   * Appended after the shared overrides, so they win over them. An oxlint
   * override (`{ files, excludeFiles?, rules }`) keeps oxlint's glob meaning;
   * a flat config item (one with a `name`, `ignores`, `basePath` or
   * `extends`) is passed through as is.
   */
  overrides?: Array<OxlintOverride | FlatConfigItem>;
  /** Project rules, applied after every shared rule. */
  rules?: OxlintRules;
};

// Oxlint matches a glob without a `/` at any depth; flat config only in the
// config's directory, so spell out the `**/` oxlint implied.
const anyDepthGlob = (pattern: string) =>
  pattern.includes('/') ? pattern : `**/${pattern}`;

// Gitignore anchors a pattern only when it has a `/` before its last
// character; flat config's global ignores always anchor.
const anyDepthIgnore = (pattern: string) => {
  const negation = pattern.startsWith('!') ? '!' : '';
  const body = pattern.slice(negation.length);
  return body.replace(/\/$/u, '').includes('/')
    ? pattern
    : `${negation}**/${body}`;
};

const flatOnlyKeys = ['name', 'ignores', 'basePath', 'extends'] as const;

const isFlatItem = (
  override: OxlintOverride | FlatConfigItem,
): override is FlatConfigItem =>
  flatOnlyKeys.some((key) => key in override) || !('files' in override);

const toFlatItem = (
  override: OxlintOverride | FlatConfigItem,
  index: number,
): FlatConfigItem => {
  if (isFlatItem(override)) return override;
  // `plugins` has no flat counterpart: flat config enables every built-in
  // plugin, and categories are already expanded into explicit rules.
  const { files, excludeFiles, env, globals, jsPlugins, rules } = override;
  return {
    name: `project/overrides[${index}]`,
    files: files.map(anyDepthGlob),
    ...(excludeFiles === undefined
      ? {}
      : { ignores: excludeFiles.map(anyDepthGlob) }),
    ...(env === undefined ? {} : { env }),
    ...(globals === undefined ? {} : { globals }),
    ...(jsPlugins === undefined || jsPlugins === null ? {} : { jsPlugins }),
    ...(rules === undefined ? {} : { rules }),
  };
};

/**
 * The shared oxlint config as one call: shoeboxPreset(options) plus the
 * project's ignores, rules and overrides, compiled by oxlint-flat-config.
 * Strictness model: every category at `error`, every jsPlugin rule at
 * `error`, and each rule these codebases reject turned off WITH its reason on
 * the line above it. Zero warnings.
 */
export const defineShoeboxConfig = (
  options: ShoeboxConfigOptions,
): OxlintConfig => {
  const { ignorePatterns = [], overrides = [], rules } = options;
  const { global, scoped } = shoeboxPresetParts(options);

  return defineConfig(
    global,
    ignorePatterns.length > 0 &&
      globalIgnores(ignorePatterns.map(anyDepthIgnore), 'project/ignores'),
    // Where oxlint's root `rules` sat: after every shared global rule and
    // before every shared override, so the test and tooling offs still win.
    rules !== undefined && { name: 'project/rules', rules },
    scoped,
    overrides.map(toFlatItem),
  );
};
