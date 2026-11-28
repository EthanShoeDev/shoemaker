---
'shoemaker': patch
---

CI runs in the flake's dev shell. The setup action installs Nix and enters the
default dev shell instead of installing bun alone, so CI gets the same bun,
node, `nixPackages` (ffmpeg, say) and shellHook environment as `nix develop`.
Before, anything listed in `nixPackages` was missing in CI, and code that
needed it could pass there without running. The bun pin is now in two places
(`packageManager` and the flake), and the Android release job uses the Nix
from the setup action. The setup action caches the Nix store for each job,
keyed on the repo's nix files. Only runs on the default branch save the cache,
and pull requests restore it, so a warm run downloads nothing.

`sync` rewrites the setup action, so a repo picks this up with no steps of its
own. Before you sync, check the hand-written part of `flake.nix`'s shellHook,
because it now runs in CI too. A command that needs a terminal, local files or
credentials has to skip CI, for example with `if [ -z "$CI" ]; then … fi`.
