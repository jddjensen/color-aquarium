import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: 1,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    viewport: { width: 1280, height: 800 },
  },
  webServer: {
    command: 'python3 server.py',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
    env: { PORT: '4173', HOST: '127.0.0.1', APP_TIMEZONE: 'America/Denver' },
  },
});
