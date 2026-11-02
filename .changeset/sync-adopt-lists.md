---
'shoemaker': patch
---

`sync` no longer shortens a list in a file it merges into (`package.json`)
when it has no baseline for that file, as in a repo being adopted. Every entry
in such a file is the user's, so instead of replacing the list it reports a
conflict naming the entries it would drop (`/workspaces: "tools/*"`), and
`--force` does not override that: remove them by hand first. Adding entries,
and shortening a list shoemaker wrote itself, work as before. Files shoemaker
owns whole (`turbo.jsonc`, tsconfigs, `vitest.config.ts`) are still replaced
by `--force`.
