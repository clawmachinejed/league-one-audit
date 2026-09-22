import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Enabled account UI fixtures are a separate managed local build. They must
// never run against a deployment or silently reuse an existing server.
const pnpm = process.env.npm_execpath;
if (!pnpm || process.env.BASE_URL?.trim() || process.env.VERCEL_ENV?.trim()) {
  console.error('Run pnpm test:browser:accounts locally without BASE_URL or VERCEL_ENV.');
  process.exit(1);
}
const result = spawnSync(process.execPath, [pnpm, '--filter', '@l1/site', 'exec', 'playwright', 'test', '--config', 'playwright.accounts.config.ts'], {
  cwd: fileURLToPath(new URL('../../..', import.meta.url)),
  env: { ...process.env, L1_ACCOUNT_BROWSER_FIXTURE: 'true' },
  stdio: 'inherit', windowsHide: true,
});
if (result.error) console.error('Account browser verification could not start.');
process.exit(result.status ?? 1);
