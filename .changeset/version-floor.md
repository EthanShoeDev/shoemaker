---
'shoemaker': patch
---

`sync` treats dependency versions in package.json files as a floor. A repo
that raises a version past what shoemaker writes keeps it, and that bump no
longer makes the file look hand-edited, so it is not a conflict. A newer
version from shoemaker still replaces an older one. Changing a version into
another kind of spec (`catalog:`, `file:`, a range) is still a hand edit.

Existing repos need nothing: locks written by older versions are still
recognized.
