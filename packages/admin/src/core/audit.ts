import { Context, type Effect, Schema } from 'effect';

export interface AuditTarget {
  readonly kind: string;
  readonly id: string;
}

export const AuditEntry = Schema.Struct({
  id: Schema.String,
  actorId: Schema.String,
  // Null in entries older than the package.
  actorEmail: Schema.NullOr(Schema.String),
  action: Schema.String,
  targetKind: Schema.NullOr(Schema.String),
  targetId: Schema.NullOr(Schema.String),
  // The same id as `targetId` when the target is a user.
  targetUserId: Schema.NullOr(Schema.String),
  detail: Schema.NullOr(Schema.String),
  createdAt: Schema.DateTimeUtcFromString,
});

export const AuditPage = Schema.Struct({
  items: Schema.Array(AuditEntry),
  nextCursor: Schema.NullOr(Schema.String),
});

export interface NewAuditEntry {
  readonly actorId: string;
  readonly actorEmail: string | null;
  readonly action: string;
  readonly target: AuditTarget | null;
  readonly detail: string | null;
}

export class AuditWriteFailed extends Schema.TaggedError<
  AuditWriteFailed,
  { readonly brand: unique symbol }
>()('AuditWriteFailed', { cause: Schema.Defect() }) {}

// A cursor this log did not hand out.
export class InvalidCursor extends Schema.TaggedError<
  InvalidCursor,
  { readonly brand: unique symbol }
>()('InvalidCursor', {}, { httpApiStatus: 400 }) {}

// Where entries are kept. `/sql` implements it.
export class AuditLog extends Context.Service<
  AuditLog,
  {
    readonly record: (
      entry: NewAuditEntry,
    ) => Effect.Effect<void, AuditWriteFailed>;
    // Newest first. The store is not asked to clamp: its caller does.
    readonly list: (options: {
      readonly limit: number;
      readonly cursor?: string | undefined;
    }) => Effect.Effect<typeof AuditPage.Type, InvalidCursor>;
  }
>()('shoemaker-admin/core/audit/AuditLog') {}

// What a handler may add to its request's one entry.
export class AuditTrail extends Context.Service<
  AuditTrail,
  {
    // Replaces the target taken from the endpoint's `id` parameter.
    readonly target: (target: AuditTarget) => Effect.Effect<void>;
    readonly detail: (detail: string) => Effect.Effect<void>;
    // Should the request fail now, it may have acted all the same, so the log
    // says so.
    readonly mayHaveActed: Effect.Effect<void>;
    // The request succeeded and changed nothing, so it leaves no entry.
    readonly nothingChanged: Effect.Effect<void>;
  }
>()('shoemaker-admin/core/audit/AuditTrail') {}
