import { assert, describe, it } from '@effect/vitest';

import { matchesAny } from '../../src/engine/glob.ts';

describe('matchesAny', () => {
  it('matches dotfiles at any depth', () => {
    assert.isTrue(matchesAny('.agents/skills/x/SKILL.md', ['**']));
    assert.isTrue(matchesAny('.agents/skills/x/SKILL.md', ['.agents/**']));
    assert.isTrue(matchesAny('apps/web/.env.schema', ['**/.env.schema']));
  });

  it('keeps * inside one segment', () => {
    assert.isTrue(matchesAny('a.ts', ['*.ts']));
    assert.isFalse(matchesAny('src/a.ts', ['*.ts']));
    assert.isTrue(matchesAny('src/a.ts', ['**/*.{ts,tsx}']));
  });

  it('matches route files by their literal names', () => {
    assert.isTrue(matchesAny('app/(tabs)/$.tsx', ['app/(tabs)/$.tsx']));
  });
});
