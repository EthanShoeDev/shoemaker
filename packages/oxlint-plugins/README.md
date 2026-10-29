# @shoe-box-tools/oxlint-plugins

Generic [oxlint JS plugins](https://oxc.rs/docs/guide/usage/linter/js-plugins.html) shared by every shoebox repo, plus a vendored copy of [anti-slop](https://github.com/dmmulroy/anti-slop). You normally do not list these yourself: [`@shoe-box-tools/oxlint-config`](../oxlint-config) resolves and enables them.

Each subpath export is one plugin. In the workspace, exports point at `src/*.ts` (oxlint type-strips them under Node); the published package points at `dist/*.mjs` built by tsdown, because Node refuses to type-strip files under `node_modules`.

## Custom rules

| Rule | Export | Why |
| --- | --- | --- |
| `disable-comments/require-description` | `./require-disable-description` | Every `eslint-disable`/`oxlint-disable` directive must carry a `-- reason`; an empty reason after `--` does not count. Also forbids `@effect-diagnostics` comments, which silence tsgolint but escape `reportUnusedDisableDirectives`, so Effect rules are suppressed with `oxlint-disable` like every other rule. |
| `dynamic-import/no-unexplained-dynamic-import` | `./no-unexplained-dynamic-import` | Static imports are the default because bundlers, knip and typecheck can see them. A dynamic `import()` needs a `// dynamic-import -- reason` comment on the line above its statement, above the import, or on the import itself. |
| `import-boundaries/no-cross-package-relative-imports` | `./no-cross-package-relative-imports` | A relative import may not leave its package (the nearest directory with a `package.json`). Cross-package code goes through the target's package name and a declared workspace dependency, so typecheck, knip and task-runner caching see the edge. The message names the target package from its `package.json`, so no scope option is needed. |
| `env-access/no-raw-env-access` | `./no-raw-env-access` | `process.env` and `import.meta.env` are read only through the generated `@<scope>/env` package (Effect `Config`), which validates every variable and keeps secrets out of client bundles. Options: `envPackage` (name shown in the message) and `allowedPackages` (package names whose files may read the raw environment; default: any package named `@<anything>/env`). |
| `route-active/no-render-time-match-route` | `./no-render-time-match-route` | A render-time call of a `useMatchRoute()` result is memoized forever by the React Compiler (TanStack/router#4499), so active states freeze on mount. Event-time calls are fine. The file documents when the rule can be deleted. |
| `backdrop-filter/no-backdrop-filter` | `./no-backdrop-filter` | Tailwind `backdrop-*` filter utilities, `[backdrop-filter:…]` and `backdropFilter` style keys re-filter everything behind the element every frame and make open/close animations stutter. |

Retired: `unknown-cast/require-comment` (`anti-slop/no-chained-type-assertions` covers `as unknown as`) and `prefer-effect/*` (covered upstream by `@effect/tsgo`).

## Vendored anti-slop

`./vendor/anti-slop` (plugin `anti-slop`) and `./vendor/anti-slop/effect` (plugin `anti-slop-effect`) are dmmulroy/anti-slop at `c44ef22`, MIT. See [`src/vendor/anti-slop/UPSTREAM.md`](src/vendor/anti-slop/UPSTREAM.md) for the local delta (`?? null`), how to refresh, and why the tree is excluded from lint and format. `@shoe-box-tools/oxlint-config` turns every rule on and off-lists the rejected ones with reasons.

## Development

```sh
bun run test       # custom rule suites (test/) + vendored RuleTester suites
bun run typecheck
bun run build      # dist/ for publishing
```

Tests use oxlint's own `RuleTester` (`oxlint/plugins-dev`). The path-based rules run against the fixture repo in `test/fixtures/repo`. `@oxlint/plugins` must match the `oxlint` version exactly; both are pinned in the root catalog.
