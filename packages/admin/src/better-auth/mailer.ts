import type { BetterAuthOptions } from 'better-auth';
import { Array as Arr, Function, Option, Predicate } from 'effect';

type SendResetPassword = NonNullable<
  NonNullable<BetterAuthOptions['emailAndPassword']>['sendResetPassword']
>;

// Better Auth as it started. The type of its options depends on every one.
interface Started {
  readonly options: object;
}

interface MailerOptions {
  emailAndPassword?:
    | {
        readonly enabled: boolean;
        readonly sendResetPassword?: SendResetPassword | undefined;
      }
    | undefined;
}

export type Outcome =
  | { readonly sent: true }
  | { readonly sent: false; readonly reason: string };

// Waits for the next link to one user.
interface Watcher {
  readonly userId: string;
  outcome: Option.Option<Promise<Outcome>>;
}

const watchersOf = new WeakMap<SendResetPassword, Set<Watcher>>();

// What kind of failure, and nothing it says: that may hold the whole mail, in
// any encoding, and so the link.
const kindOf = (error: unknown) => {
  if (Predicate.hasProperty(error, '_tag')) return String(error._tag);
  return Predicate.isError(error) ? error.name : 'unknown';
};

// The mailer Better Auth will call, under watch. Better Auth runs it in the
// background and only prints a failure, with whatever the mailer put in it, so
// a link the core asked for tells the core instead. Other links go their usual
// way. Looked up as late as this because any plugin may replace the options as
// Better Auth starts.
export const observedMailer = ({ options }: Started) => {
  const mailer: MailerOptions = options;
  const { emailAndPassword } = mailer;
  const send = emailAndPassword?.sendResetPassword;
  if (emailAndPassword?.enabled !== true || send === undefined) {
    return Option.none();
  }
  const known = watchersOf.get(send);
  if (known !== undefined) return Option.some(known);
  const watchers = new Set<Watcher>();
  const observed: SendResetPassword = (data, request) => {
    const watcher = Arr.findFirst(
      [...watchers],
      (waiting) =>
        waiting.userId === data.user.id && Option.isNone(waiting.outcome),
    );
    if (Option.isNone(watcher)) return send(data, request);
    const outcome = Promise.resolve()
      .then(() => send(data, request))
      .then((): Outcome => ({ sent: true }))
      .catch((error: unknown): Outcome => ({
        sent: false,
        reason: kindOf(error),
      }));
    watcher.value.outcome = Option.some(outcome);
    return outcome.then(Function.constVoid);
  };
  watchersOf.set(observed, watchers);
  // This instance's options; the project's object inside them is left alone.
  mailer.emailAndPassword = {
    ...emailAndPassword,
    sendResetPassword: observed,
  };
  return Option.some(watchers);
};

// Registers before the link is asked for, and is forgotten when done.
export const watch = (watchers: Set<Watcher>, userId: string) => {
  const watcher: Watcher = { userId, outcome: Option.none() };
  watchers.add(watcher);
  return {
    watcher,
    forget: () => {
      watchers.delete(watcher);
    },
  };
};
