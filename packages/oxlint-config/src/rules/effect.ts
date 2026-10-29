import antiSlop from 'shoe-box-oxlint-plugins/vendor/anti-slop';
import antiSlopEffect from 'shoe-box-oxlint-plugins/vendor/anti-slop/effect';

import { effectTsgoRules, everyRuleOf } from '../helpers.ts';
import type { OxlintRules } from '../helpers.ts';

// Offs must follow the spreads; a spread re-enables anything above it.

/** Effect rules, all elevated from the presets' warn/error to error. */
export const effect: OxlintRules = {
  ...effectTsgoRules,
  // Stricter twin of typescript/strict-boolean-expressions (which is on): it
  // also rejects `if (option)`-style nullable-object checks, the idiom here.
  'effecttsgo/strict-boolean-expressions': 'off',
  // Library-author rule: it wants a data-last overload on every exported
  // function, including plain app helpers like `between(a, b)`.
  'effecttsgo/missing-pipeable-signature': 'off',
  // Flags every use of a module still tagged unstable (effect/cli,
  // effect/http, effect/reactivity, effect/persistence, effect/sql), which is
  // the chosen stack; it marks upstream maturity, not a defect at the call site.
  'effecttsgo/unstable-api-usage': 'off',
  // Companion to unstable-api-usage: reports exports whose types expose those
  // same unstable modules.
  'effecttsgo/api-stability-leak': 'off',
  // env-access/no-raw-env-access owns process.env (and import.meta.env) and
  // names the env package; both on would report every read twice.
  'effecttsgo/process-env': 'off',
  // Same as effecttsgo/process-env.
  'effecttsgo/process-env-in-effect': 'off',
};

/** The custom rules from shoe-box-oxlint-plugins that apply everywhere. */
export const custom = (scope: string): OxlintRules => ({
  // effecttsgo/global-console and global-console-in-effect own console use;
  // both rules on would report every call twice.
  'no-console': 'off',
  // Every disable directive carries a reason.
  'disable-comments/require-description': 'error',
  // Relative imports stay inside their package.
  'import-boundaries/no-cross-package-relative-imports': 'error',
  // A dynamic import() must carry a `dynamic-import -- reason` comment.
  'dynamic-import/no-unexplained-dynamic-import': 'error',
  // process.env / import.meta.env go through Effect Config, or the repo's own
  // `@<scope>/env` package when it has one.
  'env-access/no-raw-env-access': [
    'error',
    { allowedPackages: [`@${scope}/env`] },
  ],
});

/** anti-slop (vendored jsPlugin), every rule at error minus the rejected ones. */
export const antiSlopRules: OxlintRules = {
  ...everyRuleOf('anti-slop', antiSlop),
  ...everyRuleOf('anti-slop-effect', antiSlopEffect),
  // Owned by oxfmt.
  'anti-slop/require-readable-spacing': 'off',
  // A SAFETY: comment before every assertion is ritual;
  // no-chained-type-assertions gates the evidence-free form.
  'anti-slop/require-safety-comment-for-type-assertion': 'off',
  // `(error: unknown)` at Promise/defect boundaries and `(value: unknown)` on
  // decoders and predicates is the honest type.
  'anti-slop/no-unknown-parameters': 'off',
  // Same boundary argument for JSON replacers and unwrap helpers.
  'anti-slop/no-unknown-returns': 'off',
  // `Record<string, unknown>` is the JSON-object contract; no finite key set to name.
  'anti-slop/no-unsafe-dictionary-type': 'off',
  // `...(x ? { x } : {})` omits a key rather than setting it to undefined
  // (which exactOptionalPropertyTypes rejects); the rule's replacement is a
  // mutable build-up.
  'anti-slop/no-conditional-empty-object-spread': 'off',
  // Flags Effect's own `Context.Service.Shape`.
  'anti-slop/no-shape-in-symbol-names': 'off',
  // Runtime-keyed lookup tables are `Record<string, T>` on purpose;
  // `satisfies` would push a `keyof` cast onto every lookup.
  'anti-slop/no-known-value-widening': 'off',
  // `filter().map()` on short arrays reads better than flatMap.
  'anti-slop/no-array-filter-map': 'off',
  // `make*` is an ordinary factory prefix (makeLayer, makeTestClient), not a
  // service-constructor marker.
  'anti-slop-effect/no-service-constructor-imports': 'off',
};
