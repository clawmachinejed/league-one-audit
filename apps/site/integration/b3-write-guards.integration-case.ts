import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createProjectionStore, type ProjectionStore } from '../lib/projection-store';
import { lineageFixture, stored } from './lineup-lineage-fixture';
import {
  createIndependentDatabase,
  ownerQuery,
  runtimeQuery,
  type IndependentDatabase,
} from './neon-integration-harness';

const at = '2026-09-03T12:00:00.000Z';

function only<Value>(rows: readonly Value[]): Value {
  expect(rows).toHaveLength(1);
  return rows[0];
}

/** Each attempted mutation is rolled back even when a regression unexpectedly permits it. */
async function denied(statement: string, parameters: readonly unknown[]): Promise<void> {
  const connection = createIndependentDatabase();
  try {
    await connection.database.query('BEGIN');
    await expect(connection.database.query(statement, parameters))
      .rejects.toThrow(/immutable|protected|permission|lineage|foreign key/iu);
  } finally {
    try {
      await connection.database.query('ROLLBACK');
    } finally {
      await connection.close();
    }
  }
}

describe.sequential('B3 compatible writes and immutable guards in the isolated database', () => {
  let database: IndependentDatabase;
  let store: ProjectionStore;

  beforeAll(() => {
    database = createIndependentDatabase();
    store = createProjectionStore(database.database);
  });

  afterAll(async () => { await database.close(); });

  async function runFixture() {
    const sourceRevision = `b3-run-${randomUUID()}`;
    const slateInput = {
      provider: 'tank01', season: 2026, seasonType: 'reg' as const, week: 16,
      normalizerVersion: `b3-${randomUUID()}`, sourceRevision,
      requestStartedAt: at, requestCompletedAt: at, observedAt: at,
      quality: 'complete' as const, coverage: {}, warnings: [], entries: [],
    };
    const slate = stored(await store.recordProjectionSlate(slateInput));
    const input = {
      provider: 'tank01', season: 2026, seasonType: 'reg' as const, week: 16,
      modelVersion: 'b3-test-v1', sourceRevision,
      requestStartedAt: at, requestCompletedAt: at, fetchedAt: at,
      quality: 'complete' as const, candidates: [],
    };
    const run = stored(await store.recordProjectionCandidates(input));
    return { input, run, slate, slateInput };
  }

  it('registers new leagues concurrently with one canonical scoring profile and stable season identities', async () => {
    const suffix = randomUUID();
    const connections = Array.from({ length: 6 }, () => createIndependentDatabase());
    const input = {
      leagueKey: `b3-concurrent-${suffix}`, leagueName: 'B3 synthetic concurrent league',
      season: 2026, sleeperLeagueId: `b3-source-${suffix}`,
      scoringRules: { pass_td: 4, pass_yd: 0.0400319 },
    };
    try {
      const results = await Promise.all(connections.map(async (connection, index) => {
        const second = index >= 3;
        return stored(await createProjectionStore(connection.database).registerLeagueSeason({
          ...input,
          leagueKey: second ? `${input.leagueKey}-two` : input.leagueKey,
          sleeperLeagueId: second ? `${input.sleeperLeagueId}-two` : input.sleeperLeagueId,
        }));
      }));
      expect(new Set(results.map((result) => result.scoringProfileId)).size).toBe(1);
      expect(new Set(results.slice(0, 3).map((result) => result.leagueSeasonId)).size).toBe(1);
      expect(new Set(results.slice(3).map((result) => result.leagueSeasonId)).size).toBe(1);
      expect(results[0].leagueSeasonId).not.toBe(results[3].leagueSeasonId);
      expect(stored(await store.registerLeagueSeason({ ...input, leagueName: 'B3 renamed league' })))
        .toEqual(results[0]);
      expect(only(await runtimeQuery<{ name: string }>(
        'SELECT name FROM leagues WHERE id = $1', [results[0].leagueId],
      )).name).toBe('B3 renamed league');
    } finally {
      await Promise.all(connections.map((connection) => connection.close()));
    }
  });

  it('records and replays one game observation concurrently without rewriting source history', async () => {
    const externalGameId = `b3-game-${randomUUID()}`;
    const game = only(stored(await store.upsertNflGames([{
      key: externalGameId, provider: 'tank01', externalGameId,
      season: 2028, seasonType: 'reg', week: 17, homeTeam: 'IND', awayTeam: 'HOU',
      kickoffAt: '2028-12-31T17:00:00.000Z',
    }])));
    const input = { provider: 'tank01', states: [{
      externalGameId, sourceRevision: `b3-observation-${randomUUID()}`,
      requestStartedAt: at, requestCompletedAt: at, observedAt: at,
      statusCode: 0 as const, period: null, gameClock: null,
      homeScore: null, awayScore: null, sourceData: { immutable: 'original' },
    }] };
    const connections = Array.from({ length: 4 }, () => createIndependentDatabase());
    try {
      const results = await Promise.all(connections.map(async (connection) => (
        only(stored(await createProjectionStore(connection.database).recordGameStates(input)))
      )));
      expect(new Set(results.map((result) => result.observationId)).size).toBe(1);
      const replay = stored(await store.recordGameStates({
        ...input, states: [{ ...input.states[0], sourceData: { immutable: 'replacement' } }],
      }));
      expect(replay).toEqual([]);
      expect(only(await runtimeQuery<{ source_data: unknown }>(`
        SELECT source_data FROM game_state_observations WHERE nfl_game_id = $1
      `, [game.gameId])).source_data).toEqual({ immutable: 'original' });
    } finally {
      await Promise.all(connections.map((connection) => connection.close()));
    }
  });

  it('enriches a legacy null-slate run once and preserves its history during compatible replay', async () => {
    const fixture = await runFixture();
    const before = only(await runtimeQuery<{ row: Record<string, unknown> }>(`
      SELECT to_jsonb(run) AS row FROM pregame_projection_runs run WHERE id = $1
    `, [fixture.run.runId])).row;
    expect(before.projection_slate_observation_id).toBeNull();
    const linked = stored(await store.recordProjectionCandidates({
      ...fixture.input, projectionSlateObservationId: fixture.slate.observationId,
    }));
    expect(linked.runId).toBe(fixture.run.runId);
    const replay = stored(await store.recordProjectionCandidates({
      ...fixture.input, quality: 'partial', fetchedAt: '2026-09-04T12:00:00.000Z',
      projectionSlateObservationId: fixture.slate.observationId,
    }));
    expect(replay.runId).toBe(linked.runId);
    expect(stored(await store.recordProjectionCandidates(fixture.input)).runId).toBe(linked.runId);
    const after = only(await runtimeQuery<{ row: Record<string, unknown> }>(`
      SELECT to_jsonb(run) AS row FROM pregame_projection_runs run WHERE id = $1
    `, [linked.runId])).row;
    expect(after).toEqual({ ...before, projection_slate_observation_id: fixture.slate.observationId });
  });

  it('concurrently enriches one run to the same exact slate without duplicate runs', async () => {
    const fixture = await runFixture();
    const connections = Array.from({ length: 4 }, () => createIndependentDatabase());
    try {
      const results = await Promise.all(connections.map(async (connection) => (
        stored(await createProjectionStore(connection.database).recordProjectionCandidates({
          ...fixture.input, projectionSlateObservationId: fixture.slate.observationId,
        }))
      )));
      expect(results.every((result) => result.runId === fixture.run.runId)).toBe(true);
      expect(only(await runtimeQuery<{ count: number }>(`
        SELECT count(*)::integer AS count FROM pregame_projection_runs
        WHERE source_revision = $1 AND model_version = $2
      `, [fixture.input.sourceRevision, fixture.input.modelVersion])).count).toBe(1);
    } finally {
      await Promise.all(connections.map((connection) => connection.close()));
    }
  });

  it('denies every historical run-field change even before a run is referenced', async () => {
    const fixture = await runFixture();
    const assignments = [
      'id = gen_random_uuid()',
      "provider = 'b3-changed-provider'",
      'season = season + 1',
      "season_type = 'post'",
      'week = week - 1',
      "model_version = 'b3-changed-model'",
      "source_revision = source_revision || '-changed'",
      "request_started_at = request_started_at - interval '1 second'",
      "request_completed_at = request_completed_at + interval '1 second'",
      "fetched_at = fetched_at + interval '1 second'",
      "quality = 'invalid'",
      "created_at = created_at + interval '1 second'",
    ];
    const before = only(await runtimeQuery<{ row: unknown }>(`
      SELECT to_jsonb(run) AS row FROM pregame_projection_runs run WHERE id = $1
    `, [fixture.run.runId])).row;
    for (const assignment of assignments) {
      await denied(`UPDATE pregame_projection_runs SET ${assignment} WHERE id = $1`, [fixture.run.runId]);
    }
    expect(only(await runtimeQuery<{ row: unknown }>(`
      SELECT to_jsonb(run) AS row FROM pregame_projection_runs run WHERE id = $1
    `, [fixture.run.runId])).row).toEqual(before);
  });

  it('permits exact one-time runtime enrichment but denies replacement and clearing', async () => {
    const fixture = await runFixture();
    const before = only(await runtimeQuery<{ row: Record<string, unknown> }>(
      'SELECT to_jsonb(run) AS row FROM pregame_projection_runs run WHERE id = $1',
      [fixture.run.runId],
    )).row;
    await runtimeQuery('UPDATE pregame_projection_runs SET projection_slate_observation_id = $2 WHERE id = $1',
      [fixture.run.runId, fixture.slate.observationId]);
    expect(only(await runtimeQuery<{ row: Record<string, unknown> }>(
      'SELECT to_jsonb(run) AS row FROM pregame_projection_runs run WHERE id = $1',
      [fixture.run.runId],
    )).row).toEqual({ ...before, projection_slate_observation_id: fixture.slate.observationId });
    await store.recordProjectionCandidates({
      ...fixture.input, projectionSlateObservationId: fixture.slate.observationId,
    });
    const other = await runFixture();
    await denied('UPDATE pregame_projection_runs SET projection_slate_observation_id = $2 WHERE id = $1',
      [fixture.run.runId, other.slate.observationId]);
    await denied('UPDATE pregame_projection_runs SET projection_slate_observation_id = NULL WHERE id = $1',
      [fixture.run.runId]);
    await expect(store.recordProjectionCandidates({
      ...fixture.input, projectionSlateObservationId: other.slate.observationId,
    })).rejects.toThrow(/immutable|lineage|did not return a row/iu);
  });

  it.each([
    ['provider', { provider: 'other-provider' }],
    ['season', { season: 2027 }],
    ['season type', { seasonType: 'post' as const }],
    ['week', { week: 15 }],
    ['source revision', { sourceRevision: 'b3-wrong-source' }],
    ['request start', { requestStartedAt: '2026-09-03T11:59:00.000Z' }],
    ['request completion', { requestCompletedAt: '2026-09-03T12:00:01.000Z' }],
    ['fetch time', { fetchedAt: '2026-09-03T12:00:01.000Z' }],
  ])('denies a new run linked to a slate with mismatched %s', async (_label, mismatch) => {
    const fixture = await runFixture();
    await expect(store.recordProjectionCandidates({
      ...fixture.input, ...mismatch, modelVersion: `b3-mismatch-${randomUUID()}`,
      projectionSlateObservationId: fixture.slate.observationId,
    })).rejects.toThrow(/lineage|mismatch/iu);
  });

  it('denies cross-period enrichment against the persisted run identity', async () => {
    const fixture = await runFixture();
    const otherSlate = stored(await store.recordProjectionSlate({ ...fixture.slateInput, week: 15 }));
    await expect(store.recordProjectionCandidates({
      ...fixture.input, projectionSlateObservationId: otherSlate.observationId,
    })).rejects.toThrow(/lineage|mismatch/iu);
    expect(only(await runtimeQuery<{ slate: string | null }>(`
      SELECT projection_slate_observation_id::text AS slate FROM pregame_projection_runs WHERE id = $1
    `, [fixture.run.runId])).slate).toBeNull();
  });

  it('protects scoring-profile creation history and league-season identity while allowing ordinary registration', async () => {
    const a = await lineageFixture(database);
    const b = await lineageFixture(database);
    await denied("UPDATE scoring_profiles SET created_at = created_at + interval '1 second' WHERE id = $1",
      [a.league.scoringProfileId]);
    await denied('UPDATE leagues SET league_key = $2 WHERE id = $1',
      [a.league.leagueId, `b3-rekey-${randomUUID()}`]);
    await denied('UPDATE league_seasons SET league_id = $2 WHERE id = $1',
      [a.league.leagueSeasonId, b.league.leagueId]);
    await denied('UPDATE league_seasons SET season = season + 1 WHERE id = $1', [a.league.leagueSeasonId]);
    await denied('UPDATE league_source_connections SET league_season_id = $2 WHERE league_season_id = $1',
      [a.league.leagueSeasonId, b.league.leagueSeasonId]);
  });

  it('denies cross-league pointer, verification-source, and historical observation reassignment', async () => {
    const a = await lineageFixture(database);
    const observationA = await a.observe();
    const publishedA = await a.publish(observationA);
    expect(publishedA.kind).toBe('published');
    if (publishedA.kind !== 'published') throw new Error('Synthetic A snapshot was not published.');
    const b = await lineageFixture(database);
    const observationB = await b.observe();
    const publishedB = await b.publish(observationB);
    expect(publishedB.kind).toBe('published');
    if (publishedB.kind !== 'published') throw new Error('Synthetic B snapshot was not published.');
    await denied('UPDATE current_projection_snapshots SET league_season_id = $2 WHERE league_season_id = $1',
      [a.league.leagueSeasonId, b.league.leagueSeasonId]);
    await denied('UPDATE current_projection_snapshots SET snapshot_id = $2 WHERE league_season_id = $1',
      [a.league.leagueSeasonId, publishedB.snapshot.snapshotId]);
    await denied('UPDATE current_projection_snapshots SET verification_source_observation_id = $2 WHERE league_season_id = $1',
      [a.league.leagueSeasonId, observationB.value.observationId]);
    await denied('UPDATE league_week_observations SET league_season_id = $2 WHERE id = $1',
      [observationA.value.observationId, b.league.leagueSeasonId]);
    expect((await a.store.readCurrentSnapshot(a.league.leagueSeasonId, a.period.week))?.snapshotId)
      .toBe(publishedA.snapshot.snapshotId);
    expect((await b.store.readCurrentSnapshot(b.league.leagueSeasonId, b.period.week))?.snapshotId)
      .toBe(publishedB.snapshot.snapshotId);
    await denied('DELETE FROM projection_snapshots WHERE id = $1', [publishedA.snapshot.snapshotId]);
    await denied('DELETE FROM league_week_observations WHERE id = $1', [observationA.value.observationId]);
  });

  it('denies direct deletion of even an unreferenced slate entry and permits its parent retention cascade', async () => {
    const contentId = randomUUID();
    await ownerQuery(`INSERT INTO projection_slate_contents
      (id, provider, season, season_type, week, normalizer_version, semantic_hash,
        quality, coverage, warnings, entry_count, created_at)
      VALUES ($1,'tank01',2026,'reg',18,$2,$3,'partial','{}','[]',1,'2000-01-01')`,
    [contentId, `b3-orphan-${randomUUID()}`, '9'.repeat(64)]);
    await ownerQuery(`INSERT INTO projection_slate_entries
      (projection_slate_content_id, entity_kind, provider_external_id, stats, scoring_stats, ordinal)
      VALUES ($1,'player','b3-orphan-player','{}','{}',0)`, [contentId]);
    expect(only(await runtimeQuery<{ count: number }>(`
      SELECT count(*)::integer AS count FROM projection_slate_entries WHERE projection_slate_content_id = $1
    `, [contentId])).count).toBe(1);
    await denied('DELETE FROM projection_slate_entries WHERE projection_slate_content_id = $1', [contentId]);
    const pruned = stored(await store.pruneHistory({ before: '2001-01-01T00:00:00.000Z' }));
    expect(pruned.projectionSlateContentsDeleted).toBeGreaterThanOrEqual(1);
    expect(await runtimeQuery('SELECT id FROM projection_slate_contents WHERE id = $1', [contentId]))
      .toHaveLength(0);
    expect(only(await runtimeQuery<{ count: number }>(`
      SELECT count(*)::integer AS count FROM projection_slate_entries WHERE projection_slate_content_id = $1
    `, [contentId])).count).toBe(0);
  });
});
