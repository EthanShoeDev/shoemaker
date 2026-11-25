import { Schema } from 'effect';

const HTTP_NOT_FOUND = 404;
const HTTP_CONFLICT = 409;
const HTTP_UNPROCESSABLE = 422;

// A project the host did not declare.
export class FlagProjectNotFound extends Schema.TaggedError<
  FlagProjectNotFound,
  { readonly brand: unique symbol }
>()(
  'FlagProjectNotFound',
  { projectId: Schema.Int },
  { httpApiStatus: HTTP_NOT_FOUND },
) {}

export class FlagNotFound extends Schema.TaggedError<
  FlagNotFound,
  { readonly brand: unique symbol }
>()('FlagNotFound', { id: Schema.String }, { httpApiStatus: HTTP_NOT_FOUND }) {}

export class FlagKeyTaken extends Schema.TaggedError<
  FlagKeyTaken,
  { readonly brand: unique symbol }
>()('FlagKeyTaken', { key: Schema.String }, { httpApiStatus: HTTP_CONFLICT }) {}

// Somebody changed the flag after the caller read it.
export class FlagChanged extends Schema.TaggedError<
  FlagChanged,
  { readonly brand: unique symbol }
>()('FlagChanged', { id: Schema.String }, { httpApiStatus: HTTP_CONFLICT }) {}

// A row this version cannot read, so it would not know what it replaced.
export class FlagUnreadable extends Schema.TaggedError<
  FlagUnreadable,
  { readonly brand: unique symbol }
>()(
  'FlagUnreadable',
  { id: Schema.String },
  { httpApiStatus: HTTP_CONFLICT },
) {}

// Applications ask for a flag by its type, so it keeps it.
export class FlagTypeFixed extends Schema.TaggedError<
  FlagTypeFixed,
  { readonly brand: unique symbol }
>()(
  'FlagTypeFixed',
  { id: Schema.String },
  { httpApiStatus: HTTP_UNPROCESSABLE },
) {}

export class FlagLimitReached extends Schema.TaggedError<
  FlagLimitReached,
  { readonly brand: unique symbol }
>()(
  'FlagLimitReached',
  { limit: Schema.Literals(['flags', 'bytes']), maximum: Schema.Int },
  { httpApiStatus: HTTP_UNPROCESSABLE },
) {}

// Storage could not answer.
export class FlagsUnavailable extends Schema.TaggedError<
  FlagsUnavailable,
  { readonly brand: unique symbol }
>()('FlagsUnavailable', { cause: Schema.Defect() }) {}
