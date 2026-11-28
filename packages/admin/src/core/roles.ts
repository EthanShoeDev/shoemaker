import { Array as Arr, String as Str } from 'effect';

// The role of an account nobody gave another. Every project defines it.
export const DEFAULT_ROLE = 'user';

// The one reading of a stored role list. Better Auth splits on commas without
// trimming, and reads an empty list as the default role; everything here goes
// through this instead.
export const parseRoles = (stored: string | null | undefined) => {
  const roles = Arr.filter(
    Arr.map(Str.split(stored ?? '', ','), Str.trim),
    Str.isNonEmpty,
  );
  return Arr.isReadonlyArrayNonEmpty(roles) ? roles : [DEFAULT_ROLE];
};
