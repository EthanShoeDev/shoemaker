import fs from 'node:fs';
import path from 'node:path';

const rootCache = new Map<string, string | null>();
const nameCache = new Map<string, string | null>();

/** The nearest ancestor directory (inclusive) that holds a package.json. */
export const findPackageRoot = (startDir: string) => {
  const cached = rootCache.get(startDir);
  if (cached !== undefined) return cached;

  // Walk up until a package.json turns up, or until `dirname` stops moving,
  // which is how the filesystem root announces itself.
  let current: string | null = startDir;
  let result: string | null = null;
  while (current !== null) {
    if (fs.existsSync(path.join(current, 'package.json'))) {
      result = current;
      break;
    }
    const parent = path.dirname(current);
    current = parent === current ? null : parent;
  }
  rootCache.set(startDir, result);
  return result;
};

/** The `name` field of `<root>/package.json`, or null when it has none. */
export const readPackageName = (root: string) => {
  const cached = nameCache.get(root);
  if (cached !== undefined) return cached;

  let name: string | null = null;
  try {
    const manifest: unknown = JSON.parse(
      fs.readFileSync(path.join(root, 'package.json'), 'utf-8'),
    );
    if (
      manifest !== null &&
      typeof manifest === 'object' &&
      'name' in manifest &&
      typeof manifest.name === 'string'
    ) {
      name = manifest.name;
    }
  } catch {
    // An unreadable or malformed manifest names no package.
    name = null;
  }
  nameCache.set(root, name);
  return name;
};
