import {
  cleanIntegrationDatabase,
  prepareIntegrationDatabase,
} from './neon-integration-harness';
import { installAllPlayerScheduleTestClock } from './all-player-schedule-test-clock';
import { initializeIntegrationArtifactDirectory } from './integration-artifacts';
import { qualificationBinding, qualificationCleanup } from './qualification-profile';

export default async function globalSetup(): Promise<() => Promise<void>> {
  const binding = qualificationBinding(); // Reject partial context before any database operation.
  await prepareIntegrationDatabase();
  try {
    await initializeIntegrationArtifactDirectory();
    await installAllPlayerScheduleTestClock();
  }
  catch (error) { await cleanIntegrationDatabase(); throw error; }
  return async () => qualificationCleanup(cleanIntegrationDatabase, binding);
}
