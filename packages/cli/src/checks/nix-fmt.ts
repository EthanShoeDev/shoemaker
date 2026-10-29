import { Effect, String as Str } from 'effect';

import { runCapture } from '../engine/process.ts';
import type { RepoCheck } from './types.ts';

const FLAKE = 'flake.nix';

// Formats with the flake's own formatter (alejandra) through `nix fmt`. Runs
// as a CLI check rather than a shell script so the package script works on
// Windows, where nix itself is not installed and the check is skipped.
export const nixFmtCheck: RepoCheck = {
  name: 'nix-fmt',
  description:
    'flake.nix is formatted by the flake formatter (skipped without nix)',
  run: Effect.fnUntraced(function* (repo, { fix }) {
    if (!(yield* repo.exists(FLAKE))) {
      return { ok: true, report: `no ${FLAKE}; skipped`, fixes: [] };
    }
    // `-c` is alejandra's check mode; everything after `--` goes to it.
    const args = fix ? ['fmt', '--', FLAKE] : ['fmt', '--', '-c', FLAKE];
    const { code, stdout, stderr } = yield* runCapture('nix', args, repo.root);
    if (code === -1) {
      return { ok: true, report: 'nix not installed; skipped', fixes: [] };
    }
    const output = Str.trim(`${stdout}\n${stderr}`);
    if (code === 0) return { ok: true, report: output, fixes: [] };
    return {
      ok: false,
      report: fix ? output : `${output}\nFix: shoemaker check nix-fmt --fix`,
      fixes: [],
    };
  }),
};
