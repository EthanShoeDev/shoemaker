import { Effect, String as Str } from 'effect';

import { fail, pass } from './shared.ts';
import type { DoctorCheck, Finding } from './types.ts';

export const agentsMd: DoctorCheck = {
  id: 'agents-md',
  description: 'AGENTS.md is canonical, CLAUDE.md is `@AGENTS.md`',
  run: Effect.fnUntraced(function* (repo) {
    const findings: Array<Finding> = [];
    const agents = yield* repo.read('AGENTS.md');
    const claude = yield* repo.read('CLAUDE.md');
    if (agents === undefined) {
      findings.push(
        fail('no AGENTS.md', {
          fix:
            claude === undefined
              ? 'add AGENTS.md (shoe-box sync renders it with the agents feature) and CLAUDE.md containing `@AGENTS.md`'
              : 'move CLAUDE.md to AGENTS.md, then make CLAUDE.md contain only `@AGENTS.md`',
        }),
      );
    }
    if (claude === undefined || Str.trim(claude) !== '@AGENTS.md') {
      findings.push(
        fail(
          claude === undefined
            ? 'no CLAUDE.md'
            : 'CLAUDE.md is not `@AGENTS.md`',
          {
            path: 'CLAUDE.md',
            fix: 'merge its content into AGENTS.md and replace it with the single line `@AGENTS.md`',
          },
        ),
      );
    }
    return findings.length > 0
      ? findings
      : [pass('AGENTS.md + CLAUDE.md -> @AGENTS.md')];
  }),
};

export const agentChecks = [agentsMd];
