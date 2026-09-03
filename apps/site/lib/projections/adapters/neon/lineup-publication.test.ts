import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { createFakeProjectionDatabase, projectionStoreSnapshot } from '../../../projection-store-test-support';
import { createObservationMethods } from './observations';
import { createSnapshotMethods } from './snapshots';
import { createLineupAcknowledgmentMethods } from './lineup-acknowledgment';
import { createMaterializationFutureRefreshMethods } from './future-refresh-materialization';
import { observationLineupValues, publicationFenceJson } from './lineup-publication-values';

const watchId = '11111111-1111-4111-8111-111111111111';
const attemptId = '22222222-2222-4222-8222-222222222222';
const observationId = '33333333-3333-4333-8333-333333333333';
const contentId = '44444444-4444-4444-8444-444444444444';
const at = '2026-09-03T12:00:00.000Z';
const revisionA = 'a'.repeat(64);
const revisionB = 'b'.repeat(64);
const target = { watchId, watchGeneration: 1, authorityGeneration: 2, observedVersion: 3, lineupRevision: revisionA };

describe('official lineup lineage and atomic publication boundaries', () => {
  it('accepts legacy absent lineage but rejects partial or malformed lineage', () => {
    expect(observationLineupValues()).toEqual([null, null]);
    expect(observationLineupValues('lineup-v1', revisionA)).toEqual(['lineup-v1', revisionA]);
    expect(() => observationLineupValues('lineup-v1')).toThrow();
    expect(() => observationLineupValues(undefined, revisionA)).toThrow();
    expect(() => observationLineupValues('lineup-v1', 'invalid')).toThrow();
    expect(() => publicationFenceJson(undefined as never)).toThrow('ownership fence is required');
    expect(() => publicationFenceJson({ watchId, watchGeneration: 0, authorityGeneration: 1, ownerLane: 'current', runId: 'run' })).toThrow();
  });

  it('records lineage outside the existing source revision and requires exact replay equality', async () => {
    const fake = createFakeProjectionDatabase(() => [{ observation_id: observationId, player_points_stored: 0, roster_points_stored: 0, expected_games_stored: 0, unmapped_player_ids: [], unmapped_game_ids: [] }]);
    await createObservationMethods(fake.database).recordLeagueWeekObservation({
      leagueSeasonId: watchId, week: 1, sourceRevision: 'existing-source-revision',
      requestStartedAt: at, requestCompletedAt: at, observedAt: at, quality: 'complete',
      sourceData: {}, expectedTank01GameIds: [], playerPoints: [], rosterPoints: [],
      lineupRevisionVersion: 'lineup-v1', lineupRevision: revisionA,
    });
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].parameters.slice(12)).toEqual(['lineup-v1', revisionA]);
    expect(fake.calls[0].statement).toContain('lineup_revision IS NOT DISTINCT FROM $14::text');
    expect(fake.calls[0].statement).toContain('request_started_at = $4::timestamptz');
  });

  it('puts the ownership guard and unchanged verification provenance inside one publication query', async () => {
    const fake = createFakeProjectionDatabase();
    await createSnapshotMethods(fake.database).publishSnapshot({
      leagueSeasonId: watchId, week: 1, modelVersion: 'clock-v1', revisionKey: 'snapshot',
      leagueWeekObservationId: observationId, gameStateObservationIds: [], calculatedAt: at,
      payload: projectionStoreSnapshot, activityWindows: [],
      lineupFence: { watchId, watchGeneration: 1, authorityGeneration: 2, ownerLane: 'current', runId: 'run' },
    });
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].parameters).toHaveLength(13);
    expect(fake.calls[0].statement).toContain('EXISTS (SELECT 1 FROM publication_lineup_guard)');
    expect(fake.calls[0].statement).toContain('verification_source_observation_id = CASE');
    expect(fake.calls[0].statement).toContain('FOR UPDATE OF authority');
    expect(fake.calls[0].statement).not.toContain('latest_lineup_revision =');
    expect(fake.calls[0].statement).not.toContain('$13::jsonb IS NULL');
    expect(JSON.parse(fake.calls[0].parameters[12] as string)).toEqual({
      watchId, watchGeneration: 1, authorityGeneration: 2, ownerLane: 'current', runId: 'run',
    });
  });

  it('rejects new unfenced publication and unscoped materialization before querying', async () => {
    const fake = createFakeProjectionDatabase();
    await expect(createSnapshotMethods(fake.database).publishSnapshot({
      leagueSeasonId: watchId, week: 1, modelVersion: 'clock-v1', revisionKey: 'snapshot',
      leagueWeekObservationId: observationId, gameStateObservationIds: [], calculatedAt: at,
      payload: projectionStoreSnapshot, activityWindows: [], lineupFence: undefined as never,
    })).rejects.toThrow('ownership fence is required');
    await expect(createMaterializationFutureRefreshMethods(fake.database).beginFutureMaterializationRefresh({
      leagueKey: 'league', projectionProvider: 'tank01', normalizerVersion: 'slate-v1', modelVersion: 'clock-v1',
      period: { season: 2026, seasonType: 'reg', week: 2 }, attemptId,
      attemptedAt: at, leaseSeconds: 60, target: undefined as never,
    })).rejects.toThrow('lineup target is required');
    expect(fake.calls).toHaveLength(0);
  });

  it('keeps the claimed target independent of actual full-source lineage in one atomic completion', async () => {
    const fake = createFakeProjectionDatabase();
    await createLineupAcknowledgmentMethods(fake.database).completeFutureMaterializationAndAcknowledgeLineup({
      leagueKey: 'league', projectionProvider: 'tank01', normalizerVersion: 'slate-v1', modelVersion: 'clock-v1',
      period: { season: 2026, seasonType: 'reg', week: 2 }, attemptId, runId: 'run',
      completedAt: at, nextRefreshAt: '2026-09-03T13:00:00.000Z', target,
      sourceRevision: 'actual-source', lineupRevisionVersion: 'lineup-v1', lineupRevision: revisionB,
      slate: { observationId, contentId }, snapshotRevision: 'actual-snapshot',
    });
    const values = JSON.parse(fake.calls[0].parameters[0] as string);
    expect(values).toMatchObject({ targetLineupRevision: revisionA, lineupRevision: revisionB, observedVersion: 3 });
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].statement).toContain('source.id = current.verification_source_observation_id');
    expect(fake.calls[0].statement).toContain('COALESCE(state.pending_since, state.last_complete_observation_at, now())');
    expect(fake.calls[0].statement).toContain('WHEN acknowledged.pending_since IS NOT NULL THEN now()');
    expect(fake.calls[0].statement).not.toContain('watch.latest_lineup_revision =');
  });

  it('uses database-time leases and keeps newer pending lineups out of old failure backoff', async () => {
    const fake = createFakeProjectionDatabase();
    const methods = createMaterializationFutureRefreshMethods(fake.database);
    const common = { leagueKey: 'league', projectionProvider: 'tank01', normalizerVersion: 'slate-v1', modelVersion: 'clock-v1', period: { season: 2026, seasonType: 'reg' as const, week: 2 }, attemptId };
    await methods.beginFutureMaterializationRefresh({ ...common, attemptedAt: at, leaseSeconds: 60, target });
    await methods.failFutureMaterializationRefresh({ ...common, failedAt: at, failureCode: 'snapshot-rejected' });
    expect(fake.calls[0].statement).toContain('active_attempt_expires_at = now()');
    expect(fake.calls[1].statement).toContain('materialization.active_attempt_expires_at > now()');
    expect(fake.calls[1].statement).toContain("WHEN target.newer_lineup THEN interval '0 seconds'");
    expect(fake.calls[1].statement).not.toContain('active_attempt_expires_at >= $9');
    expect(fake.calls[0].parameters).toHaveLength(12);
    expect(JSON.parse(fake.calls[0].parameters[10] as string)).toEqual(target);
    expect(fake.calls[0].statement).not.toContain('$11::jsonb IS NULL');
    expect(fake.calls[1].statement).toContain('AND watch.id IS NOT NULL');
    expect(fake.calls[1].statement).not.toContain('materialization.active_watch_id IS NULL');
  });
});
