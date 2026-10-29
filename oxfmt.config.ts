import { defineConfig } from 'oxfmt';
import { defineShoeboxFormat } from 'shoe-box-oxfmt-config';

export default defineConfig(
  defineShoeboxFormat({
    ignorePatterns: [
      // Reference clones of the repos shoebox standardizes; read-only.
      '.external/**',
    ],
  }),
);
