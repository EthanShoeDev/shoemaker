import {
  Array as Arr,
  Match,
  Predicate,
  Record as Rec,
  String as Str,
} from 'effect';

import type {
  FlagCondition,
  FlagConfig,
  FlagType,
  FlagValue,
} from '../core/flag-config.ts';
import type {
  FlagErrorCode,
  FlagMatch,
  FlagResolution,
} from '../core/flag-resolution.ts';
import type { FlagDefinition, FlagDefinitionMap } from '../core/flag-store.ts';
import { assignment, isWithin, needsAssignment } from './assignment.ts';

// What is known about who is asking. Only its own strings, numbers and booleans
// are read.
export type FlagContext = Readonly<Record<string, unknown>>;

const failed = (
  errorCode: FlagErrorCode,
  errorMessage: string,
): FlagResolution => ({ kind: 'error', errorCode, errorMessage });

const TARGETING_KEY = 'targetingKey';

const own = (context: FlagContext, property: string) =>
  Rec.has(context, property) ? context[property] : undefined;

const isKnown = Predicate.isNotNullish;

const isScalar = (value: unknown) =>
  Predicate.isString(value) ||
  Predicate.isNumber(value) ||
  Predicate.isBoolean(value);

const compareText = (
  operator: 'contains' | 'ends_with' | 'starts_with',
  text: string,
  part: string,
) =>
  Match.value(operator).pipe(
    Match.when('contains', () => Str.includes(part)(text)),
    Match.when('starts_with', () => Str.startsWith(part)(text)),
    Match.when('ends_with', () => Str.endsWith(part)(text)),
    Match.exhaustive,
  );

const compareNumber = (
  operator: 'gt' | 'gte' | 'lt' | 'lte',
  left: number,
  right: number,
) =>
  Match.value(operator).pipe(
    Match.when('gt', () => left > right),
    Match.when('gte', () => left >= right),
    Match.when('lt', () => left < right),
    Match.when('lte', () => left <= right),
    Match.exhaustive,
  );

const matches = (condition: FlagCondition, context: FlagContext): boolean => {
  const actual = own(context, condition.property);
  switch (condition.operator) {
    case 'in': {
      return Arr.some(condition.values, (value) => value === actual);
    }
    case 'not_in': {
      return (
        isScalar(actual) &&
        !Arr.some(condition.values, (value) => value === actual)
      );
    }
    case 'contains':
    case 'starts_with':
    case 'ends_with': {
      return (
        Predicate.isString(actual) &&
        compareText(condition.operator, actual, condition.value)
      );
    }
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      return (
        Predicate.isNumber(actual) &&
        compareNumber(condition.operator, actual, condition.value)
      );
    }
    case 'exists': {
      return isKnown(actual);
    }
    case 'missing': {
      return !isKnown(actual);
    }
  }
};

// What a targeting key may measure, so that hashing one costs little.
const MAX_TARGETING_KEY = 1000;

const serve = (
  flag: FlagDefinition,
  config: FlagConfig,
  variant: string,
  reason: FlagMatch['reason'],
): FlagResolution => {
  const variants: Readonly<Record<string, FlagValue>> = config.variants;
  const value = Rec.has(variants, variant) ? variants[variant] : undefined;
  return value === undefined
    ? failed('PARSE_ERROR', `The flag has no variant ${variant}.`)
    : {
        kind: 'value',
        // A caller may change the object it gets, and the definition is shared.
        value: Predicate.isObject(value) ? structuredClone(value) : value,
        variant,
        reason,
        flagMetadata: { version: flag.version },
      };
};

const checkTargetingKey = (key: unknown): FlagResolution | string => {
  if (!Predicate.isString(key) || key === '') {
    return failed(
      'TARGETING_KEY_MISSING',
      'The flag is rolled out to a share of targeting keys.',
    );
  }
  return key.length > MAX_TARGETING_KEY
    ? failed(
        'INVALID_CONTEXT',
        `A targeting key has at most ${MAX_TARGETING_KEY} characters.`,
      )
    : key;
};

const evaluate = (
  flag: FlagDefinition,
  config: FlagConfig,
  context: FlagContext,
): FlagResolution => {
  // Every share of a flag looks at one position, so it is worked out once.
  let position: number | undefined;
  for (const { conditions, share, variant } of config.rules) {
    if (!Arr.every(conditions, (condition) => matches(condition, context))) {
      continue;
    }
    if (share === undefined) {
      const reason = conditions.length === 0 ? 'STATIC' : 'TARGETING_MATCH';
      return serve(flag, config, variant, reason);
    }
    if (needsAssignment(share) && position === undefined) {
      const key = checkTargetingKey(own(context, TARGETING_KEY));
      if (!Predicate.isString(key)) return key;
      position = assignment(flag.key, key);
    }
    const at = position ?? 1;
    if (isWithin(share, () => at)) {
      return serve(flag, config, variant, 'SPLIT');
    }
  }
  return serve(flag, config, config.defaultVariant, 'STATIC');
};

// What a flag answers in a context. The same definition and context always give
// the same answer, and nothing else is read. Never throws, also where reading
// the context does.
export const evaluateFlag = (
  flag: FlagDefinition,
  context: FlagContext,
): FlagResolution => {
  const { config } = flag;
  if (config === null) {
    return failed('PARSE_ERROR', 'The stored definition cannot be read.');
  }
  if (!config.enabled) {
    return {
      kind: 'disabled',
      reason: 'DISABLED',
      flagMetadata: { version: flag.version },
    };
  }
  try {
    return evaluate(flag, config, context);
  } catch {
    return failed('GENERAL', 'The evaluation context cannot be read.');
  }
};

// The answer to an application asking for a flag by key and type. A flag that
// is disabled answers nothing, so its type is not looked at.
export const resolveFlag = (
  definitions: FlagDefinitionMap,
  key: string,
  type: FlagType,
  context: FlagContext,
): FlagResolution => {
  const flag = definitions.get(key);
  if (flag === undefined) {
    return failed('FLAG_NOT_FOUND', `There is no flag ${key}.`);
  }
  if (
    flag.config !== null &&
    flag.config.enabled &&
    flag.config.type !== type
  ) {
    return failed(
      'TYPE_MISMATCH',
      `The flag is a ${flag.config.type}, not a ${type}.`,
    );
  }
  return evaluateFlag(flag, context);
};
