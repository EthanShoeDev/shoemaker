import {
  Array as Arr,
  Context,
  DateTime,
  Effect,
  Layer,
  Option,
  Order,
  Schema,
} from 'effect';
import { SecureRandom } from 'effect/crypto';
import { SqlClient } from 'effect/sql';

import { FlagConfig } from '../core/flag-config.ts';
import {
  FlagChanged,
  FlagKeyTaken,
  FlagLimitReached,
  FlagNotFound,
  FlagsUnavailable,
  FlagTypeFixed,
  FlagUnreadable,
} from '../core/flag-errors.ts';
import {
  Flag,
  FlagDefinitions,
  FlagStore,
  MAX_FLAG_BYTES,
  MAX_FLAGS,
} from '../core/flag-store.ts';

const StoredConfig = Schema.fromJsonString(FlagConfig);
// A field this version does not know could be one that limits a rule.
const decodeStored = Schema.decodeOption(StoredConfig, {
  onExcessProperty: 'error',
});
// Text nested deep enough makes a decoder throw.
const decodeConfig = (text: string) =>
  Option.liftThrowable(decodeStored)(text).pipe(
    Option.flatten,
    Option.getOrNull,
  );
const encodeConfig = Schema.encodeEffect(StoredConfig);

const Row = Schema.Struct({
  id: Schema.String,
  key: Schema.String,
  version: Schema.Int,
  definition: Schema.String,
  createdAt: Schema.DateTimeUtcFromString,
  updatedAt: Schema.DateTimeUtcFromString,
});
const decodeRows = Schema.decodeUnknownEffect(Schema.Array(Row));

const DefinitionRow = Schema.Struct({
  id: Schema.String,
  key: Schema.String,
  version: Schema.Int,
  definition: Schema.String,
});
const decodeDefinitions = Schema.decodeUnknownEffect(
  Schema.Array(DefinitionRow),
);

const Usage = Schema.Struct({ flags: Schema.Int });
const decodeUsage = Schema.decodeUnknownEffect(Schema.Array(Usage));

const toFlag = ({ definition, ...row }: typeof Row.Type): Flag => ({
  ...row,
  config: decodeConfig(definition),
});

