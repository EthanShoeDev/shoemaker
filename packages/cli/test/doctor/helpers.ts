import { Array as Arr, Effect, Record as Rec } from 'effect';

import type { DoctorCheck } from '../../src/doctor/types.ts';
import { renderJson } from '../../src/engine/json.ts';
import { makeMemoryRepo } from '../../src/engine/repo-memory.ts';

// Fixture files from JSON values, each written the way shoemaker writes JSON.
export const jsonFiles = (files: Readonly<Record<string, unknown>>) =>
  Effect.all(Rec.map(files, renderJson));

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
