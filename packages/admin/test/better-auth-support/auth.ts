import {
  BetterAuth,
  type BetterAuthProps,
  type Database,
  Memory,
  SecondaryStorage,
} from '@alchemy.run/better-auth';
import { RuntimeContext } from 'alchemy/RuntimeContext';
import type { BetterAuthPlugin } from 'better-auth';
import { Array as Arr, Effect, Layer, Schema, String as Str } from 'effect';

import {
  adminPlugin,
  type AnyAuth,
  type AuthInstance,
  authHandler,
  directoryLayer,
  passwordLinksLayer,
  sessionsLayer,
} from '../../src/better-auth.ts';
import type { AdminPluginBrand } from '../../src/better-auth/plugin.ts';
import type {
  AdminSessions,
  PasswordLinks,
  UserDirectory,
} from '../../src/index.ts';
import { access } from '../support/access.ts';
import { Accounts, type Mail } from '../support/accounts.ts';

export const BASE = 'http://localhost:3000';
export const PASSWORD = 'correct horse battery';

// Better Auth's own types cannot be named in an exported declaration.
export interface TestInstance extends AnyAuth {
  readonly api: AnyAuth['api'] & {
    readonly signUpEmail: (input: {
      body: { email: string; name: string; password: string };
    }) => Promise<{ user: { id: string; email: string } }>;
    readonly signInEmail: (input: {
      body: { email: string; password: string };
      returnHeaders: true;
    }) => Promise<{ headers: Headers }>;
    readonly resetPassword: (input: {
      body: { newPassword: string; token: string };
    }) => Promise<unknown>;
  };
}

interface GuardedInstance extends AnyAuth {
  readonly options: {
    readonly basePath?: string | undefined;
    readonly plugins: ReadonlyArray<
      { readonly id: string } | (AdminPluginBrand & { readonly id: string })
    >;
  };
}

export interface UserRow {
  readonly id: string;
  email: string;
  role: string | null;
  banned: boolean | null;
  banReason: string | null;
}

export interface SessionRow {
  readonly token: string;
  readonly userId: string;
  readonly impersonatedBy: string | null;
  expiresAt: Date;
}

// The tables a test looks in.
export type TestDb = {
  user: Array<UserRow>;
  session: Array<SessionRow>;
  account: Array<{ readonly userId: string }>;
};

export interface TestAuth {
  readonly auth: Effect.Effect<TestInstance, never, RuntimeContext>;
  readonly ports: Layer.Layer<AdminSessions | PasswordLinks | UserDirectory>;
  readonly mailbox: Mailbox;
  readonly handler: ReturnType<typeof authHandler>;
  // The same wrapper, over something that only looks at what it is handed.
  readonly handlerOver: (
    handler: AnyAuth['handler'],
  ) => ReturnType<typeof authHandler>;
}

class MailerDown extends Schema.TaggedError<
  MailerDown,
  { readonly brand: unique symbol }
>()('MailerDown', { message: Schema.String }) {}

class Refused extends Schema.TaggedError<
  Refused,
  { readonly brand: unique symbol }
>()('Refused', { cause: Schema.Defect() }) {}

interface Link {
  readonly user: { readonly email: string };
  readonly url: string;
  readonly token: string;
}

interface Mailbox {
  readonly sent: Array<Mail>;
  // Those it was asked to send and failed on.
  readonly lost: Array<Link>;
  broken: boolean;
  // Delivers, and then fails as a provider that answers too late does.
  late: boolean;
  // Whom it can't deliver to.
  refuses: string | null;
}

// What the project would hand its mail provider, whose errors repeat the mail.
const deliver = (mailbox: Mailbox) => (link: Link) => {
  const failed = () => {
    mailbox.lost.push(link);
    return Promise.reject(
      MailerDown.make({ message: `down: ${link.url} ${btoa(link.url)}` }),
    );
  };
  if (mailbox.broken || mailbox.refuses === link.user.email) return failed();
  const landing = new URL(link.url).searchParams.get('callbackURL') ?? '';
  mailbox.sent.push({ to: link.user.email, token: link.token, landing });
  return mailbox.late ? failed() : Promise.resolve();
};

type Extra = Omit<BetterAuthProps, 'plugins' | 'emailAndPassword'>;

// Other plugins, and whether the project has passwords.
export interface Beside {
  readonly before?: ReadonlyArray<BetterAuthPlugin>;
  readonly after?: ReadonlyArray<BetterAuthPlugin>;
  readonly passwords?: boolean;
}

export const options = {
  baseURL: BASE,
  secret: 'test-secret-test-secret-test-secret-test',
  emailAndPassword: {
    enabled: true,
    // Better Auth's own hash takes most of a second per account.
    password: {
      hash: (password: string) => Promise.resolve(password),
      verify: (tried: { readonly hash: string; readonly password: string }) =>
        Promise.resolve(tried.hash === tried.password),
    },
  },
  rateLimit: { enabled: false },
  telemetry: { enabled: false },
  // Better Auth turns its origin check off under vitest.
  advanced: { disableOriginCheck: false },
};

