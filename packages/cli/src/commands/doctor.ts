import { Array as Arr, Console, Effect } from 'effect';
import { Argument, Command } from 'effect/cli';

import { configExists, loadConfig } from '../config/load.ts';
import { doctorChecks } from '../doctor/index.ts';
import type { Finding } from '../doctor/types.ts';
import { makeRepo } from '../engine/repo-live.ts';
import { renderSummary, type Style } from '../engine/report.ts';
import { planRepo } from '../engine/sync.ts';
import { fail, resolveRoot, style } from './shared.ts';

const renderFinding = (finding: Finding, s: Style) => {
  const mark = finding.ok ? s.green('✓') : s.red('✗');
  const where = finding.path === undefined ? '' : s.dim(` (${finding.path})`);
  const lines = [`  ${mark} ${finding.message}${where}`];
  if (!finding.ok && finding.fix !== undefined) {
    lines.push(`      ${s.dim('fix:')} ${finding.fix}`);
  }
  if (!finding.ok && finding.migration !== undefined) {
    lines.push(
      `      ${s.dim('run:')} ${s.cyan(`shoe-box migrate ${finding.migration}`)}`,
    );
  }
  return Arr.join(lines, '\n');
};

export const runDoctor = Effect.fnUntraced(function* (directory: string) {
  const s = yield* style;
  const root = yield* resolveRoot(directory);
  const repo = yield* makeRepo(root);
  let failures = 0;
  for (const check of doctorChecks) {
    const findings = yield* check.run(repo);
    failures += Arr.filter(findings, (f) => !f.ok).length;
    yield* Console.log(s.bold(check.id) + s.dim(` - ${check.description}`));
    yield* Console.log(
      findings.length === 0
        ? `  ${s.dim('nothing to check')}`
        : Arr.join(
            Arr.map(findings, (f) => renderFinding(f, s)),
            '\n',
          ),
    );
  }

  if (yield* configExists(root)) {
    const config = yield* loadConfig(root);
    const { plan } = yield* planRepo(root, config);
    yield* Console.log(`\n${s.bold('sync plan')}\n${renderSummary(plan, s)}`);
  }

  if (failures > 0) {
    yield* Console.log(s.red(`\n${failures} problem(s) found`));
    return yield* fail(`${failures} doctor finding(s) failed`);
  }
  yield* Console.log(s.green('\nNo problems found'));
});

export const doctorCommand = Command.make(
  'doctor',
  {
    directory: Argument.String('directory').pipe(
      Argument.withDescription('Repo to audit'),
      Argument.withDefault('.'),
    ),
  },
  ({ directory }) => runDoctor(directory),
).pipe(
  Command.withDescription(
    'Audit any repo against the current preferences and report drift',
  ),
);
