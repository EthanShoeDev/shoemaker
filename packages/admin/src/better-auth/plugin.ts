import type {
  AuthContext,
  BetterAuthOptions,
  BetterAuthPlugin,
} from 'better-auth';
import { admin, type AdminOptions } from 'better-auth/plugins/admin';
import { Array as Arr, Schema } from 'effect';

import { guardAdapter, guardStorage, IMPERSONATION_SECONDS } from './guard.ts';
import { isAdminPath, isStop } from './path.ts';

const HTTP_NOT_FOUND = 404;

export class UnsafeAuthOptions extends Schema.TaggedError<
  UnsafeAuthOptions,
  { readonly brand: unique symbol }
>()('UnsafeAuthOptions', { message: Schema.String }) {}

// Marks the one admin plugin the ports accept.
const BRAND = 'shoemaker-admin';

export interface AdminPluginBrand {
  readonly guardedBy: typeof BRAND;
}

// What `defineAccess` hands over.
export interface PluginAccess<
  Ac extends AdminOptions['ac'],
  Roles extends AdminOptions['roles'],
> {
  readonly ac: Ac;
  readonly roles: Roles;
  readonly adminRoles: ReadonlyArray<string>;
}

export interface GuardedOptions<
  Ac extends AdminOptions['ac'],
  Roles extends AdminOptions['roles'],
> extends AdminOptions {
  ac: Ac;
  roles: Roles;
}

// Thrown as Better Auth starts, so it serves nothing.
const refuseUnsafe = (options: BetterAuthOptions) => {
  const plugins = Arr.filter(
    options.plugins ?? [],
    (plugin) => plugin.id === 'admin',
  );
  if (plugins.length !== 1) {
    throw UnsafeAuthOptions.make({
      message: 'Better Auth has a second admin plugin beside adminPlugin().',
    });
  }
  // Ending such a session is neither immediate nor complete.
  if (
    options.secondaryStorage !== undefined &&
    options.session?.storeSessionInDatabase !== true
  ) {
    throw UnsafeAuthOptions.make({
      message:
        'Better Auth keeps sessions only in secondary storage: set session.storeSessionInDatabase.',
    });
  }
};

// Better Auth's admin plugin as the core needs it: an impersonation lasts an
// hour whatever the cookies and the project's hooks say, its admin routes
// answer 404 even without `authHandler`, and options that would bypass a check
// (`adminUserIds`, `allowImpersonatingAdmins`, a longer duration) are not
// accepted.
export const adminPlugin = <
  Ac extends AdminOptions['ac'],
  Roles extends AdminOptions['roles'],
>(
  access: PluginAccess<Ac, Roles>,
  options: Pick<AdminOptions, 'bannedUserMessage' | 'schema'> = {},
): AdminPluginBrand & ReturnType<typeof admin<GuardedOptions<Ac, Roles>>> => {
  const plugin = admin<GuardedOptions<Ac, Roles>>({
    ...options,
    ac: access.ac,
    roles: access.roles,
    adminRoles: [...access.adminRoles],
    impersonationSessionDuration: IMPERSONATION_SECONDS,
  });
  const brand: AdminPluginBrand &
    Required<Pick<BetterAuthPlugin, 'onRequest'>> = {
    guardedBy: BRAND,
    // Only requests come here: `auth.api` calls do not.
    onRequest: (request, context) => {
      const { pathname } = new URL(request.url);
      const bases = [new URL(context.baseURL).pathname];
      return Promise.resolve(
        isAdminPath(pathname, bases) && !isStop(request.method, pathname, bases)
          ? { response: new Response(null, { status: HTTP_NOT_FOUND }) }
          : undefined,
      );
    },
  };
  return {
    ...plugin,
    ...brand,
    init: (context: AuthContext) => {
      refuseUnsafe(context.options);
      if (context.secondaryStorage !== undefined) {
        guardStorage(context.secondaryStorage);
      }
      return {
        ...plugin.init(context),
        context: { adapter: guardAdapter(context.adapter) },
      };
    },
  };
};
