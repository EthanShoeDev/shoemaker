import { Schema } from 'effect';

const HTTP_BAD_REQUEST = 400;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const HTTP_CONFLICT = 409;
const HTTP_NOT_IMPLEMENTED = 501;
const HTTP_BAD_GATEWAY = 502;

// Nobody usable is signed in: no session, an ended one, or a banned user's.
export class Unauthorized extends Schema.TaggedError<
  Unauthorized,
  { readonly brand: unique symbol }
>()(
  'Unauthorized',
  { message: Schema.String },
  { httpApiStatus: HTTP_UNAUTHORIZED },
) {}

// Somebody is signed in, and this is not theirs to do.
export class Forbidden extends Schema.TaggedError<
  Forbidden,
  { readonly brand: unique symbol }
>()(
  'Forbidden',
  { message: Schema.String },
  { httpApiStatus: HTTP_FORBIDDEN },
) {}

export class UserNotFound extends Schema.TaggedError<
  UserNotFound,
  { readonly brand: unique symbol }
>()('UserNotFound', { id: Schema.String }, { httpApiStatus: HTTP_NOT_FOUND }) {}

// A role the project does not define.
export class UnknownRole extends Schema.TaggedError<
  UnknownRole,
  { readonly brand: unique symbol }
>()(
  'UnknownRole',
  { role: Schema.String },
  { httpApiStatus: HTTP_BAD_REQUEST },
) {}

export class EmailTaken extends Schema.TaggedError<
  EmailTaken,
  { readonly brand: unique symbol }
>()('EmailTaken', { email: Schema.String }, { httpApiStatus: HTTP_CONFLICT }) {}

// An optional operation this project does not declare.
export class OperationUnsupported extends Schema.TaggedError<
  OperationUnsupported,
  { readonly brand: unique symbol }
>()(
  'OperationUnsupported',
  { operation: Schema.String },
  { httpApiStatus: HTTP_NOT_IMPLEMENTED },
) {}

// The mailer failed, perhaps after it had sent the link. Says nothing of why:
// what it failed on holds the link.
export class LinkNotSent extends Schema.TaggedError<
  LinkNotSent,
  { readonly brand: unique symbol }
>()('LinkNotSent', {}, { httpApiStatus: HTTP_BAD_GATEWAY }) {}
