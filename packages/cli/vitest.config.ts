import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'cli',
    include: ['test/**/*.test.ts'],
    // The integration tests run oxfmt and write temp repos.
    testTimeout: 30_000,
    // `init` commits what it generates: give that commit a fixed identity and
    // no signing, whatever the machine's git config says.
    env: {
      GIT_AUTHOR_NAME: 'test',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'test',
      GIT_COMMITTER_EMAIL: 'test@example.com',
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'commit.gpgsign',
      GIT_CONFIG_VALUE_0: 'false',
    },
  },
});
