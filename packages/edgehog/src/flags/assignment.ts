// The way PostHog's SDKs assign a key to a share (MIT, see THIRD_PARTY_NOTICES),
// so that they agree if they are ever supported. It can never change: people
// would move between variants.
import { sha1 } from './sha1.ts';

const LOW_BITS = 28;
const DROPPED = 2 ** 4;
const SCALE = 2 ** 60;

const encoder = new TextEncoder();

// Where a targeting key falls for a flag, from 0 to 1. It depends on the flag's
// key and the targeting key alone, so reordering, renaming or editing rules
// moves nobody, and every share of one flag divides people the same way: those
// in 20% are in 40%.
export const assignment = (
  flagKey: string,
  targetingKey: string,
  // PostHog uses `variant` to choose among several variants.
  salt: '' | 'variant' = '',
) => {
  const [high = 0, low = 0] = sha1(
    encoder.encode(`${flagKey}.${targetingKey}${salt}`),
  );
  // The first 60 bits. The sum rounds once, to the nearest number, as PostHog's
  // conversion does.
  return (high * 2 ** LOW_BITS + Math.floor(low / DROPPED)) / SCALE;
};

const ALL = 100;

// Nobody is in 0% and everybody is in 100%, whatever their key.
export const needsAssignment = (share: number) => share > 0 && share < ALL;

export const isWithin = (share: number, position: () => number) =>
  needsAssignment(share) ? position() <= share / ALL : share >= ALL;

export const inShare = (flagKey: string, targetingKey: string, share: number) =>
  isWithin(share, () => assignment(flagKey, targetingKey));
