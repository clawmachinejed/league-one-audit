if (process.argv.length !== 2) throw new Error('Administration capacity integration accepts no arguments.');
if (process.env.PROJECTION_INTEGRATION_AUTHORIZATION !== 'I_ACKNOWLEDGE_THIS_RESETS_AN_ISOLATED_DATABASE') {
  throw new Error('Administration capacity integration requires the exact destructive-test authorization.');
}
for (const name of ['PROJECTION_INTEGRATION_OWNER_DATABASE_URL', 'PROJECTION_INTEGRATION_RUNTIME_DATABASE_URL',
  'PROJECTION_INTEGRATION_EXPECTED_DATABASE', 'PROJECTION_INTEGRATION_EXPECTED_BRANCH_ID',
  'PROJECTION_INTEGRATION_EXPECTED_BRANCH_NAME', 'PROJECTION_INTEGRATION_DATABASE_SENTINEL',
  'PROJECTION_INTEGRATION_PRODUCTION_DENYLIST']) {
  if (!process.env[name]?.trim()) throw new Error(`Administration capacity integration requires ${name}.`);
}
process.env.PROJECTION_INTEGRATION_ENV_FILE = '.env.integration.local';
await import('./measure-league-administration-capacity.ts');
