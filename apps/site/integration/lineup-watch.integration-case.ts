import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { LineupObservationClaim, LineupWatchTarget, StoredLineupWatchState } from '../lib/projections/adapters/neon/lineup-watch-contracts';
import { createLineupWatchSyncMethods } from '../lib/projections/adapters/neon/lineup-watch-sync';
import { createLineupWatchClaimMethods } from '../lib/projections/adapters/neon/lineup-watch-claims';
import { createLineupWatchObservationMethods } from '../lib/projections/adapters/neon/lineup-watch-observations';
import { createLineupWatchReadMethods } from '../lib/projections/adapters/neon/lineup-watch-read';
import { createIndependentDatabase, integrationEnvironment, ownerQuery, runtimeQuery, type IndependentDatabase } from './neon-integration-harness';

let first: IndependentDatabase;
let second: IndependentDatabase;
beforeAll(() => { first = createIndependentDatabase(); second = createIndependentDatabase(); });
afterAll(async () => { await Promise.all([first.close(), second.close()]); });

async function registryKeys() {
  return (await ownerQuery<{ league_key: string }>('SELECT league_key FROM league_period_authorities')).map((row) => row.league_key);
}
async function fixture() {
  const leagueKey = `watch-integration-${randomUUID()}`;
  const clock = (await ownerQuery<{ time: string }>('SELECT now()::text AS time'))[0].time;
  await ownerQuery(`INSERT INTO league_period_authorities (
    league_key, default_season, default_season_type, default_week, league_lifecycle, nfl_phase,
    source_provider, source_revision, source_observed_at, verified_at,
    source_external_league_id, expected_roster_count, expected_starter_slot_count, expected_roster_ids
  ) VALUES ($1,2026,'reg',1,'preseason','preseason','sleeper','fixture',$2,$2,'opaque-fixture',2,1,ARRAY['roster-a','roster-b'])`, [leagueKey, clock]);
  const target: LineupWatchTarget = {
    leagueKey, sourceProvider: 'sleeper', externalLeagueId: 'opaque-fixture', period: { season: 2026, seasonType: 'reg', week: 1 },
    lineupRevisionVersion: 'lineup-v1', cadencePolicyVersion: 'lineup-cadence-v1', authorityGeneration: 1,
    watchClass: 'current', materializationLane: 'future', phase: 0, expectedRosterCount: 2, expectedStarterSlotCount: 1,
    expectedRosterIds: ['roster-a', 'roster-b'], initialNextCheckAt: clock,
  };
  const outcome = await createLineupWatchSyncMethods(first.database).synchronizeLineupWatchStates({ registeredLeagueKeys: await registryKeys(), targets: [target] });
  if (outcome.kind !== 'stored' || outcome.states.length !== 1) throw new Error('Watch fixture was not inserted.');
  return { target, state: outcome.states[0], clock };
}
function fence(state: StoredLineupWatchState) {
  if (state.watchClass === 'completed' || state.materializationLane === null) throw new Error('Retired fixture.');
  return { watchId: state.id, watchGeneration: state.watchGeneration, authorityGeneration: state.authorityGeneration,
    watchClass: state.watchClass, materializationLane: state.materializationLane };
}
function claim(state: StoredLineupWatchState): LineupObservationClaim {
  if (!state.activeAttemptId || !state.leaseOwner) throw new Error('Fixture was not claimed.');
  return { ...fence(state), attemptId: state.activeAttemptId, claimGeneration: state.claimGeneration,
    workerId: state.leaseOwner, targetObservedVersion: state.observedVersion };
}
async function take(state: StoredLineupWatchState, database = first.database) {
  return createLineupWatchClaimMethods(database).claimDueLineupObservations({ leagueKeys: [state.leagueKey], materializationLane: 'future', workerId: randomUUID(), leaseSeconds: 120, limit: 20, futureLimit: 18, catchUp: true });
}
function times(base: string, offset: number) {
  const instant = Date.parse(base) + offset;
  return { requestStartedAt: new Date(instant).toISOString(), requestCompletedAt: new Date(instant + 1).toISOString(), nextCheckAt: new Date(instant + 60_000).toISOString() };
}
async function full(state: StoredLineupWatchState, base: string, offset: number, revision: string) {
  return createLineupWatchObservationMethods(first.database).supersedeLineupClaimWithFullObservation({ fence: fence(state), lineupRevision: revision.repeat(64), ...times(base, offset) });
}

