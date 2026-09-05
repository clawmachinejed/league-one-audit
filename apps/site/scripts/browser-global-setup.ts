import type { FullConfig } from '@playwright/test';
import { verifyBrowserTarget, type BrowserTarget } from './browser-target';

export default async function setup(config: FullConfig) {
  const target: BrowserTarget = (config.metadata.browserTarget as BrowserTarget | undefined) ?? {
    mode: 'explicit', baseURL: config.projects[0].use.baseURL!,
  };
  await verifyBrowserTarget(target);
}
