import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const authorization = 'I_ACKNOWLEDGE_THIS_RESETS_AN_ISOLATED_DATABASE';
const requiredEnvironmentNames = [
  'PROJECTION_INTEGRATION_OWNER_DATABASE_URL',
  'PROJECTION_INTEGRATION_RUNTIME_DATABASE_URL',
  'PROJECTION_INTEGRATION_EXPECTED_DATABASE',
  'PROJECTION_INTEGRATION_EXPECTED_BRANCH_ID',
  'PROJECTION_INTEGRATION_EXPECTED_BRANCH_NAME',
  'PROJECTION_INTEGRATION_DATABASE_SENTINEL',
  'PROJECTION_INTEGRATION_PRODUCTION_DENYLIST',
];

if (process.env.PROJECTION_INTEGRATION_AUTHORIZATION !== authorization) {
  throw new Error(
    'Integration tests require the exact destructive-test authorization in .env.integration.local.',
  );
}

for (const name of requiredEnvironmentNames) {
  if (!process.env[name]?.trim()) {
    throw new Error(`Integration tests require ${name} in .env.integration.local.`);
  }
}

process.env.PROJECTION_INTEGRATION_ENV_FILE = '.env.integration.local';

const vitest = fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url));
const config = fileURLToPath(new URL('../vitest.integration.config.ts', import.meta.url));
const child = spawn(process.execPath, [vitest, 'run', '--config', config], {
  env: process.env,
  stdio: 'inherit',
  windowsHide: true,
});

child.once('error', () => {
  process.stderr.write('The isolated integration-test runner could not start.\n');
  process.exitCode = 1;
});

child.once('exit', (code, signal) => {
  if (signal) {
    process.stderr.write('The isolated integration-test runner was interrupted.\n');
    process.exitCode = 1;
    return;
  }
  process.exitCode = code ?? 1;
});
