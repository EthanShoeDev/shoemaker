import { Schema } from 'effect';

// A host wired in a way that must not serve requests.
export class AdminSetupError extends Schema.TaggedError<
  AdminSetupError,
  { readonly brand: unique symbol }
>()('AdminSetupError', { message: Schema.String }) {}
