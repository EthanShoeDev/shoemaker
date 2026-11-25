import { Context } from 'effect';

// How the caller proved who they are. Only sessions exist now. A `key` acts
// for the same user, named by its label, and is not a cookie, so the origin
// check does not apply to it.
export type Credential =
  | { readonly kind: 'session' }
  | { readonly kind: 'key'; readonly id: string; readonly name: string };

export interface AdminCaller {
  readonly id: string;
  readonly email: string;
  readonly roles: ReadonlyArray<string>;
  readonly credential: Credential;
}

// Who is calling, once access has been granted.
export class CurrentAdmin extends Context.Service<CurrentAdmin, AdminCaller>()(
  'shoemaker-admin/core/caller/CurrentAdmin',
) {}
