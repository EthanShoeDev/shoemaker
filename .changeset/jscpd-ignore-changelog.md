---
'shoemaker': patch
---

jscpd skips `CHANGELOG.md`. changesets writes it, and in a `fixed` group each
release a package sits out adds another "No changes in this release." entry,
until the run is long enough for jscpd to report the file as a clone of
itself. `shoemaker sync` rewrites `.jscpd.json`.
