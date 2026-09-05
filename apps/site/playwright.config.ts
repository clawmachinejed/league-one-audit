import { defineConfig, devices } from '@playwright/test';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { selectBrowserTarget } from './scripts/browser-target';

const target = selectBrowserTarget(process.env, dirname(fileURLToPath(import.meta.url)));

export default defineConfig({
  globalSetup: './scripts/browser-global-setup.ts',
  metadata: target.mode === 'local' ? { browserTarget: target } : {},
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
    baseURL: target.baseURL,
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
  webServer: target.mode === 'explicit'
    ? undefined
    : {
        command: 'pnpm build && node scripts/write-browser-marker.mjs && pnpm start',
        cwd: target.siteDir,
        env: {
          L1_BROWSER_RUN_ID: target.runId,
          L1_BROWSER_SOURCE: JSON.stringify(target.source),
          PORT: new URL(target.baseURL).port || '80',
        },
        reuseExistingServer: false,
        timeout: 240_000,
        url: target.baseURL,
      },
});
