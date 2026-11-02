---
'shoemaker': patch
---

`sync` writes a generated file the repo's formatter ignores exactly as
rendered. It used to format `apps/<app>/uniwind-types.d.ts` anyway, so the seed
was not the bytes Uniwind writes and the first Metro bundle changed it. The
seed only lands in new repos; in an existing one, the next bundle rewrites the
file once, and that change can be committed.
