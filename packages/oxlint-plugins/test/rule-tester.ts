import { fileURLToPath } from 'node:url';

import type { Plugin } from '@oxlint/plugins';
import { RuleTester } from 'oxlint/plugins-dev';

export const tester = new RuleTester({
  languageOptions: { parserOptions: { lang: 'tsx' } },
});

/** Absolute path of a file inside the fixture repo (test/fixtures/repo). */
export const fixture = (relative: string) =>
  fileURLToPath(new URL(`fixtures/repo/${relative}`, import.meta.url));

/** The single rule a custom plugin exports, by name. */
export const ruleOf = (plugin: Plugin, name: string) => {
  const rule = plugin.rules[name];
  if (rule === undefined) throw new Error(`plugin has no rule ${name}`);
  return rule;
};
