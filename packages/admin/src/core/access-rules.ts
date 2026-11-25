import { Context } from 'effect';

import type { Permissions } from './annotations.ts';

// What the core asks of a project's `defineAccess`, without knowing its
// statements.
export interface Access {
  // Whether the project defines a role of that name.
  readonly isRole: (name: string) => boolean;
  // Whether one of the roles grants all of the permissions. False for an empty
  // requirement.
  readonly can: (
    roles: ReadonlyArray<string>,
    permissions: Permissions,
  ) => boolean;
  // Whether one of the roles grants anything the public app does not check.
  readonly isAdmin: (roles: ReadonlyArray<string>) => boolean;
  // The `resource:action` names the project never defined.
  readonly undefinedIn: (permissions: Permissions) => ReadonlyArray<string>;
  // Whether the public app checks every one of the permissions too.
  readonly isPublic: (permissions: Permissions) => boolean;
}

export class AccessRules extends Context.Service<AccessRules, Access>()(
  'shoemaker-admin/core/access-rules/AccessRules',
) {}
