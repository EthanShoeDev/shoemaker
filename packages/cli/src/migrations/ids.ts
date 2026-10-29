// Migration ids, shared with doctor findings so they can point at the fix
// without importing the migrations themselves.
export const MigrationId = {
  oxlintrcToTs: '2026-10-28-oxlintrc-to-ts',
  oxlintFlagsToOptions: '2026-10-28-oxlint-flags-to-options',
  oxfmtrcToTs: '2026-10-28-oxfmtrc-to-ts',
  turboJsonToJsonc: '2026-10-28-turbo-json-to-jsonc',
  lintScriptNames: '2026-10-28-lint-script-names',
  tsgoToTsc: '2026-10-28-tsgo-to-tsc',
  addEnvrc: '2026-10-28-add-envrc',
  catalogCheckToShoebox: '2026-10-28-catalog-check-to-shoebox',
  nixFmtScriptToShoebox: '2026-10-29-nix-fmt-script-to-shoe-box',
} as const;
