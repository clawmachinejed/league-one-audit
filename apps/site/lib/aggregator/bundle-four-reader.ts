import 'server-only';

import { getDatabase, withDatabaseAbortSignal, type Database } from '../database';
import { createLeagueAdministrationStore } from '../league-administration/store';
import { createBundleFourReadService } from './bundle-four';
export type { BundleFourRead, BundleFourReadInput, FrozenHistoricalContinuity } from './bundle-four';

/** Optional internal history composition; no public reader or worker imports it. */
export function createBundleFourReader(database: Database = getDatabase()) {
  const administration = () => createLeagueAdministrationStore(withDatabaseAbortSignal(database, AbortSignal.timeout(3_000)));
  return createBundleFourReadService({ enabled: database.enabled,
    readSourceMapping: id => administration().readSourceMapping(id),
    readSource: input => administration().readSource(input),
  });
}
