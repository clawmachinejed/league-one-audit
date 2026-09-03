import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { withDatabaseAbortSignal, type Database } from '../lib/database';
import { createProjectionStore } from '../lib/projection-store';
import { createLeagueRegistry } from '../lib/projections/adapters/configuration/league-registry';
import { createNeonJobRepository } from '../lib/projections/adapters/neon/job-repository';
import { createNeonLineupRepository } from '../lib/projections/adapters/neon/lineup-repository';
import { createNeonPeriodAuthorityReader } from '../lib/projections/adapters/neon/period-authority-reader';
import { createSleeperLineupSource } from '../lib/projections/adapters/sleeper/lineup-source';
import { createRawSleeperMatchupLoader } from '../lib/projections/adapters/sleeper/raw-matchups';
import { externalLeagueRef, providerKey } from '../lib/projections/shared/provider-identity';
import type { LineupObservationWorkerDependencies } from '../lib/projections/worker/lineup-contracts';
import { LINEUP_OBSERVATION_JOB_KEY, runLineupObservation } from '../lib/projections/worker/lineup-orchestrator';
import { synchronizeLineupWatches } from '../lib/projections/worker/lineup-watch-context';
import { createIndependentDatabase, ownerQuery, type IndependentDatabase } from './neon-integration-harness';

let connection: IndependentDatabase;
beforeAll(() => { connection = createIndependentDatabase(); });
afterAll(async () => { await connection.close(); });

// Owner-only setup deliberately advances a minute bucket without waiting on the wall clock.
// This file is included only by the sentinel-guarded, serial disposable-database suite.
async function resetCompletedMinuteFixture() {
  await ownerQuery(`UPDATE projection_jobs SET state = 'completed', completed_at = now(),
    scheduled_for = date_trunc('minute', now()) - interval '1 minute', lease_owner = NULL,
    lease_until = NULL WHERE job_key = $1`, [LINEUP_OBSERVATION_JOB_KEY]);
}

