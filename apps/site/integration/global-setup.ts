import {
  cleanIntegrationDatabase,
  prepareIntegrationDatabase,
} from './neon-integration-harness';

export default async function globalSetup(): Promise<() => Promise<void>> {
  await prepareIntegrationDatabase();
  return async () => cleanIntegrationDatabase();
}
