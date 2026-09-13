import {
  cleanIntegrationDatabase,
  prepareIntegrationDatabase,
} from './neon-integration-harness';
import { installAllPlayerScheduleTestClock } from './all-player-schedule-test-clock';

export default async function globalSetup(): Promise<() => Promise<void>> {
  await prepareIntegrationDatabase();
  await installAllPlayerScheduleTestClock();
  return async () => cleanIntegrationDatabase();
}
