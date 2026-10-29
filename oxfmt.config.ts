import { defineShoeboxFormat } from '@shoe-box-tools/oxfmt-config';
import { defineConfig } from 'oxfmt';

export default defineConfig(
  defineShoeboxFormat({
    ignorePatterns: [
      // Reference clones of the repos shoebox standardizes; read-only.
      '.external/**',
    ],
  }),
);
