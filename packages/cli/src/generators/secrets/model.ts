// Manager-neutral env/secret schema, rendered to varlock `.env.schema` or
// `secretspec.toml`. App code never reads env directly: it goes through the
// generated `@scope/env` package (Effect `Config`).

export interface EnvVar {
  // SCREAMING_SNAKE name, identical in the schema, the process env and the
  // `Config` key.
  readonly key: string;
  readonly description: string;
  readonly required: boolean;
  // Secrets are redacted (`Config.redacted`) and never get committed defaults.
  readonly sensitive: boolean;
  readonly default?: string;
  // varlock `@type` (e.g. `url`, `port`, `enum(a, b)`); secretspec ignores it.
  readonly type?: string;
  // Which app/package reads it, for varlock tags and secretspec scoping.
  readonly tags?: ReadonlyArray<string>;
}
