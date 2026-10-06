import 'server-only';

import { getDatabase, withDatabaseAbortSignal, type Database } from '../database';
import { createLeagueAdministrationMethods } from './neon/administration';
export { createAccountEnrollmentMethods as createAccountEnrollmentStore } from './neon/account-enrollment';
export { createPublicIntakeStore, createPublicDataRefreshStore } from './neon/public-intake';
import { createProjectionExactMatchupCompatibilityReader, createProjectionStore } from '../projection-store';
import { createBundleOneReadService } from '../aggregator/bundle-one';
import { EXACT_MATCHUPS_READ_SQL, readAcceptedExactMatchupsRows } from './neon/exact-matchups';
import { readNativePeriodMapping } from './neon/period-mapping';
import type { ExactMatchupCompatibilityRead } from '../aggregator/exact-matchup-compatibility';
import type { LeagueAdministrationStore } from './store-contracts';
import { createRetainedMatchupComparison } from './retained-matchup-comparison';

export type { LeagueAdministrationStore, LeagueAdministrationStoreRead } from './store-contracts';

/** The existing database factory owns credentials, TLS and Preview isolation. */
export function createLeagueAdministrationStore(database: Database): LeagueAdministrationStore {
  if (!database.enabled) return {
    enabled: false,
    // Disabled stores deliberately do not inspect inputs or construct a client.
    recordObservation: async () => ({ status: 'disabled' }),
    readSourceMapping: async () => null,
    beginTransactionAttempt: async () => { throw new Error('Administration persistence disabled.'); },
    readAcceptedTransactions: async () => ({ status: 'disabled' }),
    scanRetainedTransactions: async () => ({ status: 'disabled', reason: 'persistence_disabled' }),
    readRetainedTransactions: async () => ({ status: 'disabled', reason: 'persistence_disabled' }),
    beginCalculationSourceCapture: async () => { throw new Error('Administration persistence disabled.'); },
    beginLeagueSettingsAttempt: async () => { throw new Error('Administration persistence disabled.'); },
    readAcceptedLeagueSettings: async () => ({ status: 'disabled' }),
    beginExactMatchupAttempt: async () => { throw new Error('Administration persistence disabled.'); },
    readAcceptedExactMatchups: async () => ({ status: 'disabled' }),
    beginRosterAttempt: async () => { throw new Error('Administration persistence disabled.'); },
    beginRosterCapture: async () => { throw new Error('Administration persistence disabled.'); },
    readAcceptedTeamManagers: async () => ({ status: 'disabled' }),
    beginTeamManagerEvidenceAttempt: async () => { throw new Error('Administration persistence disabled.'); },
    readAcceptedTeamManagerEvidence: async () => ({ status: 'disabled' }),
    readAcceptedCurrentRoster: async () => ({ status: 'disabled' }),
    readSource: async () => ({ status: 'disabled' }),
    readSourceByConnection: async () => ({ status: 'disabled' }),
    scanRetainedMatchups: async () => ({ status: 'disabled', reason: 'persistence_disabled' }),
    readRetainedMatchups: async () => ({ status: 'disabled', reason: 'persistence_disabled' }),
    listEnrollmentInventory: async () => ({ entries: [] }),
    readEnrollment: async () => ({ status: 'missing' }),
    listEnrollments: async () => [],
  };
  return { enabled: true, ...createLeagueAdministrationMethods(database) };
}

export function getLeagueAdministrationStore(): LeagueAdministrationStore {
  return createLeagueAdministrationStore(withDatabaseAbortSignal(getDatabase(), AbortSignal.timeout(3_000)));
}

/** Each scan/batch receives its own deadline, including retries after a paused manifest. */
export function createRetainedMatchupComparisonReader(database: Database = getDatabase()) {
  const readStore = () => createLeagueAdministrationStore(withDatabaseAbortSignal(database, AbortSignal.timeout(3_000)));
  return createRetainedMatchupComparison({
    scanRetainedMatchups: selection => readStore().scanRetainedMatchups(selection),
    readRetainedMatchups: (selection, observationIds) => readStore().readRetainedMatchups(selection, observationIds),
  });
}

export type { ExactMatchupCompatibilityReadInput } from '../projection-store';

/** Optional internal composition. Existing pages and workers do not call this reader. */
export function createExactMatchupCompatibilityReader(
  database: Database = getDatabase(),
): ReturnType<typeof createProjectionExactMatchupCompatibilityReader> {
  if (database.enabled) return {
    async readExactMatchupCompatibility(input) {
      const operationDatabase = withDatabaseAbortSignal(database, AbortSignal.timeout(3_000));
      if (!operationDatabase.enabled) throw new Error('Enabled database unexpectedly disabled.');
      return createProjectionExactMatchupCompatibilityReader(operationDatabase, {
        acceptedSql: EXACT_MATCHUPS_READ_SQL, readAcceptedRows: readAcceptedExactMatchupsRows, readNativePeriodMapping,
      }).readExactMatchupCompatibility(input);
    },
  };
  return {
    async readExactMatchupCompatibility(): Promise<ExactMatchupCompatibilityRead> {
      // Disabled persistence never examines the request or constructs a provider client.
      return {
        official: { status: 'disabled' },
        sourceHistory: { status: 'unavailable', reason: 'persistence_disabled' },
        forecast: { status: 'unavailable', reason: 'persistence_disabled' },
        gameState: { status: 'unavailable', reason: 'persistence_disabled' },
        probability: { status: 'unavailable', reason: 'persistence_disabled' },
      };
    },
  };
}

/** B1 composition remains internal; the established database factory owns isolation and credentials. */
export function createBundleOneReader(database: Database = getDatabase()) {
  const administration = () => createLeagueAdministrationStore(withDatabaseAbortSignal(database, AbortSignal.timeout(3_000)));
  return createBundleOneReadService({
    enabled: database.enabled,
    readAcceptedExactMatchups: (mapping, week) => administration().readAcceptedExactMatchups(mapping, week),
    readAcceptedCurrentRoster: (mapping, options) => administration().readAcceptedCurrentRoster(mapping, options),
    readExactMatchupCompatibility: input => createExactMatchupCompatibilityReader(database).readExactMatchupCompatibility(input),
    readAllPlayerBoxScores: input => {
      const store = createProjectionStore(withDatabaseAbortSignal(database, AbortSignal.timeout(3_000)));
      return store.readAllPlayerBoxScores?.(input)
        ?? Promise.resolve({ status: 'unavailable', observedAt: null, revision: null, players: {} });
    },
  });
}
