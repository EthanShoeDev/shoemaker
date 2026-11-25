import { createAccessControl, type Role } from 'better-auth/plugins/access';
import { defaultStatements } from 'better-auth/plugins/admin/access';
import {
  Array as Arr,
  Layer,
  Predicate,
  Record as Rec,
  Schema,
  String as Str,
} from 'effect';

import { type Access, AccessRules } from './core/access-rules.ts';
import type { Permissions } from './core/annotations.ts';
import { DEFAULT_ROLE, parseRoles } from './core/roles.ts';
import type { Product } from './product/description.ts';

type DefaultStatements = typeof defaultStatements;

type ResourcesOf<S> = S extends unknown ? keyof S & string : never;

// Distributes over the sources, so a resource named by several gets the
// actions of all of them.
type ActionsOf<S, Resource> = S extends unknown
  ? Resource extends keyof S
    ? S[Resource] extends ReadonlyArray<infer Action extends string>
      ? Action
      : never
    : never
  : never;

type Sources<Products extends ReadonlyArray<Product>, S> =
  | DefaultStatements
  | Products[number]['statements']
  | S;

export type MergedStatements<
  Products extends ReadonlyArray<Product>,
  S extends Permissions,
> = {
  readonly [R in ResourcesOf<Sources<Products, S>>]: ReadonlyArray<
    ActionsOf<Sources<Products, S>, R>
  >;
};

type Grants<S extends Permissions> = {
  readonly [R in keyof S]?: ReadonlyArray<S[R][number]>;
};

// A grant with its optional keys seen from a record.
type Partials = Readonly<Record<string, ReadonlyArray<string> | undefined>>;

const own = (record: Partials | undefined): Permissions =>
  Rec.filter(record ?? {}, Predicate.isNotUndefined);

const merge = (sources: ReadonlyArray<Permissions>) =>
  Arr.reduce(sources, Rec.empty<string, ReadonlyArray<string>>(), (all, next) =>
    Rec.union(all, next, (left, right) => Arr.dedupe([...left, ...right])),
  );

// A role is stored in a comma-separated list, trimmed as it is read.
export class InvalidRoleName extends Schema.TaggedError<
  InvalidRoleName,
  { readonly brand: unique symbol }
>()('InvalidRoleName', { role: Schema.String }) {
  override get message() {
    return `"${this.role}" cannot be a role: it is empty, holds a comma, or starts or ends with a space.`;
  }
}

// A project's access rules: what Better Auth, the installed products and the
// project itself define, and which roles grant it. Runs in the browser too,
// so an admin app decides by `can`, never by a role's name.
export const defineAccess = <
  const Products extends ReadonlyArray<Product> = readonly [],
  const S extends Permissions = never,
  const RoleName extends string = never,
>(options: {
  readonly products?: Products;
  readonly statements?: S;
  // `admin` grants everything defined but `user:impersonate-admins`. A
  // resource named in an `admin` entry here replaces that for the resource.
  readonly roles?: Readonly<
    Record<RoleName, Grants<MergedStatements<Products, S>>>
  >;
  // What the public app checks too. A role granting only these is not an
  // admin role.
  readonly publicStatements?: Grants<MergedStatements<Products, S>>;
}) => {
  type Merged = MergedStatements<Products, S>;

  const merged = merge([
    defaultStatements,
    ...Arr.map(options.products ?? [], (product) => product.statements),
    options.statements ?? {},
  ]);
  const ac = createAccessControl(merged as Merged & typeof merged);

  const declared: Readonly<Record<string, Partials>> = options.roles ?? {};
  const everything = Rec.map(merged, (actions, resource) =>
    resource === 'user'
      ? Arr.filter(actions, (action) => action !== 'impersonate-admins')
      : actions,
  );
  const granted: Readonly<Record<string, Partials>> = {
    [DEFAULT_ROLE]: {},
    ...declared,
    admin: { ...everything, ...own(declared.admin) },
  };

  for (const role of Rec.keys(granted)) {
    if (role === '' || Str.trim(role) !== role || Str.includes(',')(role)) {
      throw InvalidRoleName.make({ role });
    }
  }

  // Maps and sets, not records: a role or resource may be named by stored data
  // that reads `constructor`.
  const index = (permissions: Partials) =>
    new Map(
      Arr.map(Rec.toEntries(own(permissions)), ([resource, actions]) => [
        resource,
        new Set(actions),
      ]),
    );
  const covers = (
    grants: ReadonlyMap<string, ReadonlySet<string>>,
    permissions: Permissions,
  ) => {
    const needed = Rec.toEntries(own(permissions));
    return (
      Arr.isReadonlyArrayNonEmpty(needed) &&
      Arr.every(
        needed,
        ([resource, actions]) =>
          Arr.isReadonlyArrayNonEmpty(actions) &&
          Arr.every(
            actions,
            (action) => grants.get(resource)?.has(action) === true,
          ),
      )
    );
  };

  const defined = index(merged);
  const publicGrants = index(options.publicStatements ?? {});
  const roleGrants = new Map(
    Arr.map(Rec.toEntries(granted), ([name, grants]) => [name, index(grants)]),
  );
  const adminRoles = Arr.filter(Rec.keys(granted), (name) =>
    Arr.some(Rec.toEntries(own(granted[name])), ([resource, actions]) =>
      Arr.some(
        actions,
        (action) => publicGrants.get(resource)?.has(action) !== true,
      ),
    ),
  );
  const adminRoleNames = new Set(adminRoles);

  const rules: Access = {
    isRole: (name) => roleGrants.has(name),
    can: (roles, permissions) =>
      Arr.some(roles, (name) => {
        const grants = roleGrants.get(name);
        return grants !== undefined && covers(grants, permissions);
      }),
    isAdmin: (roles) => Arr.some(roles, (name) => adminRoleNames.has(name)),
    undefinedIn: (permissions) =>
      Arr.flatMap(Rec.toEntries(own(permissions)), ([resource, actions]) =>
        Arr.flatMap(actions, (action) =>
          defined.get(resource)?.has(action) === true
            ? []
            : [`${resource}:${action}`],
        ),
      ),
    isPublic: (permissions) => covers(publicGrants, permissions),
  };

  const roles = Rec.map(granted, (grants) =>
    ac.newRole(own(grants)),
  ) as Readonly<
    Record<RoleName | 'admin' | 'user', Role<Merged & typeof merged>>
  >;

  return {
    ac,
    // For Better Auth's admin plugin, with `ac` and `adminRoles`.
    roles,
    adminRoles,
    // Takes a stored, comma-separated list or one already parsed.
    can: (
      callerRoles: string | null | undefined | ReadonlyArray<string>,
      permissions: Grants<Merged>,
    ) =>
      rules.can(
        Predicate.isString(callerRoles) || Predicate.isNullish(callerRoles)
          ? parseRoles(callerRoles)
          : callerRoles,
        own(permissions),
      ),
    // The typed way to write a `RequiredPermissions` annotation.
    requires: (permissions: Grants<Merged>): Permissions => own(permissions),
    rules,
    layer: Layer.succeed(AccessRules, rules),
  };
};
