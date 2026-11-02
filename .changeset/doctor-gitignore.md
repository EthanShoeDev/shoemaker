---
'shoemaker': patch
---

`doctor`, `adopt` and `check` skip gitignored files. In a git repo they only
read what `git ls-files --cached --others --exclude-standard` lists, so cloned
reference repos (`docs/cloned-repos-as-docs/`, `.external/`) and build output
no longer produce findings. Outside git they read every file except
`node_modules`, `.git`, `dist`, `.turbo`, `.external` and `.direnv`, as before.
Globs go through Effect's `FileSystem.glob`, which skips those directories
without reading them, in place of `Bun.Glob`, which walked all of
`node_modules` and filtered afterwards.

`doctor` and `adopt` now work on Windows. `Bun.Glob` returned
backslash-separated paths there, so every package's folder came out empty,
`adopt` found no apps or packages, and the doctor printed backslash paths.
`FileSystem.glob` and git both return `/`-separated paths, and the repo's name
comes from `Path.basename` instead of splitting the root on `/`.

The `turbo-fix-uncached` check no longer flags a fix task that a package opts
out of with `"command": null`, since it runs nothing.
