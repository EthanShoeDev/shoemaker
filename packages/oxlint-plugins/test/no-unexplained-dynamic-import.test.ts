import plugin from '../src/no-unexplained-dynamic-import.ts';
import { ruleOf, tester } from './rule-tester.ts';

const missing = { messageId: 'missingReason' };

tester.run(
  'dynamic-import/no-unexplained-dynamic-import',
  ruleOf(plugin, 'no-unexplained-dynamic-import'),
  {
    valid: [
      "import { a } from './a';",
      "// dynamic-import -- code-split the editor\nconst editor = await import('./editor');",
      "const load = () =>\n  // dynamic-import -- optional dependency\n  import('./optional');",
      "const mod = import('./x'); // dynamic-import -- import cycle with ./y",
      "export const route = {\n  // dynamic-import -- lazy route\n  component: () => import('./page'),\n};",
    ],
    invalid: [
      {
        name: 'bare dynamic import',
        code: "const editor = await import('./editor');",
        errors: [missing],
      },
      {
        name: 'marker without a reason',
        code: "// dynamic-import --\nconst editor = await import('./editor');",
        errors: [missing],
      },
      {
        name: 'comment two lines above',
        code: "// dynamic-import -- too far away\n\nconst editor = await import('./editor');",
        errors: [missing],
      },
    ],
  },
);
