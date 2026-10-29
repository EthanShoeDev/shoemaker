import plugin from '../src/no-cross-package-relative-imports.ts';
import { fixture, ruleOf, tester } from './rule-tester.ts';

const filename = fixture('packages/app/src/index.ts');
const crossing = (spec: string, targetPackage: string) => ({
  messageId: 'noCrossPackageRelativeImport',
  data: { spec, targetPackage },
});

tester.run(
  'import-boundaries/no-cross-package-relative-imports',
  ruleOf(plugin, 'no-cross-package-relative-imports'),
  {
    valid: [
      { filename, code: "import { x } from './local';" },
      { filename, code: "import { x } from '../src/index.ts';" },
      { filename, code: "import { x } from '@fx/lib';" },
      { filename, code: "export { x } from '../package.json';" },
      // oxlint-disable-next-line no-template-curly-in-string -- the template literal is the code under test
      { filename, code: 'const m = import(`../../lib/${name}`);' },
    ],
    invalid: [
      {
        name: 'import into a sibling package',
        filename,
        code: "import { x } from '../../lib/src/index.ts';",
        errors: [crossing('../../lib/src/index.ts', '@fx/lib')],
      },
      {
        name: 're-export from a sibling package directory',
        filename,
        code: "export * from '../../lib/src';",
        errors: [crossing('../../lib/src', '@fx/lib')],
      },
      {
        name: 'named re-export into the workspace root',
        filename,
        code: "export { x } from '../../../scripts/x.ts';",
        errors: [crossing('../../../scripts/x.ts', 'fixture-root')],
      },
      {
        name: 'literal dynamic import with a bundler query',
        filename,
        code: "const raw = import('../../env/src/index.ts?raw');",
        errors: [crossing('../../env/src/index.ts?raw', '@fx/env')],
      },
    ],
  },
);
