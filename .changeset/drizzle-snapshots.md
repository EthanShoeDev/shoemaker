---
'shoemaker': patch
'shoemaker-oxfmt-config': patch
---

The formatter and jscpd skip drizzle-kit's migration snapshots
(`**/migrations/*/snapshot.json`). They are generated, and each repeats most of
the one before, so a repo's second migration failed `jscpd:check`.
