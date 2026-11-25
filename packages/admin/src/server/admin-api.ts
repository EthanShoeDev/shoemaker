import { Array as Arr, Context, Effect, Layer, Record as Rec } from 'effect';
import {
  type HttpApi,
  HttpApiBuilder,
  type HttpApiEndpoint,
  type HttpApiGroup,
} from 'effect/http-api';

import { AdminAuth } from '../contract/admin-auth.ts';
import { type Access, AccessRules } from '../core/access-rules.ts';
import { Audited, RequiredPermissions } from '../core/annotations.ts';
import { AdminAuthLive } from './admin-auth.ts';
import { AdminSetupError } from './setup-error.ts';

const ID_PARAMETER = /(?<!:):id(?!\w)/u;

const middlewareFault = (endpoint: HttpApiEndpoint.Top) => {
  const keys = Arr.map(
    [...endpoint.middlewares],
    (middleware) => middleware.key,
  );
  if (!Arr.contains(keys, AdminAuth.key)) return ['is not behind AdminAuth'];
  return keys.at(-1) === AdminAuth.key
    ? []
    : ['has a middleware outside AdminAuth, which must be added last'];
};

// The faults that can only be a mistake in the host's wiring. An endpoint with
// no permissions at all is refused per call instead.
const faultsOf = (rules: Access, endpoint: HttpApiEndpoint.Top) => {
  const permissions =
    Context.get(endpoint.annotations, RequiredPermissions) ?? {};
  const kind = Context.get(endpoint.annotations, Audited)?.targetKind;
  return [
    ...middlewareFault(endpoint),
    ...Arr.map(
      rules.undefinedIn(permissions),
      (missing) => `needs ${missing}, which the access rules do not define`,
    ),
    ...(rules.isPublic(permissions)
      ? ['needs only permissions the public app checks too']
      : []),
    ...(kind === undefined || ID_PARAMETER.test(endpoint.path)
      ? []
      : [`records a ${kind}, and its path has no \`id\` to name one by`]),
  ];
};

// What `HttpApiBuilder.group` provides: the endpoints it will really serve,
// which are those of the API the handlers were built from.
interface ServedGroup {
  readonly handlers: ReadonlyMap<
    string,
    { readonly endpoint: HttpApiEndpoint.Top }
  >;
}

// Serves an admin API, a product's or the host's own, behind the host's one
// access check. Building it fails when an endpoint could not work, or would
// not be protected.
export const adminApi = <
  Id extends string,
  Groups extends HttpApiGroup.Constraint,
  E,
  R,
>(
  api: HttpApi.HttpApi<Id, Groups>,
  options: {
    // Named in startup failures.
    readonly product: string;
    readonly handlers: Layer.Layer<HttpApiGroup.ToService<Id, Groups>, E, R>;
  },
) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const rules = yield* AccessRules;
      const services =
        yield* Effect.context<HttpApiGroup.ToService<Id, Groups>>();
      const faults = Arr.flatMap(Rec.values(api.groups), (group) => {
        const served = services.mapUnsafe.get(group.key) as ServedGroup;
        return Arr.flatMap([...served.handlers.values()], ({ endpoint }) =>
          Arr.map(
            faultsOf(rules, endpoint),
            (fault) =>
              `${options.product}: ${group.identifier}.${endpoint.identifier} ${fault}`,
          ),
        );
      });
      if (Arr.isReadonlyArrayNonEmpty(faults)) {
        return yield* Effect.die(
          AdminSetupError.make({ message: Arr.join(faults, '\n') }),
        );
      }
      return HttpApiBuilder.layer(api);
    }),
  ).pipe(
    Layer.provide(options.handlers),
    // Not shared: a build may hold two access checks, with other origins or
    // rules.
    Layer.provide(Layer.fresh(AdminAuthLive)),
  );
