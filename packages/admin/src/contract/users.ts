import { Schema } from 'effect';
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
} from 'effect/http-api';

import { Audited, RequiredPermissions } from '../core/annotations.ts';
import {
  EmailTaken,
  Forbidden,
  LinkNotSent,
  OperationUnsupported,
  UnknownRole,
  UserNotFound,
} from '../core/errors.ts';
import {
  AdminUser,
  AdminUserPage,
  InvitedUser,
  UserOperations,
} from '../core/users.ts';
import { AdminAuth } from './admin-auth.ts';

const byId = { id: Schema.String };

const MAX_EMAIL = 254;

// The length is checked first and alone. The pattern reads each character once.
const Email = Schema.String.check(
  Schema.isMaxLength(MAX_EMAIL).abort(),
  Schema.isPattern(/^[^\s@,]+@[^\s@,.]+(?:\.[^\s@,.]+)+$/u),
);

const Roles = Schema.Array(Schema.String);

const UsersGroup = HttpApiGroup.make('users')
  .add(
    HttpApiEndpoint.get('list', '/users', {
      query: {
        search: Schema.optional(Schema.String),
        limit: Schema.optional(Schema.FiniteFromString),
        offset: Schema.optional(Schema.FiniteFromString),
      },
      success: AdminUserPage,
    }).annotate(RequiredPermissions, { user: ['list'] }),
  )
  .add(
    HttpApiEndpoint.get('get', '/users/:id', {
      params: byId,
      success: AdminUser,
      error: UserNotFound,
    }).annotate(RequiredPermissions, { user: ['get'] }),
  )
  .add(
    HttpApiEndpoint.post('ban', '/users/:id/ban', {
      params: byId,
      payload: Schema.Struct({
        reason: Schema.optional(Schema.NonEmptyString),
      }),
      success: HttpApiSchema.NoContent,
      error: [UserNotFound, Forbidden],
    })
      .annotate(RequiredPermissions, { user: ['ban'] })
      .annotate(Audited, { action: 'user.ban', targetKind: 'user' }),
  )
  .add(
    HttpApiEndpoint.post('unban', '/users/:id/unban', {
      params: byId,
      success: HttpApiSchema.NoContent,
      error: UserNotFound,
    })
      .annotate(RequiredPermissions, { user: ['ban'] })
      .annotate(Audited, { action: 'user.unban', targetKind: 'user' }),
  )
  .add(
    // Sets the project's session cookie, on the response to the admin's
    // browser.
    HttpApiEndpoint.post('impersonate', '/users/:id/impersonate', {
      params: byId,
      success: HttpApiSchema.NoContent,
      error: [UserNotFound, Forbidden],
    })
      .annotate(RequiredPermissions, { user: ['impersonate'] })
      .annotate(Audited, { action: 'user.impersonate', targetKind: 'user' }),
  )
  .add(
    // Replaces every role. None at all is the default one.
    HttpApiEndpoint.put('setRoles', '/users/:id/roles', {
      params: byId,
      payload: Schema.Struct({ roles: Roles }),
      success: HttpApiSchema.NoContent,
      error: [UserNotFound, UnknownRole, Forbidden],
    })
      .annotate(RequiredPermissions, { user: ['set-role'] })
      .annotate(Audited, { action: 'user.set-roles', targetKind: 'user' }),
  )
  .add(
    // Beside `/users/:id`, where no account's id can be taken for it.
    HttpApiEndpoint.get('operations', '/user-operations', {
      success: UserOperations,
    }).annotate(RequiredPermissions, { user: ['list'] }),
  )
  .add(
    HttpApiEndpoint.post('invite', '/users', {
      payload: Schema.Struct({
        email: Email,
        name: Schema.NonEmptyString.check(Schema.isTrimmed()),
        roles: Schema.optional(Roles),
      }),
      success: InvitedUser,
      error: [EmailTaken, UnknownRole, Forbidden, OperationUnsupported],
    })
      .annotate(RequiredPermissions, { user: ['create'] })
      .annotate(Audited, { action: 'user.invite' }),
  )
  .add(
    HttpApiEndpoint.post('passwordLink', '/users/:id/password-link', {
      params: byId,
      success: HttpApiSchema.NoContent,
      error: [UserNotFound, Forbidden, LinkNotSent, OperationUnsupported],
    })
      .annotate(RequiredPermissions, { user: ['set-password'] })
      .annotate(Audited, { action: 'user.password-link', targetKind: 'user' }),
  )
  .add(
    HttpApiEndpoint.delete('delete', '/users/:id', {
      params: byId,
      success: HttpApiSchema.NoContent,
      error: [UserNotFound, Forbidden, OperationUnsupported],
    })
      .annotate(RequiredPermissions, { user: ['delete'] })
      .annotate(Audited, { action: 'user.delete', targetKind: 'user' }),
  );

export const UsersApi = HttpApi.make('shoemaker-admin-users')
  .add(UsersGroup)
  .middleware(AdminAuth);
