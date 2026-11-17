import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:8788', trace: 'retain-on-failure' },
  webServer: {
    command: 'vite build && SEED_DEMO=1 SEED_TODAY=0 JOBS_IN_PROCESS=0 PGLITE_DIR=:memory: APP_URL=http://localhost:8788 PORT=8788 tsx src/server/index.ts',
    url: 'http://localhost:8788/api/health',
    timeout: 120_000,
    reuseExistingServer: false,
  },
});
