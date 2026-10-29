import plugin from '../src/no-raw-env-access.ts';
import { fixture, ruleOf, tester } from './rule-tester.ts';

const app = fixture('packages/app/src/index.ts');
const envPkg = fixture('packages/env/src/index.ts');
const processEnv = { messageId: 'noProcessEnv' };
const importMetaEnv = { messageId: 'noImportMetaEnv' };

tester.run(
  'env-access/no-raw-env-access',
  ruleOf(plugin, 'no-raw-env-access'),
  {
    valid: [
      { filename: app, code: "import { env } from '@fx/env';\nenv.PORT;" },
      {
        filename: app,
        code: 'const process = { env: 1 };\nconst e = other.env;',
      },
      // The default allowlist is any `@<scope>/env` package.
      { filename: envPkg, code: 'export const port = process.env.PORT;' },
      { filename: envPkg, code: 'export const mode = import.meta.env.MODE;' },
      // An explicit allowlist replaces the default.
      {
        filename: app,
        code: 'process.env.PORT;',
        options: [{ allowedPackages: ['@fx/app'] }],
      },
    ],
    invalid: [
      {
        name: 'process.env member',
        filename: app,
        code: 'const port = process.env.PORT;',
        errors: [processEnv],
      },
      {
        name: 'computed process env',
        filename: app,
        code: "const env = process['env'];",
        errors: [processEnv],
      },
      {
        name: 'import.meta.env member',
        filename: app,
        code: 'const mode = import.meta.env.MODE;',
        errors: [importMetaEnv],
      },
      {
        name: 'env package named in the message',
        filename: app,
        code: 'process.env;',
        options: [{ envPackage: '@fx/env' }],
        errors: [
          { messageId: 'noProcessEnv', data: { envPackage: '@fx/env' } },
        ],
      },
      {
        name: 'explicit allowlist drops the default',
        filename: envPkg,
        code: 'process.env.PORT;',
        options: [{ allowedPackages: ['@fx/other-env'] }],
        errors: [processEnv],
      },
    ],
  },
);
