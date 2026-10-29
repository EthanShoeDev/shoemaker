import plugin from '../src/require-disable-description.ts';
import { ruleOf, tester } from './rule-tester.ts';

const missing = { messageId: 'missingLintDescription' };
const effect = { messageId: 'forbiddenEffectDiagnostics' };

tester.run(
  'disable-comments/require-description',
  ruleOf(plugin, 'require-description'),
  {
    valid: [
      '// oxlint-disable-next-line no-console -- the CLI report is its stdout\nconsole.log(1);',
      '/* eslint-disable no-console -- generated file */',
      '// oxlint-disable-line no-console -- reason\n',
      '// an ordinary comment mentioning oxlint-disable later in the line',
      '// @ts-expect-error covered by typescript/ban-ts-comment instead',
    ],
    invalid: [
      {
        name: 'no separator',
        code: '// oxlint-disable-next-line no-console\nconsole.log(1);',
        errors: [missing],
      },
      {
        name: 'empty description after the separator',
        code: '// eslint-disable-next-line no-console -- \nconsole.log(1);',
        errors: [missing],
      },
      {
        name: 'block form',
        code: '/* oxlint-disable */',
        errors: [missing],
      },
      {
        name: 'effect diagnostics suppression',
        code: '// @effect-diagnostics-next-line floatingEffect:off\nconst x = 1;',
        errors: [effect],
      },
      {
        name: 'effect diagnostics file-level suppression',
        code: '// @effect-diagnostics floatingEffect:off',
        errors: [effect],
      },
    ],
  },
);
