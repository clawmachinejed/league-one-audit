import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createIndependentDatabase, ownerQuery, type IndependentDatabase } from './neon-integration-harness';
import { databaseTime, lineageFixture, LINEUP_B, LINEUP_C } from './lineup-lineage-fixture';
import type { StoredLineupWatchState } from '../lib/projection-store';

function claim(state: StoredLineupWatchState) {
  return { watchId: state.id, watchGeneration: state.watchGeneration, authorityGeneration: state.authorityGeneration,
    watchClass: state.watchClass as 'current' | 'future', materializationLane: state.materializationLane!,
    attemptId: state.activeAttemptId!, claimGeneration: state.claimGeneration,
    workerId: state.leaseOwner!, targetObservedVersion: state.observedVersion };
}

describe.sequential('full-load observation ownership in isolated Neon', () => {
  let database: IndependentDatabase;
  beforeAll(() => { database = createIndependentDatabase(); });
  afterAll(async () => { await database.close(); });

  it.each(['current', 'future'] as const)('reserves %s before fetching, invalidates an old thin claim, and blocks another thin request', async (lane) => {
    const f = await lineageFixture(database, lane);
    await ownerQuery("UPDATE league_week_lineup_watch_states SET next_check_at=now()-interval '10 minutes' WHERE id=$1", [f.watchId]);
    const old = await f.store.claimDueLineupObservations({ leagueKeys: [f.leagueKey], materializationLane: lane,
      workerId: 'older-thin-worker', leaseSeconds: 120, limit: 1, futureLimit: 1, catchUp: true });
    expect(old).toHaveLength(1);
    const reserved = await f.store.reserveFullLineupObservation({ fence: f.fence, modelVersion: 'clock-v1', leaseSeconds: 120 });
    if (reserved.kind !== 'stored') throw new Error('Full observation was not reserved.');
    expect(reserved.state.leaseOwner).toBe(f.runId);
    expect(reserved.state.claimGeneration).toBeGreaterThan(old[0].claimGeneration);
    expect(reserved.state.latestLineupRevision).toBe(LINEUP_B);
    expect(reserved.state.observedVersion).toBe(old[0].observedVersion);
    const at = await databaseTime();
    expect(await f.store.completeLineupObservation({ claim: claim(old[0]), lineupRevision: LINEUP_C,
      requestStartedAt: at, requestCompletedAt: at, nextCheckAt: new Date(Date.parse(at) + 180_000).toISOString() })).toEqual({ kind: 'stale' });
    expect(await f.store.failLineupObservation({ claim: claim(old[0]), failureCode: 'source-unavailable',
      retryDelaysSeconds: [60, 300, 900, 3600] })).toEqual({ kind: 'stale' });
    expect(await f.store.claimDueLineupObservations({ leagueKeys: [f.leagueKey], materializationLane: lane,
      workerId: 'new-thin-worker', leaseSeconds: 120, limit: 1, futureLimit: 1, catchUp: true })).toEqual([]);
    const accepted = await f.store.completeLineupObservation({ claim: claim(reserved.state), lineupRevision: LINEUP_C,
      requestStartedAt: at, requestCompletedAt: at, nextCheckAt: new Date(Date.parse(at) + 180_000).toISOString() });
    expect(accepted).toMatchObject({ kind: 'stored', state: { latestLineupRevision: LINEUP_C, activeAttemptId: null } });
  });

  it('requires fresh authority, matching ownership, and the live execution lease', async () => {
    const f = await lineageFixture(database);
    const reserve = (fence = f.fence) => f.store.reserveFullLineupObservation({ fence, modelVersion: 'clock-v1', leaseSeconds: 120 });
    expect(await reserve({ ...f.fence, runId: 'wrong-worker' })).toEqual({ kind: 'stale' });
    expect(await reserve({ ...f.fence, watchGeneration: 2 })).toEqual({ kind: 'stale' });
    await ownerQuery("UPDATE league_period_authorities SET verified_at=now()-interval '11 minutes',source_observed_at=now()-interval '11 minutes' WHERE league_key=$1", [f.leagueKey]);
    expect(await reserve()).toEqual({ kind: 'stale' });
    await ownerQuery('UPDATE league_period_authorities SET verified_at=now(),source_observed_at=now() WHERE league_key=$1', [f.leagueKey]);
    await ownerQuery("UPDATE projection_jobs SET lease_until=now()-interval '1 second' WHERE job_key='live-projection-sync'");
    expect(await reserve()).toEqual({ kind: 'stale' });
  });

  it('caps a future reservation at its materialization lease and rejects its expired attempt', async () => {
    const f = await lineageFixture(database, 'future');
    await ownerQuery("UPDATE league_week_materialization_states SET active_attempt_expires_at=now()+interval '30 seconds' WHERE league_key=$1", [f.leagueKey]);
    const result = await f.store.reserveFullLineupObservation({ fence: f.fence, modelVersion: 'clock-v1', leaseSeconds: 120 });
    if (result.kind !== 'stored') throw new Error('Future reservation failed.');
    const row = (await ownerQuery<{ expires: string }>('SELECT active_attempt_expires_at::text AS expires FROM league_week_materialization_states WHERE league_key=$1', [f.leagueKey]))[0];
    expect(Date.parse(result.state.leaseExpiresAt!)).toBe(Date.parse(row.expires));
    await ownerQuery("UPDATE league_week_materialization_states SET active_attempt_started_at=now()-interval '2 minutes',last_attempted_at=now()-interval '2 minutes',active_attempt_expires_at=now()-interval '1 second' WHERE league_key=$1", [f.leagueKey]);
    expect(await f.store.reserveFullLineupObservation({ fence: f.fence, modelVersion: 'clock-v1', leaseSeconds: 120 })).toEqual({ kind: 'stale' });
  });
});
