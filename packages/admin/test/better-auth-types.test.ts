import { BetterAuth, Memory } from '@alchemy.run/better-auth';
import { assert, describe, it } from '@effect/vitest';
import { admin, magicLink } from 'better-auth/plugins';
import { Context, Effect, Layer } from 'effect';
import { Headers } from 'effect/http';

import {
  adminPlugin,
  authHandler,
  directoryLayer,
  passwordLinksLayer,
  sessionsLayer,
} from '../src/better-auth.ts';
import { AdminSessions } from '../src/index.ts';
import { access } from './support/access.ts';

const link = magicLink({ sendMagicLink: () => Promise.resolve() });

const project = Effect.map(
  BetterAuth({
    basePath: '/api/auth',
    disabledPaths: ['/token'],
    session: { cookieCache: { enabled: true, maxAge: 300 } },
    plugins: [link, adminPlugin(access)],
  }),
  (auth) => ({
    layer: Layer.merge(sessionsLayer(auth), directoryLayer(auth)),
    fetch: authHandler(auth),
  }),
);

const stock = Effect.map(
  BetterAuth({ plugins: [link, admin()] }),
  // @ts-expect-error -- Better Auth's own admin plugin is not the guarded one
  (auth) => sessionsLayer(auth),
);

const bare = Effect.map(
  BetterAuth({ plugins: [link] }),
  // @ts-expect-error -- no admin plugin at all
  (auth) => sessionsLayer(auth),
);

const twice = BetterAuth({
  baseURL: 'http://localhost:3000',
  secret: 'test-secret-test-secret-test-secret-test',
  telemetry: { enabled: false },
  plugins: [adminPlugin(access), admin({ adminUserIds: ['eve'] })],
}).pipe(Effect.provide(Memory()));

const withMailer = Effect.map(
  BetterAuth({
    emailAndPassword: {
      enabled: true,
      sendResetPassword: () => Promise.resolve(),
    },
    plugins: [link, adminPlugin(access)],
  }),
  (auth) => passwordLinksLayer(auth),
);

const withoutMailer = Effect.map(
  BetterAuth({
    emailAndPassword: { enabled: true },
    plugins: [link, adminPlugin(access)],
  }),
  // @ts-expect-error -- nothing sends the link
  (auth) => passwordLinksLayer(auth),
);

const withoutPasswords = Effect.map(
  BetterAuth({
    emailAndPassword: {
      enabled: false,
      sendResetPassword: () => Promise.resolve(),
    },
    plugins: [link, adminPlugin(access)],
  }),
  // @ts-expect-error -- nobody signs in with a password
  (auth) => passwordLinksLayer(auth),
);

describe('a project’s instance', () => {
  it('typechecks for password links only with a mailer', () => {
    assert.lengthOf([withMailer, withoutMailer, withoutPasswords], 3);
  });

  it('typechecks only with the guarded admin plugin', () => {
    assert.lengthOf([project, stock, bare], 3);
  });

  it.effect('is refused with a second admin plugin', () =>
    Effect.gen(function* () {
      const auth = yield* twice;
      const sessions = yield* Layer.build(sessionsLayer(auth));
      const exit = yield* Effect.exit(
        Context.get(sessions, AdminSessions).find(Headers.empty),
      );
      assert.include(String(exit), 'UnsafeAuthOptions');
    }),
  );
});
