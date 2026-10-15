import {
  cleanIntegrationDatabase,
  prepareIntegrationDatabase,
} from './neon-integration-harness';
import { installAllPlayerScheduleTestClock } from './all-player-schedule-test-clock';
import { initializeIntegrationArtifactDirectory } from './integration-artifacts';
import { FRESH_INSTALL_PROFILE, qualificationBinding, qualificationCleanup } from './qualification-profile';
import { readFreshInstallInitialEvidence, writeFreshInstallInstalledEvidence } from './fresh-install-evidence';
import { createPinnedIntegrationDatabase } from './neon-integration-harness';

export default async function globalSetup(): Promise<() => Promise<void>> {
  const binding = qualificationBinding(); // Reject partial context before any database operation.
  const freshInstall = binding?.context.profile === FRESH_INSTALL_PROFILE;
  if (freshInstall) await readFreshInstallInitialEvidence(binding!);
  await prepareIntegrationDatabase(freshInstall ? { freshInstall: true } : undefined);
  try {
    await initializeIntegrationArtifactDirectory();
    if (freshInstall) {
      const owner = await createPinnedIntegrationDatabase('owner');
      try { await writeFreshInstallInstalledEvidence(owner.database.query, binding!); }
      finally { await owner.close(); }
    } else await installAllPlayerScheduleTestClock();
  }
  catch (error) { await cleanIntegrationDatabase(); throw error; }
  return async () => qualificationCleanup(cleanIntegrationDatabase, binding);
}
