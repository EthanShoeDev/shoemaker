import { Context, Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/http';
import { HttpApiError } from 'effect/http-api';

import { AdminAuth } from '../contract/admin-auth.ts';
import { Audited, ReadOnly, RequiredPermissions } from '../core/annotations.ts';
import { AdminAccess } from './admin-access.ts';

const HTTP_BAD_REQUEST = 400;

// Only an endpoint's own annotations count: a permission inherited from its
// group or API is too easy to add an endpoint under by accident.
export const AdminAuthLive = Layer.effect(
  AdminAuth,
  Effect.gen(function* () {
    const access = yield* AdminAccess;
    return AdminAuth.of((httpEffect, { endpoint }) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const { params } = yield* HttpRouter.RouteContext;
        return yield* access.run(
          {
            headers: request.headers,
            unsafeMethod: request.method !== 'GET' && request.method !== 'HEAD',
            permissions: Context.get(endpoint.annotations, RequiredPermissions),
            audited: Context.get(endpoint.annotations, Audited),
            readOnly: Context.get(endpoint.annotations, ReadOnly),
            targetId: params.id,
          },
          httpEffect,
          // The builder answers some bad requests with a response, not an
          // error, and a raw handler may too.
          (response) => response.status < HTTP_BAD_REQUEST,
          // The handler finished, and what it returned could not be sent.
          (error) =>
            HttpApiError.HttpApiSchemaError.is(error) &&
            (error.kind === 'Body' || error.kind === 'ResponseHeaders'),
        );
      }),
    );
  }),
);
