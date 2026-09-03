import { describe, expect, it, vi } from 'vitest';
import type { DatabaseClient, DatabaseRow } from '../../../database';
import type { LineupObservationClaim, LineupWatchTarget } from './lineup-watch-contracts';
vi.mock('server-only', () => ({}));
import { createLineupWatchSyncMethods } from './lineup-watch-sync';
import { createLineupWatchClaimMethods } from './lineup-watch-claims';
import { createLineupWatchObservationMethods } from './lineup-watch-observations';
import { createLineupWatchReadMethods } from './lineup-watch-read';

function fake() {
  const calls: { sql: string; values: readonly unknown[] }[] = [];
  const database: DatabaseClient = { enabled: true, async query<Row extends DatabaseRow>(sql: string, values: readonly unknown[] = []) {
    calls.push({ sql, values }); return [] as readonly Row[];
  } };
  return { database, calls };
}
const claim: LineupObservationClaim = {
  watchId: '10000000-0000-4000-8000-000000000001', watchGeneration: 1, authorityGeneration: 1,
  watchClass: 'current', materializationLane: 'future', attemptId: '10000000-0000-4000-8000-000000000002',
  claimGeneration: 2, workerId: 'unit-worker', targetObservedVersion: 3,
};
const target: LineupWatchTarget = {
  leagueKey: 'fixture', sourceProvider: 'sleeper', externalLeagueId: 'opaque-league',
  period: { season: 2026, seasonType: 'reg', week: 1 }, lineupRevisionVersion: 'lineup-v1', cadencePolicyVersion: 'lineup-cadence-v1',
  authorityGeneration: 1, watchClass: 'current', materializationLane: 'future', phase: 0,
  expectedRosterCount: 2, expectedStarterSlotCount: 1, expectedRosterIds: ['roster-b', 'roster-a'], initialNextCheckAt: '2026-09-03T12:00:00Z',
};
const observation = { claim, lineupRevision: 'a'.repeat(64), requestStartedAt: '2026-09-03T12:00:00Z', requestCompletedAt: '2026-09-03T12:00:01Z', nextCheckAt: '2026-09-03T12:01:00Z' };

