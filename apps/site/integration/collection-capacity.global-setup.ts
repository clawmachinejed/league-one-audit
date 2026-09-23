import { prepareIntegrationDatabase, cleanIntegrationDatabase, integrationEnvironment, assertSafeIntegrationDatabase,
  ownerQuery } from './neon-integration-harness';
import { installAllPlayerScheduleTestClock } from './all-player-schedule-test-clock';
import { assertCapacityOwner, CAPACITY_OWNER_ENV } from './collection-capacity-supervision';

export default async function setup() {
  const environment = integrationEnvironment();
  const target = { database: environment.expectedDatabase, branch: environment.expectedBranchId };
  const ownership = () => assertCapacityOwner(ownerQuery, target, process.env[CAPACITY_OWNER_ENV]);
  await assertSafeIntegrationDatabase(environment);
  await ownership();
  await prepareIntegrationDatabase();
  try { await installAllPlayerScheduleTestClock(); }
  catch (error) { await ownership(); await cleanIntegrationDatabase(); throw error; }
  return async () => { await ownership(); await cleanIntegrationDatabase(); };
}
