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
    'Release-wrapper integration tests require the exact destructive-test authorization.',
  );
}
for (const name of requiredEnvironmentNames) {
  if (!process.env[name]?.trim()) {
    throw new Error(`Release-wrapper integration tests require ${name}.`);
  }
}
process.env.PROJECTION_INTEGRATION_ENV_FILE = '.env.integration.local';
await import('./verify-all-player-migration-release-wrapper.ts');
