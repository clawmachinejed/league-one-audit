import 'server-only';

import { getDatabase, withDatabaseAbortSignal, type Database } from '../database';
import { createLeagueAdministrationMethods } from './neon/administration';
import type { LeagueAdministrationStore } from './store-contracts';

export type { LeagueAdministrationStore, LeagueAdministrationStoreRead } from './store-contracts';

/** The existing database factory owns credentials, TLS and Preview isolation. */
export function createLeagueAdministrationStore(database: Database): LeagueAdministrationStore {
  if (!database.enabled) return {
    enabled: false,
    // Disabled stores deliberately do not inspect inputs or construct a client.
    recordObservation: async () => ({ status: 'disabled' }),
    readSource: async () => ({ status: 'disabled' }),
    readSourceByConnection: async () => ({ status: 'disabled' }),
    listEnrollments: async () => [],
  };
  return { enabled: true, ...createLeagueAdministrationMethods(database) };
}

export function getLeagueAdministrationStore(): LeagueAdministrationStore {
  return createLeagueAdministrationStore(withDatabaseAbortSignal(getDatabase(), AbortSignal.timeout(3_000)));
}
