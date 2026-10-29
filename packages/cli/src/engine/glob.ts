// Minimal glob matcher for `--force <glob>` (`**`, `*`, `?`), so the engine
// does not depend on Bun-only APIs.
import { Array as Arr, Option, String as Str } from 'effect';

const toRegExp = (glob: string) => {
  const charAt = (i: number) => Option.getOrElse(Str.charAt(glob, i), () => '');
  let source = '';
  for (let i = 0; i < glob.length; i++) {
    const char = charAt(i);
    if (char === '*' && charAt(i + 1) === '*') {
      const slash = charAt(i + 2) === '/';
      source += slash ? '(?:.*/)?' : '.*';
      i += slash ? 2 : 1;
    } else if (char === '*') {
      source += '[^/]*';
    } else if (char === '?') {
      source += '[^/]';
    } else {
      source += Str.replaceAll(/[.+^${}()|[\]\\]/gu, '\\$&')(char);
    }
  }
  return new RegExp(`^${source}$`, 'u');
};

export const matchesAny = (path: string, globs: ReadonlyArray<string>) =>
  Arr.some(globs, (glob) => toRegExp(glob).test(path));
