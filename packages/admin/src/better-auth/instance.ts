import { RuntimeContext } from 'alchemy/RuntimeContext';
import type { AuthContext } from 'better-auth';
import { Effect, Option, Schema, Scope } from 'effect';

import { isGuardedAdapter } from './guard.ts';
import { type AdminPluginBrand, UnsafeAuthOptions } from './plugin.ts';

export interface SessionQuery {
  model: 'session';
  where: Array<{
    field: string;
    value: string | Date | null;
    operator?: 'eq' | 'gt' | 'ne';
  }>;
}

// The parts of a Better Auth instance this package uses, so projects with any
// other plugins and options fit. The methods are typed by what is sent: their
// results are decoded.
export interface AnyAuth {
  readonly handler: (request: Request) => Promise<Response>;
  readonly api: {
    readonly getSession: (input: {
      headers: Headers;
      query: { disableCookieCache: boolean; disableRefresh: boolean };
    }) => Promise<unknown>;
    // Trusted when it is handed no headers.
    readonly createUser: (input: {
      body: { email: string; name: string; data: Record<string, unknown> };
    }) => Promise<unknown>;
    readonly requestPasswordReset: (input: {
      body: { email: string; redirectTo: string };
    }) => Promise<unknown>;
    readonly impersonateUser: (input: {
      body: { userId: string };
      headers: Headers;
      returnHeaders: true;
    }) => Promise<unknown>;
  };
  readonly options: {
    readonly basePath?: string | undefined;
    readonly plugins?: ReadonlyArray<{ readonly id: string }> | undefined;
    readonly emailAndPassword?: object | undefined;
  };
  readonly $context: Promise<
    Pick<
      AuthContext,
      'baseURL' | 'internalAdapter' | 'isTrustedOrigin' | 'secondaryStorage'
    > & {
      readonly options: object;

      // Better Auth's own type depends on every option of the instance.
      readonly adapter: {
        readonly findOne: (query: SessionQuery) => Promise<unknown>;
        readonly create: (query: {
          model: 'account';
          data: Record<string, unknown>;
          forceAllowId: true;
        }) => Promise<unknown>;
        readonly findMany: (
          query: SessionQuery & { limit: number; offset?: number },
        ) => Promise<unknown>;
      };
    }
  >;
}

// A project's instance, as `BetterAuth(...)` of `@alchemy.run/better-auth`
// returns it.
export interface AuthInstance<A extends AnyAuth> {
  readonly auth: Effect.Effect<A, never, RuntimeContext>;
}

// Fails typecheck for an instance without `adminPlugin`.
export type HasAdminPlugin<A extends AnyAuth> = [
  Extract<NonNullable<A['options']['plugins']>[number], AdminPluginBrand>,
] extends [never]
  ? {
      readonly 'install adminPlugin() of shoemaker-admin/better-auth': never;
    }
  : unknown;

const unsafe = (message: string) =>
  Effect.die(UnsafeAuthOptions.make({ message }));

// Alchemy builds one Better Auth instance per execution, on its scope, and
// only then can its options be read, so what types cannot rule out is refused
// as it starts.
export const openAuth = Effect.fnUntraced(function* (
  instance: AuthInstance<AnyAuth>,
) {
  const scope = yield* Effect.serviceOption(Scope.Scope);
  if (Option.isNone(scope)) {
    return yield* unsafe(
      'Better Auth needs the scope of the request it serves, and there is none.',
    );
  }
  const auth = yield* instance.auth;
  const context = yield* Effect.promise(() => auth.$context);
  if (!isGuardedAdapter(context.adapter)) {
    return yield* unsafe(
      'Better Auth needs adminPlugin() of shoemaker-admin/better-auth.',
    );
  }
  const secondary = context.secondaryStorage !== undefined;
  return { auth, context, secondary };
  // oxlint-disable-next-line effecttsgo/strict-effect-provide -- an empty layer that only satisfies Alchemy's type
}, Effect.provide(RuntimeContext.phantom));

export const toWebHeaders = (headers: Readonly<Record<string, string>>) =>
  new Headers({ ...headers });

const StoredUser = Schema.Struct({
  id: Schema.String,
  email: Schema.String,
  name: Schema.String,
  role: Schema.String.pipe(Schema.NullishOr, Schema.optional),
  banned: Schema.Boolean.pipe(Schema.NullishOr, Schema.optional),
  banReason: Schema.String.pipe(Schema.NullishOr, Schema.optional),
  banExpires: Schema.Date.pipe(Schema.NullishOr, Schema.optional),
  createdAt: Schema.Date,
});

export type StoredUser = typeof StoredUser.Type;

const decodeUser = Schema.decodeUnknownEffect(StoredUser);
const decodeUserList = Schema.decodeUnknownEffect(Schema.Array(StoredUser));

export const toStoredUser = (row: unknown) => Effect.orDie(decodeUser(row));
const HasId = Schema.Struct({ id: Schema.String });
const decodeId = Schema.decodeUnknownEffect(HasId);

// All that a cached user may be trusted for: its dates have become strings.
export const toUserId = (row: unknown) =>
  Effect.map(Effect.orDie(decodeId(row)), ({ id }) => id);

export const toStoredUsers = (rows: unknown) =>
  Effect.orDie(decodeUserList(rows));
