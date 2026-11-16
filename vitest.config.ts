import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'], testTimeout: 30_000, hookTimeout: 60_000, pool: 'forks',
    // All files share one schema on a real Postgres, so they must run one after another there.
    fileParallelism: !process.env.TEST_DATABASE_URL,
  },
});
