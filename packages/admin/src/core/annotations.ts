import { Context } from 'effect';

// Structural, so a product's contract does not depend on one project's
// statements: `{ billing: ['grant'] }`.
export type Permissions = Readonly<Record<string, ReadonlyArray<string>>>;

// What one endpoint needs. `null` is an undeclared endpoint, refused for every
// caller.
export const RequiredPermissions = Context.Reference<Permissions | null>(
  'shoemaker-admin/core/annotations/RequiredPermissions',
  { defaultValue: () => null },
);

export interface AuditedAction {
  // Dotted, kind first: `user.ban`.
  readonly action: string;
  // The kind of the target whose id is the endpoint's `id` parameter. An
  // action with no target, or one its handler names, leaves it out.
  readonly targetKind?: string;
}

// The action a successful call records. A write without one is refused, unless
// it is `ReadOnly`.
export const Audited = Context.Reference<AuditedAction | null>(
  'shoemaker-admin/core/annotations/Audited',
  { defaultValue: () => null },
);

// A read whose method says otherwise, such as a structured query sent by POST.
export const ReadOnly = Context.Reference<boolean>(
  'shoemaker-admin/core/annotations/ReadOnly',
  {
    defaultValue: () => false,
  },
);
