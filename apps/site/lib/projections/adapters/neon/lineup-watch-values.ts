import 'server-only';

import type { DatabaseRow } from '../../../database';
import type { LineupObservationClaim, LineupWatchFence, LineupWatchTarget, StoredLineupWatchState } from './lineup-watch-contracts';
import { normalizeIds, provider, requiredText, rowNullableText, rowNumber, rowText } from './database-values';

export function lineupInteger(value: number, min: number, max: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`Invalid ${label}.`);
  return value;
}
export function lineupTimestamp(value: string): string {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) throw new Error('Invalid lineup timestamp.');
  return new Date(milliseconds).toISOString();
}
export function lineupRevision(value: string): string {
  if (!/^[0-9a-f]{64}$/.test(value)) throw new Error('Invalid lineup revision.');
  return value;
}
export function lineupUuid(value: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new Error('Invalid lineup UUID.');
  return value;
}
export function lineupFenceValues(fence: LineupWatchFence): readonly unknown[] {
  if (!['current', 'future'].includes(fence.watchClass) || !['current', 'future'].includes(fence.materializationLane)) throw new Error('Invalid lineup ownership.');
  return [lineupUuid(fence.watchId), lineupInteger(fence.watchGeneration, 1, Number.MAX_SAFE_INTEGER, 'watch generation'),
    lineupInteger(fence.authorityGeneration, 1, Number.MAX_SAFE_INTEGER, 'authority generation'), fence.watchClass, fence.materializationLane];
}
export function lineupClaimValues(claim: LineupObservationClaim): readonly unknown[] {
  return [...lineupFenceValues(claim), lineupUuid(claim.attemptId),
    lineupInteger(claim.claimGeneration, 1, Number.MAX_SAFE_INTEGER, 'claim generation'), requiredText(claim.workerId, 'Worker ID'),
    lineupInteger(claim.targetObservedVersion, 0, Number.MAX_SAFE_INTEGER, 'observed version')];
}
export function lineupTargetRow(target: LineupWatchTarget): Readonly<Record<string, unknown>> {
  const ids = normalizeIds(target.expectedRosterIds);
  const count = lineupInteger(target.expectedRosterCount, 1, 1000, 'roster count');
  if (ids.length !== count || ids.length !== target.expectedRosterIds.length) throw new Error('Invalid authoritative roster IDs.');
  if (!['pre', 'reg', 'post'].includes(target.period.seasonType)
    || !['current', 'future', 'completed'].includes(target.watchClass)
    || (target.watchClass === 'completed') !== (target.materializationLane === null)
    || (target.watchClass !== 'completed' && !['current', 'future'].includes(target.materializationLane!))) throw new Error('Invalid lineup target classification.');
  return {
    league_key: requiredText(target.leagueKey, 'League key'), source_provider: provider(target.sourceProvider),
    external_league_id: requiredText(target.externalLeagueId, 'External league ID'),
    season: lineupInteger(target.period.season, 1920, 2200, 'season'), season_type: target.period.seasonType,
    week: lineupInteger(target.period.week, 1, 18, 'week'), lineup_revision_version: requiredText(target.lineupRevisionVersion, 'Revision version'),
    cadence_policy_version: requiredText(target.cadencePolicyVersion, 'Cadence policy version'),
    authority_generation: lineupInteger(target.authorityGeneration, 1, Number.MAX_SAFE_INTEGER, 'authority generation'),
    watch_class: target.watchClass, materialization_lane: target.materializationLane,
    phase: lineupInteger(target.phase, 0, 2, 'phase'), expected_roster_count: count,
    expected_starter_slot_count: lineupInteger(target.expectedStarterSlotCount, 1, 100, 'starter count'), expected_roster_ids: ids,
    next_check_at: target.watchClass === 'completed' ? null : lineupTimestamp(target.initialNextCheckAt!),
  };
}
export function lineupWatchFromRow(row: DatabaseRow): StoredLineupWatchState {
  const ids = row.expected_roster_ids;
  if (!Array.isArray(ids) || !ids.every((value) => typeof value === 'string')) throw new Error('Invalid stored lineup roster IDs.');
  return {
    id: rowText(row, 'id'), leagueKey: rowText(row, 'league_key'), sourceProvider: rowText(row, 'source_provider'), externalLeagueId: rowText(row, 'external_league_id'),
    period: { season: rowNumber(row, 'season'), seasonType: rowText(row, 'season_type') as StoredLineupWatchState['period']['seasonType'], week: rowNumber(row, 'week') },
    lineupRevisionVersion: rowText(row, 'lineup_revision_version'), cadencePolicyVersion: rowText(row, 'cadence_policy_version'),
    authorityGeneration: rowNumber(row, 'authority_generation'), watchGeneration: rowNumber(row, 'watch_generation'),
    watchClass: rowText(row, 'watch_class') as StoredLineupWatchState['watchClass'], materializationLane: rowNullableText(row, 'materialization_lane') as StoredLineupWatchState['materializationLane'],
    phase: rowNumber(row, 'phase') as 0 | 1 | 2, expectedRosterCount: rowNumber(row, 'expected_roster_count'), expectedStarterSlotCount: rowNumber(row, 'expected_starter_slot_count'), expectedRosterIds: ids,
    nextCheckAt: rowNullableText(row, 'next_check_at'), observedVersion: rowNumber(row, 'observed_version'),
    latestLineupRevision: rowNullableText(row, 'latest_lineup_revision'), acceptedRequestStartedAt: rowNullableText(row, 'accepted_request_started_at'), acceptedRequestCompletedAt: rowNullableText(row, 'accepted_request_completed_at'),
    lastCheckedAt: rowNullableText(row, 'last_checked_at'), lastCompleteObservationAt: rowNullableText(row, 'last_complete_observation_at'),
    lastMaterializedLineupRevision: rowNullableText(row, 'last_materialized_lineup_revision'), lastMaterializedSnapshotRevision: rowNullableText(row, 'last_materialized_snapshot_revision'), lastMaterializedVerifiedAt: rowNullableText(row, 'last_materialized_verified_at'),
    pendingSince: rowNullableText(row, 'pending_since'), activeAttemptId: rowNullableText(row, 'active_attempt_id'), claimGeneration: rowNumber(row, 'claim_generation'),
    leaseOwner: rowNullableText(row, 'lease_owner'), attemptStartedAt: rowNullableText(row, 'attempt_started_at'), leaseExpiresAt: rowNullableText(row, 'lease_expires_at'), attemptCount: rowNumber(row, 'attempt_count'),
    consecutiveFailures: rowNumber(row, 'consecutive_failures'), lastFailureCode: rowNullableText(row, 'last_failure_code'), retiredAt: rowNullableText(row, 'retired_at'), retirementReason: rowNullableText(row, 'retirement_reason'),
  };
}