describe.sequential('isolated observer worker through canonical Neon adapters', () => {
  it('persists a changed lineup and wakes materialization, then preserves pending and backoff on an unchanged check', async () => {
    const leagueKey = `observer-worker-${randomUUID()}`;
    const sourceId = `official-${randomUUID()}`;
    const projectionSource = providerKey(`fixture-${randomUUID()}`);
    const dbTime = Date.parse((await ownerQuery<{ time: string }>('SELECT now()::text AS time'))[0].time);
    const monotonicStart = performance.now();
    const clock = { now: () => new Date(dbTime + performance.now() - monotonicStart), monotonicNow: () => performance.now() };
    const configuration = { key: leagueKey, displayName: 'Observer integration',
      leagueRef: externalLeagueRef('sleeper', sourceId), matchupWeekRange: { firstWeek: 1, lastWeek: 2 } };
    const registry = createLeagueRegistry([configuration]);
    const markers: string[] = [];
    const database: Database = { enabled: true, query(statement, parameters) {
      const marker = /projection-store:([a-z-]+)/u.exec(statement)?.[1];
      if (marker) markers.push(marker);
      return connection.database.query(statement, parameters);
    } };
    const options = { projectionSource, normalizerVersion: 'fixture-normalizer-v1', modelVersion: 'clock-v1' };
    function scope(db: Database) {
      const store = createProjectionStore(db);
      return { repository: createNeonJobRepository(store), lineupRepository: createNeonLineupRepository(store, registry, options),
        periodAuthorityReader: createNeonPeriodAuthorityReader(store, registry, clock) };
    }
    const store = createProjectionStore(database);
    const authority = await store.upsertLeaguePeriodAuthority({ leagueKey, defaultSeason: 2026, defaultSeasonType: 'reg', defaultWeek: 1,
      activeSeason: 2026, activeSeasonType: 'reg', activeWeek: 1, leagueLifecycle: 'active', nflPhase: 'regular',
      sourceProvider: 'sleeper', sourceRevision: 'observer-fixture-authority', sourceObservedAt: new Date(dbTime).toISOString(),
      verifiedAt: new Date(dbTime).toISOString(), lineupShape: { sourceExternalLeagueId: sourceId,
        expectedRosterCount: 2, expectedStarterSlotCount: 2, expectedRosterIds: ['1', '2'] },
      defaultPeriodCadence: { games: [], isCurrentRegularPeriod: true } });
    expect(authority.kind).toBe('stored');
    const persisted = scope(database);
    const authorityResults = await persisted.periodAuthorityReader.readAuthorities([leagueKey], clock.now(), 600_000);
    expect(authorityResults[0].kind).toBe('present');
    expect((await synchronizeLineupWatches(persisted.lineupRepository, [configuration], authorityResults, clock.now())).kind).toBe('stored');
    // The future bucket may legitimately be up to two minutes away. Make this unique fixture due now.
    await ownerQuery(`UPDATE league_week_lineup_watch_states SET next_check_at = now() - interval '4 minutes'
      WHERE league_key = $1 AND week = 2`, [leagueKey]);
    await resetCompletedMinuteFixture();
    const readJson = vi.fn(async () => [
      { roster_id: 1, matchup_id: 1, starters: ['player-a', '0'], points: 0 },
      { roster_id: 2, matchup_id: 1, starters: ['player-b', '0'], points: 0 },
    ]);
    const raw = createRawSleeperMatchupLoader({ readJson, now: () => clock.now().toISOString() });
    const dependencies: LineupObservationWorkerDependencies = { ...persisted, clock, leagueRegistry: registry,
      idGenerator: { generate: randomUUID }, logger: { write() {} },
      lineupSource: createSleeperLineupSource((id, week, signal) => raw(id, week, 0, signal), clock.now),
      persistence: { scope: (signal) => scope(withDatabaseAbortSignal(database, signal)) } };
    markers.length = 0;
    expect(await runLineupObservation(dependencies)).toMatchObject({ status: 'completed', checked: 1, changed: 1, unchanged: 0, pending: 1, failed: 0 });
    expect(readJson).toHaveBeenCalledExactlyOnceWith(`/league/${sourceId}/matchups/2`, 0, expect.any(AbortSignal));
    const first = (await persisted.lineupRepository.readPendingFutureLineups([leagueKey]))[0];
    expect(first).toMatchObject({ observedVersion: 1, claimGeneration: 1, activeAttemptId: null, leaseOwner: null,
      latestLineupRevision: expect.stringMatching(/^[a-f0-9]{64}$/u), lastMaterializedLineupRevision: null });
    expect(first.pendingSince).not.toBeNull();
    expect(Date.parse(first.nextCheckAt!)).toBeGreaterThan(Date.parse(first.acceptedRequestCompletedAt!));
    expect((await ownerQuery<{ due: boolean; version: string }>(`SELECT m.next_refresh_at <= now() AS due,
      w.materialization_woken_version::text AS version FROM league_week_materialization_states m
      JOIN league_week_lineup_watch_states w ON w.league_key = m.league_key AND w.week = m.week
      WHERE m.league_key = $1 AND m.week = 2`, [leagueKey]))[0]).toEqual({ due: true, version: '1' });
    expect((await ownerQuery<{ count: number }>('SELECT count(*)::integer AS count FROM projection_period_refresh_states WHERE projection_provider = $1', [projectionSource]))[0].count).toBe(0);
    expect(markers).toEqual(expect.arrayContaining(['acquire-job', 'claim-due-lineup-observations', 'accept-lineup-observation',
      'wake-future-projection-and-materialization', 'complete-job']));
    expect(markers.some((marker) => /publish-snapshot|record-projection|record-league-week|freeze-baseline/u.test(marker))).toBe(false);
    await ownerQuery(`UPDATE league_week_lineup_watch_states SET next_check_at = now() - interval '4 minutes' WHERE id = $1`, [first.watchId]);
    await ownerQuery(`UPDATE league_week_materialization_states SET next_refresh_at = now() + interval '1 hour' WHERE league_key = $1`, [leagueKey]);
    await resetCompletedMinuteFixture();
    markers.length = 0;
    expect(await runLineupObservation(dependencies)).toMatchObject({ status: 'completed', checked: 1, changed: 0, unchanged: 1, pending: 1, failed: 0 });
    expect(readJson).toHaveBeenCalledTimes(2);
    const second = (await persisted.lineupRepository.readPendingFutureLineups([leagueKey]))[0];
    expect(second).toMatchObject({ latestLineupRevision: first.latestLineupRevision, observedVersion: 1, claimGeneration: 2,
      pendingSince: first.pendingSince, activeAttemptId: null, leaseOwner: null, consecutiveFailures: 0 });
    expect(Date.parse(second.acceptedRequestCompletedAt!)).toBeGreaterThan(Date.parse(first.acceptedRequestCompletedAt!));
    expect(Date.parse(second.nextCheckAt!)).toBeGreaterThan(Date.parse(second.acceptedRequestCompletedAt!));
    expect(markers).not.toContain('wake-future-projection-and-materialization');
    expect((await ownerQuery<{ backed_off: boolean }>(`SELECT next_refresh_at > now() + interval '50 minutes' AS backed_off
      FROM league_week_materialization_states WHERE league_key = $1`, [leagueKey]))[0].backed_off).toBe(true);
    expect((await ownerQuery<{ state: string; attempt_count: number }>('SELECT state, attempt_count FROM projection_jobs WHERE job_key = $1', [LINEUP_OBSERVATION_JOB_KEY]))[0])
      .toMatchObject({ state: 'completed', attempt_count: expect.any(Number) });
  });
});
