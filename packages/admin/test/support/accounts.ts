import { Context, type Effect, type Option } from 'effect';

export interface Mail {
  readonly to: string;
  readonly token: string;
  readonly landing: string;
}

// What the suites need from a backend beyond the ports: accounts to act with.
export class Accounts extends Context.Service<
  Accounts,
  {
    // `roles` is the stored, comma-separated list. Later accounts must get a
    // later creation time than earlier ones.
    readonly create: (account: {
      readonly email: string;
      readonly name?: string;
      readonly roles?: string;
    }) => Effect.Effect<{ readonly id: string; readonly email: string }>;
    // A Cookie header signed in as the account, from a new session.
    readonly signIn: (id: string) => Effect.Effect<string>;
    readonly setRoles: (id: string, stored: string) => Effect.Effect<void>;
    // What was mailed so far: the token of each link, and where it lands.
    readonly mail: Effect.Effect<ReadonlyArray<Mail>>;
    // From now on the mailer fails, with the link in what it says.
    readonly breakMail: Effect.Effect<void>;
    // What following a link and choosing a password does.
    readonly choosePassword: (
      token: string,
      password: string,
    ) => Effect.Effect<void>;
    // None is a refusal.
    readonly signInWith: (
      email: string,
      password: string,
    ) => Effect.Effect<Option.Option<string>>;
  }
>()('shoemaker-admin/test/support/accounts') {}
