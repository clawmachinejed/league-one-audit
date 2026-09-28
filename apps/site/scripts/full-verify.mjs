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

function run(label, args, controlPlane = false) {
  console.log(`\n== ${label} ==`);
  const result = spawnSync(process.execPath, [pnpmEntrypoint, ...args], {
    cwd: root,
    env: controlPlane ? process.env : Object.fromEntries(Object.entries(process.env)
      .filter(([name]) => name !== 'NEON_TEST_API_KEY')),
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
run('Synthetic account browser tests', ['test:browser:accounts']);

const integrationEnvironment = resolve(root, 'apps/site/.env.integration-control.local');
if (existsSync(integrationEnvironment) || process.env.NEON_TEST_API_KEY?.trim()) {
  console.log('\nDisposable integration configuration is present. The supervisor will verify the test-only project and parent, create a fresh branch, and recheck every database guard before any reset.');
  run('Disposable Neon integration tests', ['test:integration'], true);
} else {
  console.log('\nDisposable Neon integration tests: SKIPPED / UNVERIFIED');
  console.log('Configure apps/site/.env.integration-control.local or the secured NEON_TEST_* environment. Legacy database URL files do not enable this gate. No database command was run.');
}

console.log('\nFull Verify completed.');
