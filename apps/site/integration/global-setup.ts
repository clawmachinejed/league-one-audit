import {
  cleanIntegrationDatabase,
  prepareIntegrationDatabase,
} from './neon-integration-harness';
import { installAllPlayerScheduleTestClock } from './all-player-schedule-test-clock';
import { initializeIntegrationArtifactDirectory } from './integration-artifacts';
import { rehearseAccountTransition } from './account-transition-rehearsal';

export default async function globalSetup(): Promise<() => Promise<void>> {
  try {
    await initializeIntegrationArtifactDirectory();
    await rehearseAccountTransition();
    await prepareIntegrationDatabase();
    await installAllPlayerScheduleTestClock();
  }
  catch (error) { await cleanIntegrationDatabase(); throw error; }
  return async () => cleanIntegrationDatabase();
}
