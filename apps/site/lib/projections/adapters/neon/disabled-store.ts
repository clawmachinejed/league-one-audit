import 'server-only';

import type { ProjectionStore } from './contracts';

/** Complete no-database implementation; inputs deliberately remain uninspected. */
export function createDisabledProjectionStore(): ProjectionStore {
  return {
    enabled: false,
    async upsertLeaguePeriodAuthority() {
      return { kind: 'disabled' };
    },
    async readMatchupSnapshotByLeagueKey() {
      return null;
    },
    async registerLeagueSeason() {
      return { kind: 'disabled' };
    },
    async upsertScoringEntities() {
      return { kind: 'disabled' };
    },
    async upsertNflGames() {
      return { kind: 'disabled' };
    },
    async recordProjectionSlate() {
      return { kind: 'disabled' };
    },
    async readCurrentProjectionSlate() {
      return null;
    },
    async ensureFutureRefreshStates() {
      return { kind: 'disabled' };
    },
    async readFutureRefreshPlan() {
      return [];
    },
    async beginFutureProjectionRefresh() {
      return { kind: 'disabled' };
    },
    async completeFutureProjectionRefresh() {
      return { kind: 'disabled' };
    },
    async failFutureProjectionRefresh() {
      return { kind: 'disabled' };
    },
    async beginFutureMaterializationRefresh() {
      return { kind: 'disabled' };
    },
    async completeFutureMaterializationRefresh() {
      return { kind: 'disabled' };
    },
    async failFutureMaterializationRefresh() {
      return { kind: 'disabled' };
    },
    async recordProjectionCandidates() {
      return { kind: 'disabled' };
    },
    async readLatestCandidatesBySleeperIds() {
      return [];
    },
    async freezeLatestBaselines() {
      return { kind: 'disabled' };
    },
    async readFrozenBaselinesBySleeperIds() {
      return [];
    },
    async recordGameStates() {
      return { kind: 'disabled' };
    },
    async recordLeagueWeekObservation() {
      return { kind: 'disabled' };
    },
    async acquireJob() {
      return { kind: 'disabled' };
    },
    async completeJob() {
      return false;
    },
    async failJob() {
      return false;
    },
    async publishSnapshot() {
      return { kind: 'disabled' };
    },
    async pruneHistory() {
      return { kind: 'disabled' };
    },
    async readCurrentSnapshot() {
      return null;
    },
    async readSnapshotSelectionBySleeperLeagueId() {
      return { selected: null, latest: null };
    },
  };
}
