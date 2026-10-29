import {
  Array as Arr,
  Effect,
  Option,
  pipe,
  Record as Rec,
  Schema,
  String as Str,
} from 'effect';

import { decodeJsonc, invokes, stripComments } from '../checks/workspace.ts';
import type { Repo } from '../engine/repo.ts';
import {
  OXFMT_RC,
  OXLINT_RC,
  fail,
  globAll,
  listSome,
  manifestsOf,
  pass,
  scriptsOf,
} from './shared.ts';
import type { DoctorCheck, Finding } from './types.ts';

const OXLINT_TS = 'oxlint.config.ts';
const OXFMT_TS = 'oxfmt.config.ts';
const SHARED_OXLINT = 'shoe-box-oxlint-config';
const SHARED_OXFMT = 'shoe-box-oxfmt-config';
const CATEGORIES = [
  'correctness',
  'perf',
  'restriction',
  'suspicious',
  'pedantic',
  'style',
];

const Severity = Schema.Union([
  Schema.String,
  Schema.Finite,
  Schema.Array(Schema.Unknown),
]);
const Rules = Schema.Record(Schema.String, Severity);
const OxlintRc = Schema.Struct({
  categories: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  options: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  rules: Schema.optional(Rules),
  overrides: Schema.optional(
    Schema.Array(Schema.Struct({ rules: Schema.optional(Rules) })),
  ),
});

const isWarn = (severity: unknown): boolean =>
  severity === 'warn' ||
  severity === 1 ||
  (Arr.isArray(severity) && isWarn(severity[0]));

const oxlintTs = (repo: Repo) =>
  repo
    .read(OXLINT_TS)
    .pipe(
      Effect.map((source) =>
        source === undefined ? undefined : stripComments(source),
      ),
    );

const usesShared = (source: string | undefined, pkg: string) =>
  source !== undefined &&
  (Str.includes(`'${pkg}'`)(source) || Str.includes(`"${pkg}"`)(source));

export const oxlintConfigFormat: DoctorCheck = {
  id: 'oxlint-config-ts',
  description: 'oxlint is configured with oxlint.config.ts, not .oxlintrc.json',
  run: Effect.fnUntraced(function* (repo) {
    const rcs = yield* globAll(repo, OXLINT_RC);
    const hasTs = yield* repo.exists(OXLINT_TS);
    if (rcs.length > 0) {
      return Arr.map(rcs, (path) =>
        fail(`${path} should be ${OXLINT_TS}`, {
          path,
          fix: `move it to ${OXLINT_TS} on ${SHARED_OXLINT}`,
        }),
      );
    }
    return hasTs
      ? [pass(`${OXLINT_TS} present`)]
      : [
          fail(`no ${OXLINT_TS}`, {
            fix: `add ${OXLINT_TS} with defineShoeboxConfig from ${SHARED_OXLINT}`,
          }),
        ];
  }),
};

export const oxlintSharedConfig: DoctorCheck = {
  id: 'oxlint-shared-config',
  description: `oxlint uses ${SHARED_OXLINT}, or a hand-rolled config with all 6 categories at error and type-aware options`,
  run: Effect.fnUntraced(function* (repo) {
    const source = yield* oxlintTs(repo);
    if (source === undefined) {
      const rc = decodeJsonc(OxlintRc, yield* repo.read('.oxlintrc.json'));
      const missing = Arr.filter(
        CATEGORIES,
        (c) => Option.getOrUndefined(rc)?.categories?.[c] !== 'error',
      );
      return [
        fail(
          missing.length > 0
            ? `no ${OXLINT_TS}; categories not at error: ${Arr.join(missing, ', ')}`
            : `no ${OXLINT_TS}`,
          { fix: `add ${OXLINT_TS} on ${SHARED_OXLINT}` },
        ),
      ];
    }
    if (usesShared(source, SHARED_OXLINT))
      return [pass(`${OXLINT_TS} uses ${SHARED_OXLINT}`)];
    const findings: Array<Finding> = [];
    const missing = Arr.filter(
      CATEGORIES,
      (c) => !new RegExp(`\\b${c}\\s*:\\s*['"]error['"]`, 'u').test(source),
    );
    if (missing.length > 0) {
      findings.push(
        fail(
          `hand-rolled ${OXLINT_TS}: categories not at error: ${Arr.join(missing, ', ')}`,
          {
            path: OXLINT_TS,
            fix: `switch to defineShoeboxConfig from ${SHARED_OXLINT} (sets all 6 categories to error)`,
          },
        ),
      );
    }
    const options = Arr.filter(
      ['typeAware', 'typeCheck'],
      (option) => !new RegExp(`\\b${option}\\s*:\\s*true`, 'u').test(source),
    );
    if (options.length > 0) {
      findings.push(
        fail(
          `hand-rolled ${OXLINT_TS}: options missing ${Arr.join(options, ', ')}`,
          {
            path: OXLINT_TS,
            fix: `set options: { typeAware: true, typeCheck: true, reportUnusedDisableDirectives: 'error' }, or use ${SHARED_OXLINT}`,
          },
        ),
      );
    }
    if (findings.length === 0) {
      findings.push(
        pass(
          `hand-rolled ${OXLINT_TS} has all categories at error and type-aware options`,
        ),
        fail(`${OXLINT_TS} is hand-rolled`, {
          path: OXLINT_TS,
          fix: `move repo-specific rules into defineShoeboxConfig({ rules, overrides }) from ${SHARED_OXLINT} so preference changes arrive by version bump`,
        }),
      );
    }
    return findings;
  }),
};

