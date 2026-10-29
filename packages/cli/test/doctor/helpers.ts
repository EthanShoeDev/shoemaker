import { Array as Arr, Effect } from 'effect';

import type { DoctorCheck } from '../../src/doctor/types.ts';
import { makeMemoryRepo } from '../../src/engine/repo-memory.ts';

export const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

export const runCheck = (
  check: DoctorCheck,
  files: Readonly<Record<string, string>>,
) => check.run(makeMemoryRepo(files));

export const failures = (
  check: DoctorCheck,
  files: Readonly<Record<string, string>>,
) =>
  runCheck(check, files).pipe(
    Effect.map((findings) => Arr.filter(findings, (f) => !f.ok)),
  );
