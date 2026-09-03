import { randomUUID } from 'node:crypto';
import { createProjectionStore, type PersistenceOutcome } from '../lib/projection-store';
import type { StoreLineupPublicationFence } from '../lib/projections/adapters/neon/lineup-publication-contracts';
import { ownerQuery, type IndependentDatabase } from './neon-integration-harness';

export const LINEUP_A = 'a'.repeat(64);
export const LINEUP_B = 'b'.repeat(64);
export const LINEUP_C = 'c'.repeat(64);
export function stored<Value>(result: PersistenceOutcome<Value>): Value {
  if (result.kind !== 'stored') throw new Error('Isolated runtime database was disabled.');
  return result.value;
}
export async function databaseTime(): Promise<string> {
  return (await ownerQuery<{ at: string }>('SELECT clock_timestamp()::text AS at'))[0].at;
}

export async function lineageFixture(database: IndependentDatabase, lane: 'current' | 'future' = 'current') {
  const store = createProjectionStore(database.database);
  const leagueKey = `lineage-${randomUUID()}`;
  const externalLeagueId = `source-${leagueKey}`;
  const runId = randomUUID();
  const watchId = randomUUID();
  const attemptId = randomUUID();
  const week = lane === 'current' ? 1 : 2;
  const period = { season: 2026, seasonType: 'reg' as const, week };
  const normalizerVersion = `lineage-slate-${randomUUID()}`;
  const league = stored(await store.registerLeagueSeason({ leagueKey, leagueName: 'Isolated lineage fixture', season: 2026, sleeperLeagueId: externalLeagueId, scoringRules: { pass_td: 4 } }));
  await ownerQuery(`INSERT INTO league_period_authorities
    (league_key, default_season, default_season_type, default_week, active_season,
    active_season_type, active_week, league_lifecycle, nfl_phase, source_provider,
    source_revision, source_observed_at, verified_at, source_external_league_id,
    expected_roster_count, expected_starter_slot_count, expected_roster_ids)
    VALUES ($1, 2026, 'reg', 1, 2026, 'reg', 1, 'active', 'regular', 'sleeper',
      'authority-1', now(), now(), $2, 2, 1, ARRAY['1','2'])`, [leagueKey, externalLeagueId]);
  await ownerQuery(`INSERT INTO league_week_lineup_watch_states
    (id, league_key, source_provider, external_league_id, season, season_type, week,
    lineup_revision_version, cadence_policy_version, authority_generation, watch_class,
    materialization_lane, phase, expected_roster_count, expected_starter_slot_count,
    expected_roster_ids, next_check_at, observed_version, latest_lineup_revision,
    accepted_request_started_at, accepted_request_completed_at, last_complete_observation_at, pending_since)
    VALUES ($1, $2, 'sleeper', $3, 2026, 'reg', $4, 'lineup-v1', 'lineup-cadence-v1', 1,
      $5, $5, 0, 2, 1, ARRAY['1','2'], now(), 1, $6, now(), now(), now(), now())`,
  [watchId, leagueKey, externalLeagueId, week, lane, LINEUP_B]);
  const jobKey = lane === 'current' ? 'live-projection-sync' : 'future-projection-sync';
  await ownerQuery(`INSERT INTO projection_jobs
    (job_key, job_type, scheduled_for, state, lease_owner, lease_until)
    VALUES ($1, $1, now(), 'running', $2, now() + interval '5 minutes')
    ON CONFLICT (job_key) DO UPDATE SET state = 'running', lease_owner = $2,
      lease_until = now() + interval '5 minutes'`, [jobKey, runId]);
  const target = { watchId, watchGeneration: 1, authorityGeneration: 1, observedVersion: 1, lineupRevision: LINEUP_B };
  const fence: StoreLineupPublicationFence = lane === 'current'
    ? { watchId, watchGeneration: 1, authorityGeneration: 1, ownerLane: 'current', runId }
    : { watchId, watchGeneration: 1, authorityGeneration: 1, ownerLane: 'future', runId,
      materializationAttemptId: attemptId, projectionProvider: 'tank01', normalizerVersion };
  let slate: { observationId: string; contentId: string } | undefined;
  if (lane === 'future') {
    await store.ensureFutureRefreshStates({ projectionProvider: 'tank01', normalizerVersion,
      modelVersion: 'clock-v1', leagueKeys: [leagueKey], targets: [{ period, weekDistance: 1 }],
      seededAt: await databaseTime() });
    const at = await databaseTime();
    const result = stored(await store.recordProjectionSlate({ provider: 'tank01', ...period,
      normalizerVersion, sourceRevision: randomUUID(), requestStartedAt: at, requestCompletedAt: at,
      observedAt: at, quality: 'complete', coverage: {}, warnings: [], entries: [] }));
    slate = { observationId: result.observationId, contentId: result.contentId };
    const claim = await store.beginFutureMaterializationRefresh({ leagueKey, projectionProvider: 'tank01',
      normalizerVersion, modelVersion: 'clock-v1', period, attemptId, attemptedAt: at, leaseSeconds: 120, target });
    if (claim.kind !== 'acquired') throw new Error(`Lineage fixture could not claim materialization: ${claim.kind}`);
  }
  const observe = async (lineupRevision = LINEUP_B, sourceRevision = randomUUID()) => {
    const at = await databaseTime();
    const input = { leagueSeasonId: league.leagueSeasonId, week, sourceRevision,
      requestStartedAt: at, requestCompletedAt: at, observedAt: at, quality: 'complete' as const,
      sourceData: {}, expectedTank01GameIds: [], playerPoints: [], rosterPoints: [],
      lineupRevisionVersion: 'lineup-v1', lineupRevision };
    return { input, value: stored(await store.recordLeagueWeekObservation(input)) };
  };
  const publish = async (observation: Awaited<ReturnType<typeof observe>>, overrideFence: StoreLineupPublicationFence = fence) => {
    const payload = { league: { season: '2026', rosterPositions: ['QB'], week, maxWeek: 18 }, teams: [],
      updatedAt: observation.input.observedAt, week, matchups: [] };
    return store.publishSnapshot({ leagueSeasonId: league.leagueSeasonId, week, modelVersion: 'clock-v1',
      revisionKey: randomUUID(), leagueWeekObservationId: observation.value.observationId,
      gameStateObservationIds: [], calculatedAt: observation.input.observedAt, payload, activityWindows: [],
      lineupFence: overrideFence });
  };
  const acknowledgeInput = (observation: Awaited<ReturnType<typeof observe>>, snapshotRevision: string) => ({
    leagueKey, period, modelVersion: 'clock-v1', sourceRevision: observation.input.sourceRevision,
    lineupRevisionVersion: 'lineup-v1', lineupRevision: observation.input.lineupRevision, snapshotRevision,
  });
  const fullAckInput = async (observation: Awaited<ReturnType<typeof observe>>, snapshotRevision: string) => ({
    ...acknowledgeInput(observation, snapshotRevision), projectionProvider: 'tank01', normalizerVersion,
    attemptId, runId, target, slate: slate!, completedAt: await databaseTime(),
    nextRefreshAt: new Date(Date.now() + 3600_000).toISOString(),
  });
  const acceptWatch = async (revision: string) => ownerQuery(`UPDATE league_week_lineup_watch_states SET
    observed_version = observed_version + 1, latest_lineup_revision = $2,
    accepted_request_started_at = now(), accepted_request_completed_at = now(), last_complete_observation_at = now(),
    pending_since = CASE WHEN $2 = last_materialized_lineup_revision THEN NULL
      ELSE COALESCE(pending_since, now()) END WHERE id = $1`, [watchId, revision]);
  return { store, leagueKey, league, watchId, period, fence, target, runId, attemptId, normalizerVersion,
    observe, publish, acknowledgeInput, fullAckInput, acceptWatch };
}
