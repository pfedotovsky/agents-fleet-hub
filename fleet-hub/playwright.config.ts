import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/ux',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
  },
  webServer: [
    {
      command: 'npm run dev -- --host 127.0.0.1 --port 4173',
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'node tests/ux/replay-server.mjs',
      url: 'http://127.0.0.1:4174/health',
      reuseExistingServer: !process.env.CI,
    },
  ],
})
