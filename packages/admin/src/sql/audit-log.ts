import {
  Array as Arr,
  DateTime,
  Effect,
  Layer,
  Schema,
  String as Str,
} from 'effect';
import { SecureRandom } from 'effect/crypto';
import { SqlClient } from 'effect/sql';

import {
  AuditEntry,
  AuditLog,
  AuditWriteFailed,
  InvalidCursor,
  type NewAuditEntry,
} from '../core/audit.ts';

const USER = 'user';

// No row can hold a NUL, which Postgres refuses to even compare with.
const StoredText = Schema.NonEmptyString.check(
  Schema.makeFilter((text) => !Str.includes('\0')(text)),
);

// The last row's `created_at` and `id` as stored, so the next page compares
// the text the index orders. Opaque to callers.
const Cursor = Schema.StringFromBase64Url.pipe(
  Schema.decodeTo(
    Schema.fromJsonString(Schema.Tuple([StoredText, StoredText])),
  ),
);
const decodeCursor = Schema.decodeEffect(Cursor);
const encodeCursor = Schema.encodeEffect(Cursor);

const Row = Schema.Struct({
  id: Schema.String,
  actorId: Schema.String,
  actorEmail: Schema.NullOr(Schema.String),
  action: Schema.String,
  targetKind: Schema.NullOr(Schema.String),
  targetId: Schema.NullOr(Schema.String),
  targetUserId: Schema.NullOr(Schema.String),
  detail: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
});
const decodeRows = Schema.decodeUnknownEffect(Schema.Array(Row));
const decodeEntry = Schema.decodeEffect(AuditEntry);

// Entries from before the package name a user and no kind.
const toEntry = (row: typeof Row.Type) =>
  decodeEntry(
    row.targetKind === null && row.targetUserId !== null
      ? { ...row, targetKind: USER, targetId: row.targetUserId }
      : row,
  );

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const random = yield* SecureRandom.SecureRandom;

  // Bytewise on every database, which the pair comparison and the order must
  // agree on. SQLite already compares text that way.
  const bytewise = (column: 'created_at' | 'id') =>
    sql.onDialectOrElse({
      orElse: () => sql`${sql(column)}`,
      pg: () => sql`${sql(column)} COLLATE "C"`,
    });

  const record = Effect.fn('AuditLog.record')(
    function* (entry: NewAuditEntry) {
      const now = yield* DateTime.now;
      // Version 7, so entries of one millisecond stay in the order they were
      // written by this process.
      const id = yield* random.uuidV7();
      const { target } = entry;
      yield* sql`INSERT INTO admin_audit_log
          (id, actor_id, actor_email, action, target_kind, target_id,
            target_user_id, detail, created_at)
        VALUES (${id}, ${entry.actorId}, ${entry.actorEmail}, ${entry.action},
          ${target?.kind ?? null}, ${target?.id ?? null},
          ${target?.kind === USER ? target.id : null},
          ${entry.detail}, ${DateTime.formatIso(now)})`;
    },
    Effect.mapError((cause) => AuditWriteFailed.make({ cause })),
  );

  const list = Effect.fn('AuditLog.list')(function* (options: {
    readonly limit: number;
    readonly cursor?: string | undefined;
  }) {
    const after =
      options.cursor === undefined
        ? sql`1 = 1`
        : yield* decodeCursor(options.cursor).pipe(
            Effect.mapBoth({
              onFailure: () => InvalidCursor.make({}),
              onSuccess: ([
                createdAt,
                id,
              ]) => sql`(${bytewise('created_at')}, ${bytewise('id')})
                    < (${createdAt}, ${id})`,
            }),
          );
    const rows = yield* sql`SELECT id, actor_id AS "actorId",
          actor_email AS "actorEmail", action, target_kind AS "targetKind",
          target_id AS "targetId", target_user_id AS "targetUserId",
          detail, created_at AS "createdAt"
        FROM admin_audit_log
        WHERE ${after}
        ORDER BY ${bytewise('created_at')} DESC, ${bytewise('id')} DESC
        LIMIT ${options.limit + 1}`.pipe(
      Effect.flatMap(decodeRows),
      Effect.orDie,
    );
    const page = Arr.take(rows, options.limit);
    const last = page.at(-1);
    return {
      items: yield* Effect.orDie(
        Effect.forEach(page, toEntry, { concurrency: 1 }),
      ),
      nextCursor:
        rows.length > options.limit && last !== undefined
          ? yield* Effect.orDie(encodeCursor([last.createdAt, last.id]))
          : null,
    };
  });

  return AuditLog.of({ record, list });
});

// Kept in `admin_audit_log`, which `adminMigrations` makes.
export const auditLogLayer = Layer.effect(AuditLog, make).pipe(
  Layer.provide(SecureRandom.layerWebCrypto),
);
