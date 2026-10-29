import { Array as Arr, Effect, Order, Record as Rec } from 'effect';

import {
  allManifests,
  readWorkspace,
  type Manifest,
} from '../checks/workspace.ts';
import type { Repo } from '../engine/repo.ts';
import type { Finding } from './types.ts';

interface Extra {
  readonly fix?: string;
  readonly migration?: string;
  readonly path?: string;
}

export const pass = (message: string, path?: string): Finding => ({
  ok: true,
  message,
  ...(path === undefined ? {} : { path }),
});

export const fail = (message: string, extra: Extra = {}): Finding => ({
  ok: false,
  message,
  ...extra,
});

// Root plus workspace manifests; a repo without a root package.json has none.
export const manifestsOf = Effect.fnUntraced(function* (repo: Repo) {
  const workspace = yield* readWorkspace(repo);
  return workspace === undefined ? [] : allManifests(workspace);
});

export const scriptsOf = (manifests: ReadonlyArray<Manifest>) =>
  Arr.flatMap(manifests, (manifest) =>
    Arr.map(Rec.toEntries(manifest.pkg.scripts ?? {}), ([name, command]) => ({
      manifest,
      name,
      command,
    })),
  );

// `a, b, c and 4 more`.
export const listSome = (items: ReadonlyArray<string>, max = 5) =>
  items.length <= max
    ? Arr.join(items, ', ')
    : `${Arr.join(items.slice(0, max), ', ')} and ${items.length - max} more`;

export const OXLINT_RC = ['**/.oxlintrc.json', '**/.oxlintrc.jsonc'];
export const OXFMT_RC = ['**/.oxfmtrc.json', '**/.oxfmtrc.jsonc'];

export const globAll = Effect.fnUntraced(function* (
  repo: Repo,
  patterns: ReadonlyArray<string>,
) {
  const found = new Set<string>();
  for (const pattern of patterns) {
    for (const file of yield* repo.glob(pattern)) found.add(file);
  }
  return Arr.sort(found, Order.String);
});