describe.sequential('isolated durable lineup watch coordination', () => {
  it('retains scoped planning identities during stale authority without enabling claims or pending work', async () => {
    const { state } = await fixture();
    await ownerQuery(`UPDATE league_period_authorities SET source_observed_at = now() - interval '1 hour',
      verified_at = now() - interval '1 hour' WHERE league_key = $1`, [state.leagueKey]);
    const reader = createLineupWatchReadMethods(first.database);
    expect(await reader.readLineupWatchSchedule([state.leagueKey])).toEqual([{
      leagueKey: state.leagueKey, sourceProvider: state.sourceProvider, externalLeagueId: state.externalLeagueId,
      period: state.period, phase: state.phase, watchClass: state.watchClass,
    }]);
    expect(await reader.readLineupWatchStates([state.leagueKey])).toEqual([]);
    expect(await reader.readPendingFutureLineups([state.leagueKey])).toEqual([]);
    expect(await take(state)).toEqual([]);
    expect(await reader.readLineupWatchSchedule(['unregistered-fixture'])).toEqual([]);
    await ownerQuery(`UPDATE league_week_lineup_watch_states SET retired_at = now(), retirement_reason = 'league-removed',
      next_check_at = NULL, materialization_lane = NULL WHERE id = $1`, [state.id]);
    expect(await reader.readLineupWatchSchedule([state.leagueKey])).toEqual([]);
  });
  it('allows only one independent client to claim the same due target', async () => {
    const { state } = await fixture();
    const results = await Promise.all([take(state), take(state, second.database)]);
    expect(results[0].length + results[1].length).toBe(1);
    const winner = [...results[0], ...results[1]][0];
    expect(winner.claimGeneration).toBe(1);
    expect(Date.parse(winner.leaseExpiresAt!) - Date.parse(winner.attemptStartedAt!)).toBe(120_000);
  });
  it('rechecks a newly active lease after waiting on an authority lock with an older statement snapshot', async () => {
    const { state } = await fixture();
    const blocker = createIndependentDatabase(integrationEnvironment().ownerDatabaseUrl);
    let pending: Promise<readonly StoredLineupWatchState[]>[] = [];
    try {
      await blocker.database.query('BEGIN');
      await blocker.database.query('SELECT league_key FROM league_period_authorities WHERE league_key = $1 FOR UPDATE', [state.leagueKey]);
      pending = [take(state), take(state, second.database)];
      let blocked = 0;
      for (let tries = 0; tries < 30 && blocked < 2; tries += 1) {
        await blocker.database.query('SELECT pg_stat_clear_snapshot(), pg_sleep(0.02)');
        blocked = Number((await blocker.database.query<{ count: string }>(`SELECT count(*)::text AS count FROM pg_stat_activity
          WHERE wait_event_type = 'Lock' AND query LIKE '%projection-store:claim-due-lineup-observations%'`))[0].count);
      }
      expect(blocked).toBe(2);
      await blocker.database.query(`UPDATE league_week_lineup_watch_states SET active_attempt_id = gen_random_uuid(),
        claim_generation = claim_generation + 1, attempt_count = attempt_count + 1, lease_owner = 'other-worker',
        attempt_started_at = now(), lease_expires_at = now() + interval '120 seconds' WHERE id = $1`, [state.id]);
      await blocker.database.query('COMMIT');
      expect(await Promise.all(pending)).toEqual([[], []]);
    } finally {
      await blocker.database.query('ROLLBACK');
      await Promise.allSettled(pending);
      await blocker.close();
    }
  });
  it('rejects a same-count foreign authoritative roster set', async () => {
    const { state, target } = await fixture();
    const result = await createLineupWatchSyncMethods(first.database).synchronizeLineupWatchStates({
      registeredLeagueKeys: await registryKeys(), targets: [{ ...target, expectedRosterIds: ['roster-a', 'foreign-roster'] }],
    });
    expect(result).toEqual({ kind: 'stored', states: [] });
    expect((await createLineupWatchReadMethods(first.database).readLineupWatchStates([state.leagueKey]))[0].expectedRosterIds).toEqual(['roster-a', 'roster-b']);
  });
  it('preserves state and phases across duplicate synchronization and ignores unhealthy omitted authorities', async () => {
    const { target, state, clock } = await fixture();
    await full(state, clock, 10, 'a');
    const sync = createLineupWatchSyncMethods(first.database);
    const repeated = await sync.synchronizeLineupWatchStates({ registeredLeagueKeys: await registryKeys(), targets: [target] });
    expect(repeated.kind === 'stored' && repeated.states[0].id).toBe(state.id);
    await sync.synchronizeLineupWatchStates({ registeredLeagueKeys: await registryKeys(), targets: [] });
    expect((await createLineupWatchReadMethods(first.database).readLineupWatchStates([target.leagueKey]))[0].latestLineupRevision).toBe('a'.repeat(64));
  });
  it('advances request ordering without incrementing semantic version for an unchanged revision', async () => {
    const { state, clock } = await fixture();
    const a = await full(state, clock, 10, 'a');
    const repeated = await full(state, clock, 20, 'a');
    expect(a.kind === 'stored' && a.state.observedVersion).toBe(1);
    expect(repeated.kind === 'stored' && repeated.state.observedVersion).toBe(1);
    expect(repeated.kind === 'stored' && repeated.state.pendingSince).toBe(a.kind === 'stored' && a.state.pendingSince);
    expect(await full(state, clock, 15, 'b')).toEqual({ kind: 'stale' });
  });
  it('rejects older request starts even when their responses complete later', async () => {
    const { state, clock } = await fixture();
    await full(state, clock, 1000, 'a');
    const stale = await createLineupWatchObservationMethods(first.database).supersedeLineupClaimWithFullObservation({
      fence: fence(state), lineupRevision: 'b'.repeat(64), requestStartedAt: times(clock, 500).requestStartedAt,
      requestCompletedAt: times(clock, 2000).requestCompletedAt, nextCheckAt: times(clock, 2000).nextCheckAt,
    });
    expect(stale).toEqual({ kind: 'stale' });
  });
  it('full loading supersedes an older thin claim and its later failure cannot back off', async () => {
    const { state } = await fixture();
    const active = (await take(state))[0];
    const accepted = await full(state, active.attemptStartedAt!, 10, 'a');
    expect(accepted.kind === 'stored' && accepted.state.activeAttemptId).toBeNull();
    expect(await createLineupWatchObservationMethods(first.database).failLineupObservation({ claim: claim(active), failureCode: 'provider-unavailable', retryDelaysSeconds: [60, 300, 900, 3600] })).toEqual({ kind: 'stale' });
  });
  it('not-ready is healthy and preserves the prior accepted pending revision', async () => {
    const { state, clock } = await fixture();
    await full(state, clock, 1, 'a');
    await ownerQuery('UPDATE league_week_lineup_watch_states SET next_check_at = now() WHERE id = $1', [state.id]);
    const active = (await take(state))[0];
    expect(await createLineupWatchObservationMethods(first.database).recordLineupObservationNotReady({ claim: claim(active), checkedAt: times(clock, 100).requestCompletedAt, nextCheckAt: times(clock, 100).nextCheckAt })).toEqual({ kind: 'stored' });
    const selected = (await createLineupWatchReadMethods(first.database).readPendingFutureLineups([state.leagueKey]))[0];
    expect(selected.latestLineupRevision).toBe('a'.repeat(64));
    expect(selected.observedVersion).toBe(1);
    expect(selected.consecutiveFailures).toBe(0);
  });
  it('A to B to A clears pending when A was already materialized', async () => {
    const { state, clock } = await fixture();
    await full(state, clock, 1, 'a');
    await ownerQuery(`UPDATE league_week_lineup_watch_states SET
      last_materialized_lineup_revision = $2, last_materialized_snapshot_revision = 'fixture-snapshot',
      last_materialized_verified_at = now(), pending_since = NULL WHERE id = $1`, [state.id, 'a'.repeat(64)]);
    const b = await full(state, clock, 2, 'b');
    const a = await full(state, clock, 3, 'a');
    expect(b.kind === 'stored' && b.state.pendingSince).not.toBeNull();
    expect(a.kind === 'stored' && a.state.pendingSince).toBeNull();
    expect(a.kind === 'stored' && a.state.observedVersion).toBe(3);
  });
  it('a wake atomically creates both prerequisites and does not reset a repeated-version backoff', async () => {
    const { state, clock } = await fixture();
    await full(state, clock, 1, 'a');
    const wake = { watchId: state.id, watchGeneration: 1, authorityGeneration: 1, projectionProvider: `fixture-${randomUUID()}`, normalizerVersion: 'normalizer-v1', modelVersion: 'clock-v1', weekDistance: 1, wakeProjection: true };
    const methods = createLineupWatchReadMethods(first.database);
    expect(await methods.wakeFutureProjectionAndMaterialization(wake)).toEqual({ kind: 'stored' });
    await ownerQuery(`UPDATE league_week_materialization_states SET next_refresh_at = now() + interval '1 hour' WHERE league_key = $1`, [state.leagueKey]);
    await ownerQuery(`UPDATE projection_period_refresh_states SET next_refresh_at = now() + interval '1 hour' WHERE projection_provider = $1`, [wake.projectionProvider]);
    await methods.wakeFutureProjectionAndMaterialization(wake);
    const before = await ownerQuery<{ material: boolean; projection: boolean }>(`SELECT
      (SELECT next_refresh_at > now() + interval '50 minutes' FROM league_week_materialization_states WHERE league_key = $1) material,
      (SELECT next_refresh_at > now() + interval '50 minutes' FROM projection_period_refresh_states WHERE projection_provider = $2) projection`, [state.leagueKey, wake.projectionProvider]);
    expect(before[0]).toEqual({ material: true, projection: true });
    await full(state, clock, 2, 'b');
    await methods.wakeFutureProjectionAndMaterialization(wake);
    expect((await ownerQuery<{ due: boolean }>('SELECT next_refresh_at <= now() AS due FROM league_week_materialization_states WHERE league_key = $1', [state.leagueKey]))[0].due).toBe(true);
  });
  it('reclaims expired observation leases and rejects the old generation', async () => {
    const { state, clock } = await fixture();
    const old = (await take(state))[0];
    await ownerQuery(`UPDATE league_week_lineup_watch_states SET attempt_started_at = now() - interval '3 minutes', lease_expires_at = now() - interval '1 minute' WHERE id = $1`, [state.id]);
    const fresh = (await take(state))[0];
    expect(fresh.claimGeneration).toBe(old.claimGeneration + 1);
    expect(await createLineupWatchObservationMethods(first.database).completeLineupObservation({ claim: claim(old), lineupRevision: 'a'.repeat(64), ...times(clock, 1) })).toEqual({ kind: 'stale' });
  });
  it('failure retry uses database time and the bounded retry schedule', async () => {
    const { state } = await fixture();
    for (const [index, delay] of [60, 300, 900, 3600, 3600].entries()) {
      await ownerQuery('UPDATE league_week_lineup_watch_states SET next_check_at = now() WHERE id = $1', [state.id]);
      const active = (await take(state))[0];
      expect(await createLineupWatchObservationMethods(first.database).failLineupObservation({ claim: claim(active), failureCode: 'provider-unavailable', retryDelaysSeconds: [60, 300, 900, 3600] })).toEqual({ kind: 'stored' });
      const result = (await ownerQuery<{ failures: number; delay: string }>(`SELECT consecutive_failures AS failures,
        extract(epoch FROM next_check_at - now())::text AS delay FROM league_week_lineup_watch_states WHERE id = $1`, [state.id]))[0];
      expect(result.failures).toBe(index + 1);
      expect(Number(result.delay)).toBeGreaterThan(delay - 10);
      expect(Number(result.delay)).toBeLessThanOrEqual(delay);
    }
  });
  it('a failure cannot postpone a newer accepted revision when its observation lease still exists', async () => {
    const { state, clock } = await fixture();
    await full(state, clock, -2000, 'a');
    await ownerQuery('UPDATE league_week_lineup_watch_states SET next_check_at = now() WHERE id = $1', [state.id]);
    const active = (await take(state))[0];
    // The full request started before the thin claim but finished after it: keep that newer thin claim.
    const accepted = await full(state, clock, -1000, 'b');
    expect(accepted.kind === 'stored' && accepted.state.activeAttemptId).toBe(active.activeAttemptId);
    await createLineupWatchObservationMethods(first.database).failLineupObservation({ claim: claim(active), failureCode: 'provider-unavailable', retryDelaysSeconds: [60, 300, 900, 3600] });
    const result = (await createLineupWatchReadMethods(first.database).readLineupWatchStates([state.leagueKey]))[0];
    expect(result.consecutiveFailures).toBe(0);
    expect(result.activeAttemptId).toBeNull();
    expect(result.nextCheckAt).toBe(accepted.kind === 'stored' && accepted.state.nextCheckAt);
    expect(result.latestLineupRevision).toBe('b'.repeat(64));
  });
  it('rollover changes ownership generation and invalidates the prior observer', async () => {
    const { state, target, clock } = await fixture();
    const old = (await take(state))[0];
    await ownerQuery(`UPDATE league_period_authorities SET authority_generation = authority_generation + 1 WHERE league_key = $1`, [state.leagueKey]);
    const result = await createLineupWatchSyncMethods(first.database).synchronizeLineupWatchStates({ registeredLeagueKeys: await registryKeys(), targets: [{ ...target, authorityGeneration: 2, materializationLane: 'current' }] });
    expect(result.kind === 'stored' && result.states[0].watchGeneration).toBe(2);
    expect(result.kind === 'stored' && result.states[0].activeAttemptId).toBeNull();
    expect(await createLineupWatchObservationMethods(first.database).completeLineupObservation({ claim: claim(old), lineupRevision: 'a'.repeat(64), ...times(clock, 1) })).toEqual({ kind: 'stale' });
  });
  it('source replacement retires the old immutable row and inserts one active replacement', async () => {
    const { state, target } = await fixture();
    await ownerQuery(`UPDATE league_period_authorities SET source_external_league_id = 'replacement-fixture', authority_generation = authority_generation + 1 WHERE league_key = $1`, [state.leagueKey]);
    const result = await createLineupWatchSyncMethods(first.database).synchronizeLineupWatchStates({ registeredLeagueKeys: await registryKeys(), targets: [{ ...target, externalLeagueId: 'replacement-fixture', authorityGeneration: 2 }] });
    expect(result.kind === 'stored' && result.states[0].id).not.toBe(state.id);
    const rows = await ownerQuery<{ retirement_reason: string; active: boolean }>('SELECT retirement_reason, retired_at IS NULL AS active FROM league_week_lineup_watch_states WHERE league_key = $1', [state.leagueKey]);
    expect(rows.filter((row) => row.active)).toHaveLength(1);
    expect(rows.find((row) => !row.active)?.retirement_reason).toBe('source-replaced');
    await expect(runtimeQuery('UPDATE league_week_lineup_watch_states SET next_check_at = now() WHERE id = $1', [state.id])).rejects.toThrow();
  });
  it('retirement removes completed rows from due, pending and wake selectors', async () => {
    const { state, target, clock } = await fixture();
    await full(state, clock, 1, 'a');
    await createLineupWatchSyncMethods(first.database).synchronizeLineupWatchStates({ registeredLeagueKeys: await registryKeys(), targets: [{ ...target, watchClass: 'completed', materializationLane: null, initialNextCheckAt: null }] });
    expect(await take(state)).toEqual([]);
    expect(await createLineupWatchReadMethods(first.database).readPendingFutureLineups([state.leagueKey])).toEqual([]);
  });
  it('database rejects incomplete shape and runtime deletion or DDL', async () => {
    const { state } = await fixture();
    await expect(ownerQuery('UPDATE league_period_authorities SET expected_roster_count = NULL WHERE league_key = $1', [state.leagueKey])).rejects.toThrow();
    await expect(ownerQuery(`UPDATE league_week_lineup_watch_states SET expected_roster_ids = ARRAY['roster-a','roster-a'] WHERE id = $1`, [state.id])).rejects.toThrow();
    await expect(runtimeQuery('DELETE FROM league_week_lineup_watch_states WHERE id = $1', [state.id])).rejects.toThrow();
    await expect(runtimeQuery('TRUNCATE league_week_lineup_watch_states')).rejects.toThrow();
    await expect(runtimeQuery('ALTER TABLE league_week_lineup_watch_states ADD COLUMN forbidden integer')).rejects.toThrow();
    await expect(runtimeQuery('CREATE FUNCTION forbidden_lineup_function() RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$')).rejects.toThrow();
    const denied = await runtimeQuery<{ denied: boolean }>(`SELECT NOT has_table_privilege(current_user,'league_week_lineup_watch_states','REFERENCES')
      AND NOT has_table_privilege(current_user,'league_week_lineup_watch_states','TRIGGER') AS denied`);
    expect(denied[0].denied).toBe(true);
  });
});