export const oxlintNoWarn: DoctorCheck = {
  id: 'oxlint-no-warn',
  description:
    'No `warn` severity in any oxlint config (zero warnings: rules are error or off)',
  run: Effect.fnUntraced(function* (repo) {
    const findings: Array<Finding> = [];
    for (const path of yield* globAll(repo, OXLINT_RC)) {
      const rc = Option.getOrUndefined(
        decodeJsonc(OxlintRc, yield* repo.read(path)),
      );
      const rules = [
        rc?.rules,
        ...Arr.map(rc?.overrides ?? [], (o) => o.rules),
      ];
      const warned = [
        ...pipe(
          Rec.toEntries(rc?.categories ?? {}),
          Arr.filter(([, s]) => isWarn(s)),
          Arr.map(([c]) => `category ${c}`),
        ),
        ...Arr.flatMap(rules, (r) =>
          pipe(
            Rec.toEntries(r ?? {}),
            Arr.filter(([, s]) => isWarn(s)),
            Arr.map(([rule]) => rule),
          ),
        ),
      ];
      if (warned.length > 0) {
        findings.push(
          fail(`${path}: warn severity on ${listSome(warned)}`, {
            path,
            fix: 'set each rule to error or off',
          }),
        );
      }
    }
    for (const path of yield* repo.glob('**/oxlint.config.{ts,mts,js,mjs}')) {
      const source = stripComments((yield* repo.read(path)) ?? '');
      const lines = Arr.flatMap(Str.split(source, '\n'), (line, index) =>
        /['"]warn['"]/u.test(line) ? [`line ${index + 1}`] : [],
      );
      if (lines.length > 0) {
        findings.push(
          fail(`${path}: 'warn' severity at ${listSome(lines)}`, {
            path,
            fix: "set each rule to 'error' or 'off' (with a reason comment)",
          }),
        );
      }
    }
    return findings.length > 0
      ? findings
      : [pass('no warn severity in oxlint configs')];
  }),
};

export const oxlintUnusedDirectives: DoctorCheck = {
  id: 'oxlint-unused-directives',
  description: "options.reportUnusedDisableDirectives is 'error'",
  run: Effect.fnUntraced(function* (repo) {
    const source = yield* oxlintTs(repo);
    if (usesShared(source, SHARED_OXLINT))
      return [pass(`set by ${SHARED_OXLINT}`)];
    if (
      source !== undefined &&
      /reportUnusedDisableDirectives\s*:\s*['"]error['"]/u.test(source)
    ) {
      return [pass("reportUnusedDisableDirectives: 'error'")];
    }
    const viaCli = Arr.some(scriptsOf(yield* manifestsOf(repo)), (s) =>
      Str.includes('--report-unused-disable-directives-severity=error')(
        s.command,
      ),
    );
    return [
      fail(
        viaCli
          ? 'unused disable directives are only reported via a CLI flag, not oxlint options'
          : 'unused disable directives are not reported as errors',
        {
          fix: "options: { reportUnusedDisableDirectives: 'error' }",
        },
      ),
    ];
  }),
};

const TYPE_AWARE_FLAGS =
  /\s--(?:type-aware|type-check|report-unused-disable-directives(?:-severity(?:=\S+)?)?)\b/u;

export const oxlintCliFlags: DoctorCheck = {
  id: 'oxlint-cli-flags',
  description:
    'Type-aware settings live in oxlint options, not in --type-aware/--type-check CLI flags',
  run: Effect.fnUntraced(function* (repo) {
    const flagged = Arr.filter(
      scriptsOf(yield* manifestsOf(repo)),
      (s) => invokes(s.command, 'oxlint') && TYPE_AWARE_FLAGS.test(s.command),
    );
    if (flagged.length === 0)
      return [pass('no type-aware CLI flags in oxlint scripts')];
    return [
      fail(
        `${flagged.length} oxlint script(s) pass type-aware flags on the CLI: ${listSome(
          Arr.map(flagged, (s) => `${s.manifest.path}#${s.name}`),
          4,
        )}`,
        {
          fix: `move the flags into ${OXLINT_TS} options and drop them from the scripts`,
        },
      ),
    ];
  }),
};

export const oxfmtConfigFormat: DoctorCheck = {
  id: 'oxfmt-config-ts',
  description: 'oxfmt is configured with oxfmt.config.ts, not .oxfmtrc.json(c)',
  run: Effect.fnUntraced(function* (repo) {
    const rcs = yield* globAll(repo, OXFMT_RC);
    if (rcs.length > 0) {
      return Arr.map(rcs, (path) =>
        fail(`${path} should be ${OXFMT_TS}`, {
          path,
          ...(Str.includes('/')(path)
            ? {
                fix: `fold into the root ${OXFMT_TS} ignorePatterns/overrides and delete it`,
              }
            : { fix: `move it to ${OXFMT_TS} on shoe-box-oxfmt-config` }),
        }),
      );
    }
    return (yield* repo.exists(OXFMT_TS))
      ? [pass(`${OXFMT_TS} present`)]
      : [
          fail(`no ${OXFMT_TS}`, {
            fix: `add ${OXFMT_TS} with defineShoeboxFormat from ${SHARED_OXFMT}`,
          }),
        ];
  }),
};

const OxfmtRc = Schema.Struct({
  sortImports: Schema.optional(Schema.Unknown),
  experimentalSortImports: Schema.optional(Schema.Unknown),
});

export const oxfmtSortImports: DoctorCheck = {
  id: 'oxfmt-sort-imports',
  description:
    'oxfmt sorts imports (oxlint sort-imports is off because the formatter owns order)',
  run: Effect.fnUntraced(function* (repo) {
    const source = yield* repo.read(OXFMT_TS);
    if (source !== undefined) {
      const code = stripComments(source);
      if (usesShared(code, SHARED_OXFMT))
        return [pass(`set by ${SHARED_OXFMT}`)];
      return /\bsortImports\s*:\s*(?:true|\{)/u.test(code)
        ? [pass('sortImports enabled')]
        : [
            fail(`${OXFMT_TS} does not enable sortImports`, {
              path: OXFMT_TS,
              fix: 'sortImports: true, or use defineShoeboxFormat',
            }),
          ];
    }
    for (const path of ['.oxfmtrc.jsonc', '.oxfmtrc.json']) {
      const rc = decodeJsonc(OxfmtRc, yield* repo.read(path));
      if (Option.isSome(rc)) {
        const enabled = Arr.some(
          [rc.value.sortImports, rc.value.experimentalSortImports],
          (value) => value !== undefined && value !== false,
        );
        return enabled
          ? [pass(`${path} enables import sorting`)]
          : [
              fail(`${path} does not enable sortImports`, {
                path,
                fix: `use ${OXFMT_TS} on shoe-box-oxfmt-config, which enables it`,
              }),
            ];
      }
    }
    return [
      fail('no oxfmt config', {
        fix: `add ${OXFMT_TS} with defineShoeboxFormat from ${SHARED_OXFMT}`,
      }),
    ];
  }),
};

// Rules the shared config retired because upstream now covers them.
const RETIRED = /['"](unknown-cast|prefer-effect)\/[\w-]+['"]/gu;
const RETIRED_FILES =
  '**/{require-unknown-cast-comment,forbidden-unknown-cast,unknown-cast,prefer-effect}.{ts,js}';

export const retiredPlugins: DoctorCheck = {
  id: 'retired-plugins',
  description:
    'Retired custom rules (unknown-cast/*, prefer-effect/*) are gone',
  run: Effect.fnUntraced(function* (repo) {
    const findings: Array<Finding> = [];
    const configs = [
      ...(yield* globAll(repo, OXLINT_RC)),
      ...(yield* repo.glob('**/oxlint.config.{ts,mts,js,mjs}')),
    ];
    for (const path of configs) {
      const source = stripComments((yield* repo.read(path)) ?? '');
      const rules = [
        ...new Set(
          Arr.map([...Str.matchAll(RETIRED)(source)], (m) =>
            Str.slice(1, -1)(m[0]),
          ),
        ),
      ];
      if (rules.length > 0) {
        findings.push(
          fail(`${path} enables retired rules: ${listSome(rules)}`, {
            path,
            fix: 'delete them: anti-slop require-safety-comment-for-type-assertion and the @effect/tsgo presets cover them',
          }),
        );
      }
    }
    for (const path of yield* repo.glob(RETIRED_FILES)) {
      if (Str.includes('/vendor/')(path)) continue;
      findings.push(
        fail(`retired plugin source ${path}`, {
          path,
          fix: 'delete it and its jsPlugins entry',
        }),
      );
    }
    return findings.length > 0 ? findings : [pass('no retired custom rules')];
  }),
};

export const lintChecks = [
  oxlintConfigFormat,
  oxlintSharedConfig,
  oxlintNoWarn,
  oxlintUnusedDirectives,
  oxlintCliFlags,
  oxfmtConfigFormat,
  oxfmtSortImports,
  retiredPlugins,
];
