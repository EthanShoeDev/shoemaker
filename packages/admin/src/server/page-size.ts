import { Number as Num } from 'effect';

// Asking for more than the maximum gives the maximum, not an error.
export const pageSize = (
  asked: number | undefined,
  size: { readonly initial: number; readonly maximum: number },
) =>
  Num.clamp(Math.floor(asked ?? size.initial), {
    minimum: 1,
    maximum: size.maximum,
  });