export const makeAuthOver = <E>(
  database: Layer.Layer<Database, E>,
  extra: Extra = {},
  beside: Beside = {},
): Effect.Effect<TestAuth, E> => {
  const mailbox: Mailbox = {
    sent: [],
    lost: [],
    broken: false,
    late: false,
    refuses: null,
  };
  return BetterAuth({
    ...options,
    ...extra,
    emailAndPassword: {
      ...options.emailAndPassword,
      enabled: beside.passwords ?? true,
      requireEmailVerification: true,
      sendResetPassword: deliver(mailbox),
    },
    migrate: false,
    plugins: [
      ...(beside.before ?? []),
      adminPlugin(access),
      ...(beside.after ?? []),
    ],
  }).pipe(
    Effect.map((instance) => {
      const guarded: AuthInstance<GuardedInstance> = instance;
      return {
        auth: instance.auth,
        mailbox,
        ports: Layer.mergeAll(
          sessionsLayer(instance),
          directoryLayer(instance),
          passwordLinksLayer(instance),
        ),
        handler: authHandler(instance),
        handlerOver: (handler: AnyAuth['handler']) => {
          const spied: AuthInstance<GuardedInstance> = {
            auth: Effect.map(guarded.auth, (auth) => ({ ...auth, handler })),
          };
          return authHandler(spied);
        },
      };
    }),
    Effect.provide(database),
  );
};

// Over one in-memory database, which the test can look in.
export const makeAuth = (db: TestDb, extra: Extra = {}, beside: Beside = {}) =>
  makeAuthOver(Memory(db), extra, beside);

// What a browser would send back, with the cookies Better Auth expired left out.
export const cookieHeader = (setCookies: ReadonlyArray<string>) => {
  const jar = new Map<string, string>();
  for (const setCookie of setCookies) {
    const [pair] = Str.split(setCookie, ';');
    const [name] = Str.split(pair, '=');
    if (/max-age=0/iu.test(setCookie)) jar.delete(name);
    else jar.set(name, pair);
  }
  return Arr.join([...jar.values()], '; ');
};

// A store that answers from what it was last given, like any cache.
export const memoryStorage = (values: Map<string, string>) =>
  Layer.succeed(SecondaryStorage, {
    get: (key) => Effect.sync(() => values.get(key) ?? null),
    set: (key, value) => Effect.sync(() => void values.set(key, value)),
    delete: (key) => Effect.sync(() => void values.delete(key)),
    getAndDelete: (key) =>
      Effect.sync(() => {
        const value = values.get(key) ?? null;
        values.delete(key);
        return value;
      }),
    increment: (key) =>
      Effect.sync(() => {
        const next = Number(values.get(key) ?? 0) + 1;
        values.set(key, String(next));
        return next;
      }),
  });

export const openInstance = (auth: TestAuth) =>
  Effect.provide(auth.auth, RuntimeContext.phantom);

export const openContext = (auth: TestAuth) =>
  Effect.flatMap(openInstance(auth), (instance) =>
    Effect.promise(() => instance.$context),
  );

export const updateUser = (
  auth: TestAuth,
  id: string,
  data: Record<string, unknown>,
) =>
  Effect.flatMap(openContext(auth), ({ internalAdapter }) =>
    Effect.promise(() => internalAdapter.updateUser(id, data)),
  );

export const makeAccounts = (auth: TestAuth) => {
  let created = 0;
  return Accounts.of({
    create: Effect.fnUntraced(function* (account) {
      const instance = yield* openInstance(auth);
      const { user } = yield* Effect.promise(() =>
        instance.api.signUpEmail({
          body: {
            email: account.email,
            name: account.name ?? account.email,
            password: PASSWORD,
          },
        }),
      );
      created += 1;
      yield* updateUser(auth, user.id, {
        role: account.roles ?? 'user',
        emailVerified: true,
        createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, created)),
      });
      return { id: user.id, email: user.email };
    }),
    signIn: Effect.fnUntraced(function* (id) {
      const { internalAdapter } = yield* openContext(auth);
      const user = yield* Effect.promise(() =>
        internalAdapter.findUserById(id),
      );
      const instance = yield* openInstance(auth);
      const { headers } = yield* Effect.promise(() =>
        instance.api.signInEmail({
          body: { email: user?.email ?? '', password: PASSWORD },
          returnHeaders: true,
        }),
      );
      return cookieHeader(headers.getSetCookie());
    }),
    setRoles: (id, stored) =>
      Effect.asVoid(updateUser(auth, id, { role: stored })),
    mail: Effect.sync(() => auth.mailbox.sent),
    breakMail: Effect.sync(() => {
      auth.mailbox.broken = true;
    }),
    choosePassword: Effect.fnUntraced(function* (token, newPassword) {
      const instance = yield* openInstance(auth);
      yield* Effect.promise(() =>
        instance.api.resetPassword({ body: { newPassword, token } }),
      );
    }),
    signInWith: Effect.fnUntraced(function* (email, password) {
      const instance = yield* openInstance(auth);
      return yield* Effect.tryPromise({
        try: () =>
          instance.api.signInEmail({
            body: { email, password },
            returnHeaders: true,
          }),
        catch: (cause) => Refused.make({ cause }),
      }).pipe(
        Effect.map(({ headers }) => cookieHeader(headers.getSetCookie())),
        Effect.option,
      );
    }),
  });
};

export const backend = (auth: TestAuth) =>
  Layer.merge(auth.ports, Layer.succeed(Accounts, makeAccounts(auth)));