describe('durable lineup watch repository', () => {
  it('reads planning identities without authority freshness but never includes lineup or publication data', async () => {
    const { database, calls } = fake();
    await createLineupWatchReadMethods(database).readLineupWatchSchedule(['fixture']);
    expect(calls).toHaveLength(1);
    expect(calls[0].values).toEqual([['fixture']]);
    expect(calls[0].sql).toContain('retired_at IS NULL');
    expect(calls[0].sql).not.toContain('league_period_authorities');
    expect(calls[0].sql).not.toMatch(/payload|latest_lineup_revision|expected_roster|pending_since|FOR UPDATE/u);
    await createLineupWatchReadMethods(database).readLineupWatchSchedule([]);
    expect(calls).toHaveLength(1);
  });
  it('rejects incomplete or duplicate authoritative roster membership before a query', async () => {
    const { database, calls } = fake();
    const methods = createLineupWatchSyncMethods(database);
    for (const expectedRosterIds of [['roster-a'], ['roster-a', 'roster-a'], ['roster-a', '']]) {
      await expect(methods.synchronizeLineupWatchStates({ registeredLeagueKeys: ['fixture'], targets: [{ ...target, expectedRosterIds }] })).rejects.toThrow();
    }
    expect(calls).toHaveLength(0);
  });
  it('rejects duplicate or unregistered logical targets', async () => {
    const { database, calls } = fake();
    const methods = createLineupWatchSyncMethods(database);
    await expect(methods.synchronizeLineupWatchStates({ registeredLeagueKeys: ['fixture'], targets: [target, target] })).rejects.toThrow();
    await expect(methods.synchronizeLineupWatchStates({ registeredLeagueKeys: [], targets: [target] })).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
  it('synchronizes in one statement with an authority generation fence and invalidates ownership', async () => {
    const { database, calls } = fake();
    await createLineupWatchSyncMethods(database).synchronizeLineupWatchStates({ registeredLeagueKeys: ['fixture'], targets: [target] });
    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toContain('pg_advisory_xact_lock');
    expect(calls[0].sql).toContain('a.authority_generation = i.authority_generation');
    expect(calls[0].sql).toContain('active_target_observed_version = NULL');
    const data = JSON.parse(calls[0].values[1] as string);
    expect(data[0].expected_roster_ids).toEqual(['roster-a', 'roster-b']);
  });
  it('claims with database time, bounded batch sizes and row locks', async () => {
    const { database, calls } = fake();
    await createLineupWatchClaimMethods(database).claimDueLineupObservations({ leagueKeys: ['fixture'], materializationLane: 'future', workerId: 'worker', leaseSeconds: 120, limit: 20, futureLimit: 18, catchUp: true });
    expect(calls[0].sql).toContain('FOR UPDATE OF w SKIP LOCKED');
    expect(calls[0].sql).toContain('lease_expires_at = now()');
    expect(calls[0].values).toEqual([['fixture'], 'future', 'worker', 120, 20, 18, true]);
  });
  it.each([0, 21, 1.5])('rejects invalid batch size %s', async (limit) => {
    const { database, calls } = fake();
    await expect(createLineupWatchClaimMethods(database).claimDueLineupObservations({ leagueKeys: ['fixture'], materializationLane: 'future', workerId: 'worker', leaseSeconds: 120, limit, futureLimit: 18, catchUp: true })).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
  it('acceptance increments only semantic versions and uses start before completion order', async () => {
    const { database, calls } = fake();
    expect(await createLineupWatchObservationMethods(database).completeLineupObservation(observation)).toEqual({ kind: 'stale' });
    expect(calls[0].sql).toContain('w.latest_lineup_revision IS DISTINCT FROM $10');
    expect(calls[0].sql).toContain('($11::timestamptz, $12::timestamptz) > (w.accepted_request_started_at, w.accepted_request_completed_at)');
    expect(calls[0].sql).toContain('COALESCE(w.pending_since');
    expect(calls[0].values).toHaveLength(13);
  });
  it('every accepted source must own the active reservation before releasing its lease', async () => {
    const { database, calls } = fake();
    await createLineupWatchObservationMethods(database).completeLineupObservation(observation);
    expect(calls[0].sql).toContain('w.active_attempt_id = $6::uuid');
    expect(calls[0].sql).toContain('w.claim_generation = $7::bigint');
    expect(calls[0].sql).not.toContain('w.attempt_started_at <=');
    expect(calls[0].values.slice(5, 9)).toEqual([claim.attemptId, claim.claimGeneration, claim.workerId, claim.targetObservedVersion]);
  });
  it('rejects invalid hashes and reversed observation time without querying', async () => {
    const { database, calls } = fake();
    const methods = createLineupWatchObservationMethods(database);
    await expect(methods.completeLineupObservation({ ...observation, lineupRevision: 'A'.repeat(64) })).rejects.toThrow();
    await expect(methods.completeLineupObservation({ ...observation, requestCompletedAt: '2026-09-03T11:00:00Z' })).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
  it('not-ready advances checking without replacing accepted or pending state', async () => {
    const { database, calls } = fake();
    await createLineupWatchObservationMethods(database).recordLineupObservationNotReady({ claim, checkedAt: observation.requestCompletedAt, nextCheckAt: observation.nextCheckAt });
    expect(calls[0].sql).toContain('consecutive_failures = 0');
    expect(calls[0].sql).not.toContain('latest_lineup_revision =');
    expect(calls[0].sql).not.toContain('pending_since =');
  });
  it('failure always releases an owned attempt but backs off only its observed version', async () => {
    const { database, calls } = fake();
    await createLineupWatchObservationMethods(database).failLineupObservation({ claim, failureCode: 'provider-unavailable', retryDelaysSeconds: [60, 300, 900, 3600] });
    expect(calls[0].sql).toContain('CASE WHEN w.observed_version = $9::bigint');
    expect(calls[0].sql).toContain('active_attempt_id = NULL');
    expect(calls[0].values.at(-1)).toEqual([60, 300, 900, 3600]);
  });
  it('rejects raw credential-bearing error strings', async () => {
    const { database, calls } = fake();
    await expect(createLineupWatchObservationMethods(database).failLineupObservation({ claim, failureCode: 'https://user:secret@example.test', retryDelaysSeconds: [60, 300, 900, 3600] })).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
  it('empty reads and claims make no database request', async () => {
    const { database, calls } = fake();
    const methods = createLineupWatchReadMethods(database);
    await methods.readLineupWatchStates([]); await methods.readPendingCurrentLineups([]); await methods.readPendingFutureLineups([]);
    await createLineupWatchClaimMethods(database).claimDueLineupObservations({ leagueKeys: [], materializationLane: 'future', workerId: 'worker', leaseSeconds: 120, limit: 20, futureLimit: 18, catchUp: true });
    expect(calls).toHaveLength(0);
  });
  it('prerequisite wake updates both states atomically and never reconsumes the same semantic version', async () => {
    const { database, calls } = fake();
    await createLineupWatchReadMethods(database).wakeFutureProjectionAndMaterialization({ watchId: claim.watchId, watchGeneration: 1, authorityGeneration: 1, projectionProvider: 'tank01', normalizerVersion: 'normalizer-v1', modelVersion: 'clock-v1', weekDistance: 1, wakeProjection: true });
    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toContain('INSERT INTO projection_period_refresh_states');
    expect(calls[0].sql).toContain('INSERT INTO league_week_materialization_states');
    expect(calls[0].sql).toContain('materialization_woken_version < observed_version');
    expect(calls[0].sql).toContain('projection_woken_version < observed_version');
  });
});