const encoder = new TextEncoder();
const sizeOf = (key: string, definition: string) =>
  encoder.encode(key).length + encoder.encode(definition).length;

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const random = yield* SecureRandom.SecureRandom;

  const columns = sql`id, key, version, definition,
    created_at AS ${sql('createdAt')}, updated_at AS ${sql('updatedAt')}`;

  // A statement that counts rows must not run beside another that adds one. On
  // Postgres the lock makes writers wait for each other, and as it is taken
  // first, what the statement then reads includes what the last one committed.
  // Readers are not held up. SQLite and D1 write one at a time.
  const alone = <A, E, R>(statement: Effect.Effect<A, E, R>) =>
    sql.onDialectOrElse({
      orElse: () => statement,
      pg: () =>
        sql.withTransaction(
          Effect.andThen(
            sql`LOCK TABLE edgehog_flag IN SHARE ROW EXCLUSIVE MODE`,
            statement,
          ),
        ),
    });

  const otherBytes = (projectId: number, id: string) =>
    sql`(SELECT COALESCE(SUM(size), 0) FROM edgehog_flag
      WHERE project_id = ${projectId} AND id <> ${id})`;

  const load = Effect.fn('FlagDefinitions.load')(
    function* (projectId: number) {
      const rows = yield* sql`SELECT id, key, version, definition
        FROM edgehog_flag WHERE project_id = ${projectId}`;
      const decoded = yield* decodeDefinitions(rows);
      return new Map(
        Arr.map(decoded, ({ definition, ...row }) => [
          row.key,
          { ...row, config: decodeConfig(definition) },
        ]),
      );
    },
    Effect.mapError((cause) => FlagsUnavailable.make({ cause })),
  );

  const find = Effect.fnUntraced(function* (projectId: number, id: string) {
    const rows = yield* sql`SELECT ${columns} FROM edgehog_flag
      WHERE id = ${id} AND project_id = ${projectId}`.pipe(
      Effect.flatMap(decodeRows),
      Effect.orDie,
    );
    return Arr.head(rows);
  });

  const get = Effect.fn('FlagStore.get')(function* (
    projectId: number,
    id: string,
  ) {
    const row = yield* find(projectId, id);
    if (Option.isNone(row)) return yield* FlagNotFound.make({ id });
    return toFlag(row.value);
  });

  const list = Effect.fn('FlagStore.list')(function* (projectId: number) {
    const rows = yield* sql`SELECT ${columns} FROM edgehog_flag
      WHERE project_id = ${projectId}`.pipe(
      Effect.flatMap(decodeRows),
      Effect.orDie,
    );
    return Arr.sort(
      Arr.map(rows, toFlag),
      Order.mapInput(Order.String, (flag: Flag) => flag.key),
    );
  });

  const count = Effect.fnUntraced(function* (projectId: number) {
    // Postgres counts in bigint, which its driver gives as one.
    const [row] = yield* sql`SELECT CAST(COUNT(*) AS INTEGER) AS flags
      FROM edgehog_flag WHERE project_id = ${projectId}`.pipe(
      Effect.flatMap(decodeUsage),
      Effect.orDie,
    );
    return row?.flags ?? 0;
  });

  const create = Effect.fn('FlagStore.create')(function* (
    projectId: number,
    flag: { readonly key: string; readonly config: FlagConfig },
  ) {
    const id = yield* random.uuidV7();
    const now = yield* Effect.map(DateTime.now, DateTime.formatIso);
    const definition = yield* Effect.orDie(encodeConfig(flag.config));
    const size = sizeOf(flag.key, definition);
    const [row] = yield* alone(
      sql`INSERT INTO edgehog_flag
          (id, project_id, key, version, size, definition, created_at, updated_at)
        SELECT ${id}, CAST(${projectId} AS INTEGER), ${flag.key}, 1,
          CAST(${size} AS INTEGER), ${definition}, ${now}, ${now}
        WHERE (SELECT COUNT(*) FROM edgehog_flag
            WHERE project_id = ${projectId}) < ${MAX_FLAGS}
          AND ${otherBytes(projectId, id)} + ${size} <= ${MAX_FLAG_BYTES}
        ON CONFLICT (project_id, key) DO NOTHING
        RETURNING ${columns}`,
    ).pipe(Effect.flatMap(decodeRows), Effect.orDie);
    if (row !== undefined) return toFlag(row);
    const taken = yield* sql`SELECT id FROM edgehog_flag
      WHERE project_id = ${projectId} AND key = ${flag.key}`.pipe(Effect.orDie);
    if (taken.length > 0) return yield* FlagKeyTaken.make({ key: flag.key });
    const flags = yield* count(projectId);
    if (flags < MAX_FLAGS) {
      return yield* FlagLimitReached.make({
        limit: 'bytes',
        maximum: MAX_FLAG_BYTES,
      });
    }
    return yield* FlagLimitReached.make({ limit: 'flags', maximum: MAX_FLAGS });
  });

  const update = Effect.fn('FlagStore.update')(function* (
    projectId: number,
    id: string,
    change: { readonly version: number; readonly config: FlagConfig },
  ) {
    const before = yield* get(projectId, id);
    if (before.config === null) return yield* FlagUnreadable.make({ id });
    if (before.config.type !== change.config.type) {
      return yield* FlagTypeFixed.make({ id });
    }
    const now = yield* Effect.map(DateTime.now, DateTime.formatIso);
    const definition = yield* Effect.orDie(encodeConfig(change.config));
    const size = sizeOf(before.key, definition);
    const [row] = yield* alone(
      sql`UPDATE edgehog_flag
        SET definition = ${definition}, size = CAST(${size} AS INTEGER),
          version = version + 1, updated_at = ${now}
        WHERE id = ${id} AND project_id = ${projectId}
          AND version = ${change.version}
          AND ${otherBytes(projectId, id)} + ${size} <= ${MAX_FLAG_BYTES}
        RETURNING ${columns}`,
    ).pipe(Effect.flatMap(decodeRows), Effect.orDie);
    if (row !== undefined) return toFlag(row);
    const after = yield* get(projectId, id);
    if (after.version !== change.version)
      return yield* FlagChanged.make({ id });
    return yield* FlagLimitReached.make({
      limit: 'bytes',
      maximum: MAX_FLAG_BYTES,
    });
  });

  const remove = Effect.fn('FlagStore.remove')(function* (
    projectId: number,
    id: string,
    version: number,
  ) {
    const [row] = yield* sql`DELETE FROM edgehog_flag
      WHERE id = ${id} AND project_id = ${projectId} AND version = ${version}
      RETURNING ${columns}`.pipe(Effect.flatMap(decodeRows), Effect.orDie);
    if (row !== undefined) return toFlag(row);
    yield* get(projectId, id);
    return yield* FlagChanged.make({ id });
  });

  return Context.make(FlagDefinitions, { load }).pipe(
    Context.add(FlagStore, { list, get, create, update, remove }),
  );
});

// Both services, over the host's own database. `flagMigrations` makes the
// table.
export const flagStoreLayer = Layer.effectContext(make).pipe(
  Layer.provide(SecureRandom.layerWebCrypto),
);
