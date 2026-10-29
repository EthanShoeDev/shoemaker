import { Option, Schema } from 'effect';

const Deps = Schema.Record(Schema.String, Schema.String);
const decodePkg = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({
      scripts: Schema.optional(Deps),
      dependencies: Schema.optional(Deps),
      devDependencies: Schema.optional(Deps),
      peerDependencies: Schema.optional(Deps),
      workspaces: Schema.optional(
        Schema.Union([
          Schema.Array(Schema.String),
          Schema.Struct({ catalog: Schema.optional(Deps) }),
        ]),
      ),
    }),
  ),
);

// The fields tests assert on, defaulted so tests can index them directly.
export const pkgIn = (content: string | undefined) => {
  const pkg = Option.getOrUndefined(decodePkg(content ?? '{}'));
  const workspaces = pkg?.workspaces;
  return {
    scripts: pkg?.scripts ?? {},
    dependencies: pkg?.dependencies ?? {},
    devDependencies: pkg?.devDependencies ?? {},
    peerDependencies: pkg?.peerDependencies ?? {},
    catalog:
      workspaces !== undefined && 'catalog' in workspaces
        ? (workspaces.catalog ?? {})
        : {},
  };
};
