---
'shoemaker': patch
---

New repos get a `flake.lock` pinned to a known nixpkgs revision, so the first
`nix fmt` (run by `lint:check`) or `nix develop` no longer writes one and
leaves the fresh repo with an uncommitted file. `bun run update:nix-flake`
moves it forward. Existing repos already have the lock nix wrote: commit it.
