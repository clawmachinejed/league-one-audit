import { defineConfig, devices } from '@playwright/test';

const suppliedBaseUrl = process.env.BASE_URL?.trim();
const port = process.env.PORT?.trim() || '3000';
const baseURL = suppliedBaseUrl || `http://localhost:${port}`;

export default defineConfig({
  testDir: './e2e',
  outputDir: '../../test-results/playwright',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI
    ? [
        ['line'],
        ['html', { open: 'never', outputFolder: '../../.playwright/report' }],
      ]
    : 'list',
  use: {
    baseURL,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: suppliedBaseUrl
    ? undefined
    : {
        command: 'pnpm build && pnpm start',
        reuseExistingServer: !process.env.CI,
        timeout: 240_000,
        url: baseURL,
      },
});
