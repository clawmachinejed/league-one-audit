import { defineConfig } from '@playwright/test';
import base from './playwright.config';
import type { BrowserTarget } from './scripts/browser-target';
import { accountBrowserEnvironment } from './scripts/account-browser-environment';

const target = base.metadata?.browserTarget as BrowserTarget | undefined;
const server = base.webServer;
if (!target || target.mode !== 'local' || !server || Array.isArray(server)) {
  throw new Error('Account browser fixtures cannot run against an existing or deployed server.');
}
const environment = accountBrowserEnvironment(process.env, target.baseURL);

export default defineConfig({
  ...base,
  testMatch: 'accounts-fixture.spec.ts',
  outputDir: '../../test-results/account-playwright',
  workers: 1,
  webServer: { ...server, env: { ...server.env, ...environment } },
});
