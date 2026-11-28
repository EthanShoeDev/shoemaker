import { NodeServices } from '@effect/platform-node';
import { PgClient } from '@effect/sql-pg';
import {
  Array as Arr,
  Clock,
  Config,
  Context,
  Effect,
  FileSystem,
  Layer,
  Match,
  Option,
  Path,
  Redacted,
  Schedule,
  Scope,
  String as Str,
} from 'effect';
import { SecureRandom } from 'effect/crypto';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import { SqlClient } from 'effect/sql';
import { TestClock } from 'effect/testing';

// PGlite has one connection, so what two deploys do to each other needs a
// server: the one at TEST_POSTGRES_URL (CI's service), or a throwaway one from
// the binaries on the PATH (the dev shell's).
export type PostgresSource =
  | { readonly kind: 'url'; readonly url: string }
  | {
      readonly kind: 'binaries';
      readonly initdb: string;
      readonly postgres: string;
    }
  | { readonly kind: 'none' };

type Connection = Pick<PgClient.PgClientConfig, 'host' | 'url' | 'username'>;

const START_ATTEMPTS = 200;

// The real path, since Postgres finds its files beside its binary and a Nix
// profile holds only a link to it.
const onPath = Effect.fnUntraced(function* (binary: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const value = yield* Config.String('PATH').pipe(Config.withDefault(''));
  return yield* Effect.firstSuccessOf(
    Arr.map(Str.split(value, ':'), (dir) =>
      fs.realPath(path.join(dir, binary)),
    ),
  ).pipe(Effect.option);
});

export const findPostgres = Effect.gen(function* () {
  const url = yield* Config.String('TEST_POSTGRES_URL').pipe(Config.option);
  const initdb = yield* onPath('initdb');
  const postgres = yield* onPath('postgres');
  const source: PostgresSource = Option.isSome(url)
    ? { kind: 'url', url: url.value }
    : Option.isSome(initdb) && Option.isSome(postgres)
      ? { kind: 'binaries', initdb: initdb.value, postgres: postgres.value }
      : { kind: 'none' };
  return source;
});

// Listens only on a socket in its own directory, and goes when the scope does.
const startCluster = Effect.fnUntraced(function* (
  source: Extract<PostgresSource, { readonly kind: 'binaries' }>,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const dir = yield* fs.makeTempDirectoryScoped({ prefix: 'pg' });
  const data = path.join(dir, 'data');
  const exit = yield* spawner.exitCode(
    ChildProcess.make(source.initdb, [
      '-D',
      data,
      '-U',
      'postgres',
      '-A',
      'trust',
      '-E',
      'utf-8',
      '--no-sync',
    ]),
  );
  if (exit !== 0) {
    return yield* Effect.die(new Error(`initdb failed with code ${exit}.`));
  }
  yield* spawner.spawn(
    ChildProcess.make(
      source.postgres,
      ['-D', data, '-k', dir, '-c', 'listen_addresses=', '-c', 'fsync=off'],
      {
        stdout: 'ignore',
        stderr: 'ignore',
        // A fast shutdown: SIGTERM waits for every client to leave.
        killSignal: 'SIGINT',
        forceKillAfter: '5 seconds',
      },
    ),
  );
  // A host that is a directory is where the socket is.
  return { host: dir, username: 'postgres' } satisfies Connection;
});

const connectionTo = (source: PostgresSource) =>
  Match.value(source).pipe(
    Match.discriminatorsExhaustive('kind')({
      url: ({ url }) =>
        Effect.succeed({ url: Redacted.make(url) } satisfies Connection),
      binaries: startCluster,
      none: () => Effect.die(new Error('There is no Postgres.')),
    }),
  );

// On the real clock even in a test: a test clock never lets the client's own
// timers fire, so a connection that hangs would wait for the test's timeout
// instead of the client's.
const connect = (connection: Connection, database: string) =>
  PgClient.layer({ ...connection, database }).pipe(
    Layer.provide(Layer.succeed(Clock.Clock, Clock.Clock.defaultValue())),
  );

export class Postgres extends Context.Service<
  Postgres,
  // A new, empty database, as a layer that opens its own connections each time
  // it is built.
  { readonly database: Effect.Effect<ReturnType<typeof connect>> }
>()('shoemaker-utils/testing/postgres') {}

export const postgresLayer = (source: PostgresSource) =>
  Layer.effect(
    Postgres,
    Effect.gen(function* () {
      const scope = yield* Effect.scope;
      const random = yield* SecureRandom.SecureRandom;
      const connection = yield* connectionTo(source);
      const admin = yield* Layer.build(connect(connection, 'postgres'));
      const sql = Context.get(admin, SqlClient.SqlClient);
      // Until the server accepts connections.
      yield* sql`SELECT 1`.pipe(
        Effect.retry({
          times: START_ATTEMPTS,
          schedule: Schedule.spaced('50 millis'),
        }),
        // The test clock does not move by itself.
        TestClock.withLive,
      );
      const create = Effect.gen(function* () {
        const id = yield* random.uuidV4();
        const name = `test_${Arr.join(Str.split(id, '-'), '')}`;
        yield* sql`CREATE DATABASE ${sql(name)}`;
        return name;
      });
      const database = Effect.acquireRelease(create, (name) =>
        Effect.ignore(sql`DROP DATABASE ${sql(name)} WITH (FORCE)`),
      ).pipe(
        Scope.provide(scope),
        Effect.map((name) => connect(connection, name)),
        Effect.orDie,
      );
      return Postgres.of({ database });
    }),
  ).pipe(
    Layer.provide([NodeServices.layer, SecureRandom.layerWebCrypto]),
    Layer.orDie,
  );
