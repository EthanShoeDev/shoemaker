import { isAPIErrorLike } from '@alchemy.run/better-auth';
import { Effect, Layer, Option, Predicate, Schema } from 'effect';

import { Forbidden, LinkNotSent } from '../core/errors.ts';
import { PasswordLinks } from '../core/ports.ts';
import { findUser } from './directory.ts';
import {
  type AnyAuth,
  type AuthInstance,
  type HasAdminPlugin,
  openAuth,
} from './instance.ts';
import { observedMailer, watch } from './mailer.ts';
import { UnsafeAuthOptions } from './plugin.ts';

// Fails typecheck for an instance that cannot email a link.
export type HasMailer<A extends AnyAuth> = A['options'] extends {
  readonly emailAndPassword: {
    readonly enabled: infer Enabled;
    readonly sendResetPassword: (...args: never) => unknown;
  };
}
  ? [Enabled] extends [false]
    ? { readonly 'set emailAndPassword.enabled': never }
    : unknown
  : { readonly 'set emailAndPassword.sendResetPassword': never };

// Says little of the cause: a failed query may hold the token it was to store.
class LinkFailed extends Schema.TaggedError<
  LinkFailed,
  { readonly brand: unique symbol }
>()('LinkFailed', { userId: Schema.String, status: Schema.String }) {}

const unsafe = (message: string) =>
  Effect.die(UnsafeAuthOptions.make({ message }));

type Context = Awaited<AnyAuth['$context']>;

// Better Auth takes a missing base URL from the request it serves, and a link
// made here has none: it would have no address.
const hasAddress = ({ baseURL, options }: Context) =>
  baseURL !== '' ||
  (Predicate.hasProperty(options, 'baseURL') &&
    Predicate.hasProperty(options.baseURL, 'fallback') &&
    Predicate.isString(options.baseURL.fallback));

// What the mailer is watched through, once a link is known to be worth sending.
const prepare = Effect.fnUntraced(function* (
  context: Context,
  landing: string,
) {
  const watchers = observedMailer(context);
  if (Option.isNone(watchers)) {
    return yield* unsafe(
      'Better Auth cannot email links: enable emailAndPassword with sendResetPassword.',
    );
  }
  if (!hasAddress(context)) {
    return yield* unsafe(
      'Better Auth needs a baseURL, or a fallback of a dynamic one, to email links.',
    );
  }
  // The link would be refused when it is followed.
  if (!context.isTrustedOrigin(landing, { allowRelativePaths: true })) {
    return yield* unsafe(
      `Better Auth does not trust ${landing}, where links land: add its origin to trustedOrigins.`,
    );
  }
  return watchers.value;
});

const ready = Effect.fn('PasswordLinks.ready')(function* (
  instance: AuthInstance<AnyAuth>,
  landing: string,
) {
  const { context } = yield* openAuth(instance);
  yield* prepare(context, landing);
});

const send = Effect.fn('PasswordLinks.send')(function* (
  instance: AuthInstance<AnyAuth>,
  options: { readonly userId: string; readonly landing: string },
) {
  const { auth, context } = yield* openAuth(instance);
  const watchers = yield* prepare(context, options.landing);
  const user = yield* findUser(context, options.userId);
  // Better Auth looks the account up by its email in lower case.
  const answering = yield* Effect.promise(() =>
    context.internalAdapter.findUserByEmail(user.email),
  );
  if (answering?.user.id !== user.id) {
    return yield* Forbidden.make({
      message: 'Better Auth does not find this account by its email.',
    });
  }
  const { forget, watcher } = watch(watchers, user.id);
  yield* Effect.tryPromise({
    try: () =>
      auth.api.requestPasswordReset({
        body: { email: user.email, redirectTo: options.landing },
      }),
    catch: (error) =>
      LinkFailed.make({
        userId: user.id,
        status: isAPIErrorLike(error) ? String(error.status) : 'unknown',
      }),
  }).pipe(Effect.orDie, Effect.ensuring(Effect.sync(forget)));
  if (Option.isNone(watcher.outcome)) {
    return yield* Effect.die(
      `Better Auth sent no password link to user ${user.id}.`,
    );
  }
  const asked = watcher.outcome.value;
  const outcome = yield* Effect.promise(() => asked);
  if (!outcome.sent) {
    yield* Effect.logError('A password link may not have been sent.').pipe(
      Effect.annotateLogs({ userId: user.id, reason: outcome.reason }),
    );
    return yield* LinkNotSent.make({});
  }
});

// Through Better Auth's own password reset, and the project's mailer.
export const passwordLinksLayer = <A extends AnyAuth>(
  instance: AuthInstance<A> & HasAdminPlugin<A> & HasMailer<A>,
) =>
  Layer.succeed(PasswordLinks, {
    ready: (landing) => ready(instance, landing),
    send: (options) => send(instance, options),
  });
