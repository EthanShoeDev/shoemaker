import { Effect, String as Str } from 'effect';

import { fail, pass } from './shared.ts';
import type { DoctorCheck, Finding } from './types.ts';

// A foldkit app now server-renders unless its config says `rendering: 'spa'`.
// Sync rewrites vite.config.ts but never the seeds, so a SPA from an older
// shoemaker gets an SSR build around its index.html and client-only main.ts.
export const foldkitRendering: DoctorCheck = {
  id: 'foldkit-rendering',
  description:
    'A server-rendered foldkit app has src/entry.server.ts and no index.html',
  run: Effect.fnUntraced(function* (repo) {
    const configs = yield* repo.glob('apps/*/vite.config.ts');
    const findings: Array<Finding> = [];
    for (const path of configs) {
      const source = (yield* repo.read(path)) ?? '';
      if (
        !Str.includes('@foldkit/vite-plugin')(source) ||
        !Str.includes('serverEntry')(source)
      )
        continue;
      const dir = Str.replace(/\/vite\.config\.ts$/u, '')(path);
      const spaFix = `set \`rendering: 'spa'\` on this app in shoemaker.config.ts and sync to keep it a SPA, or port it to foldkit's server entry as a new shoemaker app has it`;
      if (yield* repo.exists(`${dir}/index.html`)) {
        findings.push(
          fail(`${dir} server-renders but keeps an index.html`, {
            path: `${dir}/index.html`,
            fix: spaFix,
          }),
        );
      } else if (!(yield* repo.exists(`${dir}/src/entry.server.ts`))) {
        findings.push(
          fail(`${dir} server-renders but has no src/entry.server.ts`, {
            path: dir,
            fix: spaFix,
          }),
        );
      }
    }
    return configs.length > 0 && findings.length === 0
      ? [pass('every server-rendered foldkit app has its server entry')]
      : findings;
  }),
};

export const foldkitChecks = [foldkitRendering];
