import { Array as Arr, String as Str } from 'effect';

// The one reading of a stored role list. Better Auth splits on commas without
// trimming; everything here goes through this instead.
export const parseRoles = (stored: string | null | undefined) =>
  Arr.filter(Arr.map(Str.split(stored ?? '', ','), Str.trim), Str.isNonEmpty);

// The role of an account nobody gave another. Every project defines it.
export const DEFAULT_ROLE = 'user';
