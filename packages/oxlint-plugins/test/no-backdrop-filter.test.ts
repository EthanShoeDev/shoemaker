import plugin from '../src/no-backdrop-filter.ts';
import { ruleOf, tester } from './rule-tester.ts';

const backdrop = { messageId: 'noBackdropFilter' };

tester.run(
  'backdrop-filter/no-backdrop-filter',
  ruleOf(plugin, 'no-backdrop-filter'),
  {
    valid: [
      "const c = 'bg-black/50 blur-sm';",
      'const style = { filter: "blur(4px)" };',
      "const style = { ['backdropFilter']: 'none' };",
    ],
    invalid: [
      {
        name: 'tailwind utility in a class string',
        code: "const c = 'fixed inset-0 backdrop-blur-sm';",
        errors: [backdrop],
      },
      {
        name: 'tailwind utility in a template literal',
        // oxlint-disable-next-line no-template-curly-in-string -- the template literal is the code under test
        code: 'const c = `rounded ${x} backdrop-saturate-150`;',
        errors: [backdrop],
      },
      {
        name: 'arbitrary property',
        code: "const c = '[backdrop-filter:blur(2px)]';",
        errors: [backdrop],
      },
      {
        name: 'JSX className',
        code: "const el = <div className='backdrop-brightness-50' />;",
        errors: [backdrop],
      },
      {
        name: 'style object keys',
        code: "const style = { backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)' };",
        errors: [backdrop, backdrop],
      },
    ],
  },
);
