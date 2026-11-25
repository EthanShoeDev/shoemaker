import { Array as Arr, Option, String as Str, pipe } from 'effect';

const MAX_DECODINGS = 8;

// One round of percent-decoding. What does not decode stays as it is.
const decodeOnce = (path: string) =>
  // oxlint-disable-next-line effecttsgo/prefer-effect-string -- each match needs decoding, which String.replaceAll cannot do
  path.replaceAll(/(?:%[0-9a-f]{2})+/giu, (escaped) => {
    try {
      return decodeURIComponent(escaped);
    } catch {
      return escaped;
    }
  });

const decode = (path: string) => {
  let current = path;
  for (let round = 0; round < MAX_DECODINGS; round += 1) {
    const next = decodeOnce(current);
    if (next === current) return Option.some(current);
    current = next;
  }
  return Option.none();
};

// The plainest spelling of a path: decoded, its dot segments resolved, its
// slashes collapsed, without matrix parameters, control characters or a
// trailing slash, and in lower case. None for a path encoded too many times to
// be meant.
export const plainPath = (path: string) =>
  Option.map(decode(path), (decoded) => {
    const kept: Array<string> = [];
    const segments = Str.split(
      pipe(
        decoded,
        Str.replaceAll('\\', '/'),
        Str.replaceAll(/[\p{Cc}\s]/gu, ''),
      ),
      '/',
    );
    for (const raw of segments) {
      const segment = Str.replace(/;.*$/u, '')(raw);
      if (segment === '..') kept.pop();
      else if (segment !== '' && segment !== '.') kept.push(segment);
    }
    return `/${Str.toLowerCase(Arr.join(kept, '/'))}`;
  });

const isUnder = (path: string, parent: string) =>
  path === parent || Str.startsWith(`${parent}/`)(path);

const adminPaths = (bases: ReadonlyArray<string>) =>
  Arr.map(bases, (base) => `${Str.replace(/\/+$/u, '')(base)}/admin`);

export const isAdminPath = (pathname: string, bases: ReadonlyArray<string>) =>
  Option.match(plainPath(pathname), {
    // Nothing honest is spelled like that.
    onNone: () => true,
    onSome: (plain) =>
      Arr.some(adminPaths(bases), (admin) =>
        isUnder(plain, Str.toLowerCase(admin)),
      ),
  });

// The one admin route left open, in its one spelling.
export const isStop = (
  method: string,
  pathname: string,
  bases: ReadonlyArray<string>,
) =>
  method === 'POST' &&
  Arr.some(
    adminPaths(bases),
    (admin) => pathname === `${admin}/stop-impersonating`,
  );
