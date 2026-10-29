export { defineShoeboxConfig } from './define.ts';
export type { ShoeboxConfigOptions } from './define.ts';
export { shoeboxPreset } from './preset.ts';
export type { ShoeboxPresetOptions } from './preset.ts';
// Re-exported so a repo that composes the preset needs no second install, and
// the composer shares this package's oxlint-flat-config.
export { composer } from '@oxlint-flat-config/composer';
export {
  category,
  defineConfig as defineFlatConfig,
  globalIgnores,
} from 'oxlint-flat-config';
export type { FlatConfigItem } from 'oxlint-flat-config';
export {
  declarationFiles,
  e2eFiles,
  reactIgnorePatterns,
  routeFiles,
  sharedIgnorePatterns,
  testFiles,
  testingLibraryFiles,
  toolingFiles,
  vendoredFiles,
} from './globs.ts';
export {
  effectTsgoRules,
  effectVitestTestBlocks,
  everyRuleOf,
  resolvedPlugin,
} from './helpers.ts';
export type { OxlintRules } from './helpers.ts';
export {
  declarationOverride,
  playwrightOverride,
  routesOverride,
  testOverride,
  testingLibraryOverride,
  toolingOverride,
  vendoredOverride,
} from './overrides.ts';
