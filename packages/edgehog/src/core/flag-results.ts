import { Predicate, Record as Rec, Schema } from 'effect';

// One flag as a server evaluated it: an answer, and nothing of the rules that
// gave it.
export const EvaluatedFlag = Schema.Struct({
  value: Schema.Json,
  variant: Schema.optionalKey(Schema.String),
  reason: Schema.optionalKey(Schema.String),
  errorCode: Schema.optionalKey(Schema.String),
});

export const EvaluatedFlags = Schema.Record(Schema.String, EvaluatedFlag);
export type EvaluatedFlags = typeof EvaluatedFlags.Type;

type Widened<A> = A extends boolean
  ? boolean
  : A extends number
    ? number
    : A extends string
      ? string
      : A;

const typeOf = (value: unknown) => {
  if (Predicate.isBoolean(value)) return 'boolean';
  if (Predicate.isNumber(value)) return 'number';
  return Predicate.isString(value) ? 'string' : 'object';
};

// Reads one in a client, which has no rules and evaluates nothing. A flag that
// was not handed over, or not of the default's type, gives the default.
export const readFlag = <A extends Schema.Json>(
  flags: EvaluatedFlags,
  key: string,
  fallback: A,
): Widened<A> => {
  const value = Rec.has(flags, key) ? flags[key]?.value : undefined;
  return (
    value !== undefined && typeOf(value) === typeOf(fallback) ? value : fallback
  ) as Widened<A>;
};
