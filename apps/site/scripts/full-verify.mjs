import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const pnpmEntrypoint = process.env.npm_execpath;

if (!pnpmEntrypoint) {
  console.error('Full Verify must be started with: pnpm verify:full');
  process.exit(1);
}

function run(label, args) {
  console.log(`\n== ${label} ==`);
  const result = spawnSync(process.execPath, [pnpmEntrypoint, ...args], {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.error) {
    console.error(`${label} could not start: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`${label} failed with exit code ${result.status ?? 'unknown'}.`);
    process.exit(result.status ?? 1);
  }
  console.log(`${label}: PASSED`);
}

run('Fast Check', ['verify']);
run('Chromium browser tests', ['test:browser']);

const integrationEnvironment = resolve(root, 'apps/site/.env.integration.local');
if (existsSync(integrationEnvironment)) {
  console.log('\nThe isolated integration environment exists. The repository harness will now recheck every authorization, identity, role, TLS, sentinel, and production-denylist guard before any reset.');
  run('Isolated Neon integration tests', ['test:integration']);
} else {
  console.log('\nIsolated Neon integration tests: SKIPPED / UNVERIFIED');
  console.log('apps/site/.env.integration.local is not configured. No database command was run.');
}

console.log('\nFull Verify completed.');
