---
'shoemaker': patch
'shoemaker-spanoptic': patch
---

Move to Effect 4.1.0, and pin `@effect/platform-node-shared` alongside it so
`bunx shoemaker` no longer crashes with "Cannot find module
'effect/crypto/Aead'" when `@effect/platform-bun`'s `^` range resolves past
the pinned `effect`. Generated repos now get Effect 4.1.0; foldkit apps will
not build until foldkit supports it.
