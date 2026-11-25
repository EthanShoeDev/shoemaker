import {
  Array as Arr,
  Number as Num,
  Predicate,
  Record as Rec,
  Schema,
} from 'effect';

const MAX_VARIANTS = 50;
const MAX_RULES = 50;
const MAX_CONDITIONS = 20;
const MAX_VALUES = 1000;

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

// A flag's key or a variant's name: what a person types in code and in the
// admin.
export const FlagName = Schema.String.check(Schema.isPattern(NAME));

export const FlagType = Schema.Literals([
  'boolean',
  'string',
  'number',
  'object',
]);

const Scalar = Schema.Union([Schema.String, Schema.Finite, Schema.Boolean]);
const Property = Schema.NonEmptyString;

// One property of the evaluation context. A property that is absent, or of
// another type than the operator reads, matches nothing but `missing`: also not
// `not_in`, so an anonymous visitor is never caught by what a rule excludes.
// No operator takes a pattern, which could be made to run for minutes.
export const FlagCondition = Schema.Union([
  Schema.Struct({
    property: Property,
    operator: Schema.Literals(['in', 'not_in']),
    values: Schema.NonEmptyArray(Scalar).check(Schema.isMaxLength(MAX_VALUES)),
  }),
  Schema.Struct({
    property: Property,
    operator: Schema.Literals(['contains', 'starts_with', 'ends_with']),
    value: Schema.NonEmptyString,
  }),
  Schema.Struct({
    property: Property,
    operator: Schema.Literals(['gt', 'gte', 'lt', 'lte']),
    value: Schema.Finite,
  }),
  Schema.Struct({
    property: Property,
    operator: Schema.Literals(['exists', 'missing']),
  }),
]);

const MAX_SHARE = 100;

// Serves `variant` when every condition matches and, with a `share`, when the
// targeting key falls in that percentage of all keys. Otherwise the next rule
// is tried.
export const FlagRule = Schema.Struct({
  conditions: Schema.Array(FlagCondition).check(
    Schema.isMaxLength(MAX_CONDITIONS),
  ),
  share: Schema.optionalKey(
    Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: MAX_SHARE })),
  ),
  variant: FlagName,
});

const isName = Schema.is(FlagName);

const MAX_DEPTH = 20;

// An own `__proto__` survives JSON, and what a caller copies it into gains
// those properties. Anything nested further is not configuration.
const isPlain = (value: unknown, depth = 0): boolean => {
  if (Arr.isArray(value)) {
    return (
      depth < MAX_DEPTH && Arr.every(value, (item) => isPlain(item, depth + 1))
    );
  }
  return (
    !Predicate.isObject(value) ||
    (depth < MAX_DEPTH &&
      !Rec.has(value, '__proto__') &&
      Arr.every(Rec.values(value), (item) => isPlain(item, depth + 1)))
  );
};

const body = <T extends FlagType, V extends Schema.Constraint>(
  type: T,
  value: V,
) => ({
  type: Schema.Literal(type),
  enabled: Schema.Boolean,
  variants: Schema.Record(Schema.String, value),
  defaultVariant: FlagName,
  rules: Schema.Array(FlagRule).check(Schema.isMaxLength(MAX_RULES)),
});

// Variants of one type, by construction.
export const FlagConfig = Schema.Union([
  Schema.Struct(body('boolean', Schema.Boolean)),
  Schema.Struct(body('string', Schema.String)),
  Schema.Struct(body('number', Schema.Finite)),
  Schema.Struct(body('object', Schema.JsonObject)),
]).check(
  Schema.makeFilter((config) => {
    const variants: Readonly<Record<string, Schema.Json>> = config.variants;
    const names = Rec.keys(variants);
    const issues: Array<Schema.FilterIssue> = [];
    if (!Num.between({ minimum: 1, maximum: MAX_VARIANTS })(names.length)) {
      issues.push({
        path: ['variants'],
        issue: `a flag has 1 to ${MAX_VARIANTS} variants`,
      });
    }
    for (const name of names) {
      if (!isName(name)) {
        issues.push({ path: ['variants', name], issue: 'not a variant name' });
      }
      if (!isPlain(variants[name])) {
        issues.push({
          path: ['variants', name],
          issue: `deeper than ${MAX_DEPTH}, or holds a __proto__`,
        });
      }
    }
    if (!names.includes(config.defaultVariant)) {
      issues.push({ path: ['defaultVariant'], issue: 'not a variant' });
    }
    Arr.forEach(config.rules, (rule, at) => {
      if (!names.includes(rule.variant)) {
        issues.push({ path: ['rules', at, 'variant'], issue: 'not a variant' });
      }
    });
    return issues;
  }),
);

export type FlagType = typeof FlagType.Type;
export type FlagCondition = typeof FlagCondition.Type;
export type FlagRule = typeof FlagRule.Type;
export type FlagConfig = typeof FlagConfig.Type;
export type FlagValue = FlagConfig['variants'][string];