/** Reused predicates have fixed parameter positions and perform no query of their own. */
export const LINEUP_AUTHORITY_FRESH_SQL = `a.verified_at BETWEEN now() - interval '10 minutes' AND now()
  AND a.source_observed_at BETWEEN now() - interval '10 minutes' AND now()`;
export const LINEUP_WATCH_FENCE_SQL = `w.id = $1::uuid AND w.watch_generation = $2::bigint
  AND w.authority_generation = $3::bigint AND a.authority_generation = w.authority_generation
  AND a.source_provider = w.source_provider AND a.source_external_league_id = w.external_league_id
  AND ${LINEUP_AUTHORITY_FRESH_SQL}
  AND w.watch_class = $4 AND w.materialization_lane = $5 AND w.retired_at IS NULL`;
export const LINEUP_CLAIM_FENCE_SQL = `${LINEUP_WATCH_FENCE_SQL}
  AND w.active_attempt_id = $6::uuid AND w.claim_generation = $7::bigint AND w.lease_owner = $8
  AND $9::bigint >= 0 AND w.lease_expires_at > now()`;
export const LINEUP_WATCH_RETURNING_SQL = `w.id::text, w.league_key, w.source_provider, w.external_league_id,
  w.season, w.season_type, w.week, w.lineup_revision_version, w.cadence_policy_version,
  w.authority_generation, w.watch_generation, w.watch_class, w.materialization_lane, w.phase,
  w.expected_roster_count, w.expected_starter_slot_count, w.expected_roster_ids,
  w.observed_version, w.latest_lineup_revision, w.last_materialized_lineup_revision,
  w.last_materialized_snapshot_revision, w.active_attempt_id::text, w.claim_generation,
  w.lease_owner, w.attempt_count, w.consecutive_failures, w.last_failure_code, w.retirement_reason,
  w.next_check_at::text, w.accepted_request_started_at::text, w.accepted_request_completed_at::text,
  w.last_checked_at::text, w.last_complete_observation_at::text, w.last_materialized_verified_at::text,
  w.pending_since::text, w.attempt_started_at::text, w.lease_expires_at::text, w.retired_at::text`;
