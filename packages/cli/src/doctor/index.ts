import { agentChecks } from './agents.ts';
import { lintChecks } from './lint.ts';
import { securityChecks } from './security.ts';
import { toolingChecks } from './tooling.ts';
import type { DoctorCheck } from './types.ts';

export const doctorChecks: ReadonlyArray<DoctorCheck> = [
  ...securityChecks,
  ...lintChecks,
  ...toolingChecks,
  ...agentChecks,
];
