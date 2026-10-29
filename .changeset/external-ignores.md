---
'shoemaker': patch
'shoemaker-oxlint-config': patch
'shoemaker-oxfmt-config': patch
'shoemaker-knip-config': patch
---

Ignore `.external/` (reference repos cloned for agents to read) instead of
`docs/cloned-repos-as-docs/`: generated repos gitignore it, and the shared
oxlint, oxfmt and knip configs, jscpd and VS Code skip it.
