import { Context, type Effect, Schema } from 'effect';

import { FlagConfig, FlagName } from './flag-config.ts';
import type {
  FlagChanged,
  FlagKeyTaken,
  FlagLimitReached,
  FlagNotFound,
  FlagsUnavailable,
  FlagTypeFixed,
  FlagUnreadable,
} from './flag-errors.ts';

// What one project may hold, which bounds what reading its flags costs.
export const MAX_FLAGS = 500;
export const MAX_FLAG_BYTES = 1_000_000;

export const Flag = Schema.Struct({
  id: Schema.String,
  key: Schema.String,
  // Null for a row this version cannot read. It answers nothing, and can be
  // deleted but not changed.
  config: Schema.NullOr(FlagConfig),
  version: Schema.Int,
  createdAt: Schema.DateTimeUtcFromString,
  updatedAt: Schema.DateTimeUtcFromString,
});
export type Flag = typeof Flag.Type;

export const NewFlag = Schema.Struct({ key: FlagName, config: FlagConfig });

export interface FlagDefinition {
  readonly id: string;
  readonly key: string;
  readonly config: FlagConfig | null;
  readonly version: number;
}

export type FlagDefinitionMap = ReadonlyMap<string, FlagDefinition>;

// Where a server reads a project's definitions: all of them, in one query.
export class FlagDefinitions extends Context.Service<
  FlagDefinitions,
  {
    readonly load: (
      projectId: number,
    ) => Effect.Effect<FlagDefinitionMap, FlagsUnavailable>;
  }
>()('shoemaker-edgehog/core/flag-store/FlagDefinitions') {}

// Where the admin keeps them. A storage failure is a defect here.
export class FlagStore extends Context.Service<
  FlagStore,
  {
    // By key.
    readonly list: (projectId: number) => Effect.Effect<ReadonlyArray<Flag>>;
    readonly get: (
      projectId: number,
      id: string,
    ) => Effect.Effect<Flag, FlagNotFound>;
    readonly create: (
      projectId: number,
      flag: typeof NewFlag.Type,
    ) => Effect.Effect<Flag, FlagKeyTaken | FlagLimitReached>;
    // Only over the version the caller read.
    readonly update: (
      projectId: number,
      id: string,
      change: { readonly version: number; readonly config: FlagConfig },
    ) => Effect.Effect<
      Flag,
      | FlagChanged
      | FlagLimitReached
      | FlagNotFound
      | FlagTypeFixed
      | FlagUnreadable
    >;
    readonly remove: (
      projectId: number,
      id: string,
      version: number,
    ) => Effect.Effect<Flag, FlagChanged | FlagNotFound>;
  }
>()('shoemaker-edgehog/core/flag-store/FlagStore') {}

export interface FlagProject {
  // The same id the project has in error tracking.
  readonly id: number;
  readonly name: string;
}

// The projects the host declares. No other holds flags.
export class FlagProjects extends Context.Service<
  FlagProjects,
  ReadonlyArray<FlagProject>
>()('shoemaker-edgehog/core/flag-store/FlagProjects') {}
