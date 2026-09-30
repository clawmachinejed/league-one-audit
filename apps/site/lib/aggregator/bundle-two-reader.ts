import 'server-only';

import { getDatabase, withDatabaseAbortSignal, type Database } from '../database';
import { createExactMatchupCompatibilityReader, createLeagueAdministrationStore } from '../league-administration/store';
import { createProjectionStore } from '../projection-store';
import { scoreSparseStatistics } from '../projections/domain/scoring';
import { createBundleTwoReadService } from './bundle-two';
export type { BundleTwoRead, BundleTwoReadInput } from './bundle-two';

/** Optional B2 composition stays outside facades used by lightweight observers. */
export function createBundleTwoReader(database: Database = getDatabase()) {
  const administration = () => createLeagueAdministrationStore(withDatabaseAbortSignal(database, AbortSignal.timeout(3_000)));
  return createBundleTwoReadService({
    enabled: database.enabled,
    readSourceMapping: id => administration().readSourceMapping(id),
    readAcceptedCurrentRoster: (mapping, options) => administration().readAcceptedCurrentRoster(mapping, options),
    readAcceptedTeamManagers: mapping => administration().readAcceptedTeamManagers(mapping),
    readAcceptedLeagueSettings: mapping => administration().readAcceptedLeagueSettings(mapping),
    readAcceptedExactMatchups: (mapping, week) => administration().readAcceptedExactMatchups(mapping, week),
    readSource: input => administration().readSource(input),
    readEnrollment: (selector, season) => administration().readEnrollment(selector, season),
    readExactMatchupCompatibility: input => createExactMatchupCompatibilityReader(database).readExactMatchupCompatibility(input),
    readAllPlayerPlayerMetrics: input => {
      const store = createProjectionStore(withDatabaseAbortSignal(database, AbortSignal.timeout(3_000)));
      return store.readAllPlayerPlayerMetrics?.(input, scoreSparseStatistics)
        ?? Promise.resolve({ status: 'unavailable', observedAt: null, throughWeek: null, rowsRead: 0, metrics: [] });
    },
  });
}
