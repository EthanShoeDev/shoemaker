import { defineConfig } from 'oxfmt';
import { defineShoemakerFormat } from 'shoemaker-oxfmt-config';

export default defineConfig(
  defineShoemakerFormat({
    ignorePatterns: [
      // Reference clones of the repos shoemaker standardizes; read-only.
      '.external/**',
    ],
  }),
);
