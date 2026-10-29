# shoemaker-knip-config

`defineKnipConfig()` for `knip.ts`, with the ignores every shoemaker repo shares.

```ts
// knip.ts
import { defineKnipConfig } from 'shoemaker-knip-config';

export default defineKnipConfig({
  ignoreDependencies: ['tailwindcss'],
});
```

Run it as `knip --no-config-hints --cache`.

## What it adds

- `ignoreExportsUsedInFile: true`: exported types and values that are also used in their own file (Effect service interfaces, schema-derived types) count as used.
- `ignoreBinaries` (`sharedIgnoreBinaries`): `nix`, `gh`, `secretspec`, `varlock`, `alejandra`, `direnv`, `nlx`, `nr`, `uv`. The nix dev shell or CI puts them on PATH; none is an npm package.
- `ignore` (`sharedIgnore`): vendored and generated code, cloned docs and agent directories.

The repo's own scalar options win. Its `ignore` and `ignoreBinaries` lists are appended to the shared ones.
