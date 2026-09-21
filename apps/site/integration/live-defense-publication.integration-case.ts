import { createHash, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prepareLeagueWeekObservation } from '../lib/projections/adapters/neon/observations';
import { createIndependentDatabase, ownerQuery, type IndependentDatabase } from './neon-integration-harness';
import { databaseTime, lineageFixture, LINEUP_B, stored } from './lineup-lineage-fixture';

function evidence(at: string, overrides: Record<string, unknown> = {}) {
  return {
    version: 'defense-components-v1', status: 'available',
    period: { season: 2026, seasonType: 'regular', week: 1 },
    requestStartedAt: at, requestCompletedAt: at, observedAt: at,
    sourceRevision: 'sha256:defense-detail',
    entries: [{ team: 'SEA', stats: { sack: 3, pts_allow: 10, pts_allow_7_13: 1 } }],
    calculations: [{ team: 'SEA', quality: 'defense-estimated' }],
    ...overrides,
  };
}
const offset = (at: string, seconds: number) => new Date(Date.parse(at) + seconds * 1_000).toISOString();

describe.sequential('live defense source publication in isolated Neon', () => {
  let database: IndependentDatabase;
  beforeAll(() => { database = createIndependentDatabase(); });
  afterAll(async () => { await database.close(); });

  async function fixture() {
    const f = await lineageFixture(database);
    const first = await f.observe();
    const initial = await f.publish(first);
    if (initial.kind !== 'published') throw new Error('Initial legacy snapshot was not published.');
    const at = new Date(await databaseTime()).toISOString();
    // Privileged construction bypasses the new application serializer to prove
    // that publication independently rejects malformed historical source JSON.
    const observe = async (liveDefense?: unknown, expectedGameId?: string) => {
      const id = randomUUID();
      const sourceData = { season: '2026', ...(liveDefense === undefined ? {} : { liveDefense }) };
      await ownerQuery(`INSERT INTO league_week_observations
        (id,league_season_id,provider,week,source_revision,request_started_at,
         request_completed_at,observed_at,quality,expected_game_count,source_data,
         lineup_revision_version,lineup_revision)
        VALUES($1,$2,'sleeper',1,$3,$4,$4,$4,'complete',$5,$6::jsonb,'lineup-v1',$7)`,
      [id, f.league.leagueSeasonId, randomUUID(), at, expectedGameId ? 1 : 0, JSON.stringify(sourceData), LINEUP_B]);
      if (expectedGameId) await ownerQuery(`INSERT INTO league_week_expected_games
        (league_week_observation_id,nfl_game_id) VALUES($1,$2)`, [id, expectedGameId]);
      return id;
    };
    const publish = (id: string, gameIds: readonly string[] = []) => f.store.publishSnapshot({
      leagueSeasonId: f.league.leagueSeasonId, week: 1, modelVersion: 'clock-v1',
      revisionKey: randomUUID(), leagueWeekObservationId: id, gameStateObservationIds: gameIds,
      calculatedAt: at, payload: { league: { season: '2026', rosterPositions: ['DEF'], week: 1, maxWeek: 18 },
        teams: [], updatedAt: at, week: 1, matchups: [] },
      activityWindows: [], lineupFence: f.fence,
    });
    const pointer = () => ownerQuery(`SELECT snapshot_id,verified_at::text,verification_source_observation_id
      FROM current_projection_snapshots WHERE league_season_id=$1 AND week=1`, [f.league.leagueSeasonId]);
    return { ...f, at, observe, publish, pointer };
  }

  it('publishes fresh detail, includes its time in verification and preserves replay and fallback', async () => {
    const f = await fixture();
    const detailAt = offset(f.at, 20);
    const id = await f.observe(evidence(detailAt));
    const first = await f.publish(id);
    expect(first.kind).toBe('published');
    if (first.kind !== 'published') return;
    expect(Date.parse(first.snapshot.verifiedAt)).toBe(Date.parse(detailAt));
    expect((await f.publish(id)).kind).toBe('unchanged');
    const fallback = await f.observe({ version: 'defense-components-v1', status: 'unavailable', reason: 'parity-mismatch' });
    expect((await f.publish(fallback)).kind).toBe('unchanged');
    expect((await f.publish(await f.observe())).kind).toBe('unchanged');
  });

  it('rejects stale, wrong-period and malformed persisted detail without moving the pointer', async () => {
    const f = await fixture();
    const before = await f.pointer();
    const invalid: unknown[] = [
      null, [], evidence(f.at, { status: 'fresh' }), evidence(f.at, { version: 'unknown' }),
      evidence(offset(f.at, -91)), evidence(offset(f.at, 91)),
      evidence(f.at, { requestStartedAt: offset(f.at, -91) }),
      evidence(f.at, { requestStartedAt: offset(f.at, -91), observedAt: offset(f.at, -91) }),
      evidence(f.at, { period: { season: 2027, seasonType: 'regular', week: 1 } }),
      evidence(f.at, { period: { season: 2026, seasonType: 'regular', week: 2 } }),
      evidence(f.at, { period: { season: '2026', seasonType: 'regular', week: 1 } }),
      evidence(f.at, { period: { season: 2026, seasonType: 'postseason', week: 1 } }),
      evidence(f.at, { sourceRevision: '' }),
      evidence(f.at, { requestCompletedAt: 'not-a-time' }),
      evidence(f.at, { requestCompletedAt: {} }),
      evidence(f.at, { requestStartedAt: '2026-02-30T18:00:00.000Z' }),
      evidence(f.at, { requestCompletedAt: '2026-09-21T24:00:00.000Z' }),
      evidence(f.at, { requestStartedAt: offset(f.at, 1) }),
      evidence(f.at, { observedAt: offset(f.at, 1) }),
      evidence(f.at, { observedAt: offset(f.at, -1) }),
    ];
    for (const value of invalid) {
      await expect(f.publish(await f.observe(value)))
        .resolves.toEqual({ kind: 'rejected', reason: 'incomplete-or-mismatched-sources' });
      expect(await f.pointer()).toEqual(before);
    }
  });

  it('checks defensive detail against game sources as well as league and calculation times', async () => {
    const f = await fixture();
    const externalGameId = `defense-source-${randomUUID()}`;
    const games = stored(await f.store.upsertNflGames([{ key: externalGameId, provider: 'tank01', externalGameId,
      season: 2026, seasonType: 'reg', week: 1, homeTeam: 'SEA', awayTeam: 'NE', kickoffAt: null }]));
    const gameAt = offset(f.at, 80);
    const states = stored(await f.store.recordGameStates({ provider: 'tank01', states: [{
      externalGameId, sourceRevision: randomUUID(), requestStartedAt: gameAt, requestCompletedAt: gameAt,
      observedAt: gameAt, statusCode: 0, period: null, gameClock: null, homeScore: null, awayScore: null, sourceData: {},
    }] }));
    const gameId = games[0].gameId;
    const legacy = await f.publish(await f.observe(undefined, gameId), [states[0].observationId]);
    expect(legacy.kind).toBe('published');
    const before = await f.pointer();
    // Each source is within 80 seconds of the league, but their combined
    // 160-second span makes the D/ST correction unsafe.
    await expect(f.publish(await f.observe(evidence(offset(f.at, -80)), gameId), [states[0].observationId]))
      .resolves.toEqual({ kind: 'rejected', reason: 'incomplete-or-mismatched-sources' });
    expect(await f.pointer()).toEqual(before);
  });

  it('measures physical parent-history growth for compact twelve-defense evidence and exact replay', async () => {
    const f = await lineageFixture(database);
    const at = new Date(await databaseTime()).toISOString();
    const teams = ['ARI', 'ATL', 'BAL', 'BUF', 'CAR', 'CHI', 'CIN', 'CLE', 'DAL', 'DEN', 'DET', 'GB'];
    const measure = async () => (await ownerQuery<{
      heap_bytes: number; indexes_bytes: number; toast_and_auxiliary_bytes: number; total_bytes: number;
    }>(`SELECT pg_relation_size(oid)::integer AS heap_bytes,pg_indexes_size(oid)::integer AS indexes_bytes,
      (pg_table_size(oid)-pg_relation_size(oid))::integer AS toast_and_auxiliary_bytes,
      pg_total_relation_size(oid)::integer AS total_bytes FROM pg_class
      WHERE relnamespace='public'::regnamespace AND relname='league_week_observations'`))[0];
    const batches = [];
    // Alternating blocks make allocator/page effects visible instead of claiming
    // that one serialized payload predicts retained physical database storage.
    for (const [block, withDefense] of [false, true, false, true].entries()) {
      const label = `${withDefense ? 'defense' : 'baseline'}-${block}-${randomUUID()}`;
      const inputs = Array.from({ length: 100 }, (_, index) => {
        const observedAt = offset(at, (block * 100 + index) * 60);
        const liveDefense = evidence(observedAt, {
          sourceRevision: `sha256:${createHash('sha256').update(randomUUID()).digest('hex')}`,
          entries: teams.map((team, teamIndex) => ({ team, stats: {
            pts_allow: (index + teamIndex) % 14,
            [(index + teamIndex) % 14 === 0 ? 'pts_allow_0'
              : (index + teamIndex) % 14 <= 6 ? 'pts_allow_1_6' : 'pts_allow_7_13']: 1,
            sack: (index + teamIndex) % 5,
            int: teamIndex % 3, fum_rec: teamIndex % 2, def_st_fum_rec: 0,
            def_td: index % 2, def_st_td: 0, safe: 0, blk_kick: 0,
            def_3_and_out: (index + teamIndex) % 7, def_4_and_stop: teamIndex % 3,
          } })),
          calculations: teams.map((team) => ({ team, quality: 'defense-estimated' })),
        });
        return { leagueSeasonId: f.league.leagueSeasonId, week: 1,
          sourceRevision: `${label}:${index}`, requestStartedAt: observedAt,
          requestCompletedAt: observedAt, observedAt, quality: 'complete' as const,
          sourceData: { leagueKey: f.leagueKey, season: '2026', week: 1, updatedAt: observedAt,
            matchupCount: 6, rosteredPlayerCount: 180, missingFrozenBaselineCount: 0,
            missingBaselinePolicy: 'zero', rosterIds: teams.map((_, number) => String(number + 1)),
            lineupAvailability: { version: 'lineup-availability-v1',
              availableRosterIds: teams.map((_, number) => String(number + 1)), unavailableRosterIds: [] },
            warning: null, ...(withDefense ? { liveDefense } : {}) },
          expectedTank01GameIds: [], playerPoints: [], rosterPoints: [],
          lineupRevisionVersion: 'lineup-v1', lineupRevision: LINEUP_B };
      });
      const rows = inputs.map((input) => ({ source_revision: input.sourceRevision, observed_at: input.observedAt,
        source_data: prepareLeagueWeekObservation(input).sourceData }));
      const before = await measure();
      // Owner bulk construction is bounded and uses the real parent table and
      // application serializer. It deliberately excludes unchanged child tables.
      const started = performance.now();
      await ownerQuery(`INSERT INTO league_week_observations
        (league_season_id,provider,week,source_revision,request_started_at,request_completed_at,
         observed_at,quality,expected_game_count,source_data,lineup_revision_version,lineup_revision)
        SELECT $1,'sleeper',1,row.source_revision,row.observed_at,row.observed_at,row.observed_at,
          'complete',0,row.source_data,'lineup-v1',$3
        FROM jsonb_to_recordset($2::jsonb) AS row(source_revision text,observed_at timestamptz,source_data jsonb)`,
      [f.league.leagueSeasonId, JSON.stringify(rows), LINEUP_B]);
      const after = await measure();
      const retained = (await ownerQuery<{ observations: number; stored_source_bytes: number; stored_row_bytes: number }>(
        `SELECT count(*)::integer AS observations,sum(pg_column_size(source_data))::integer AS stored_source_bytes,
          sum(pg_column_size(observation))::integer AS stored_row_bytes FROM league_week_observations observation
          WHERE league_season_id=$1 AND source_revision LIKE $2`, [f.league.leagueSeasonId, `${label}:%`]))[0];
      expect(retained.observations).toBe(100);
      const replay = stored(await f.store.recordLeagueWeekObservation(inputs[99]));
      expect(replay.playerPointsStored).toBe(0);
      expect(replay.rosterPointsStored).toBe(0);
      const afterReplay = await measure();
      const replayCount = (await ownerQuery<{ observations: number }>(
        `SELECT count(*)::integer AS observations FROM league_week_observations
          WHERE league_season_id=$1 AND source_revision LIKE $2`, [f.league.leagueSeasonId, `${label}:%`]))[0].observations;
      expect(replayCount).toBe(100);
      batches.push({ withDefense, count: 100, appliedDefensesPerObservation: withDefense ? 12 : 0,
        before, after, afterReplay, retained, replayAdditionalObservations: replayCount - retained.observations,
        wallMs: performance.now() - started,
        physicalGrowthBytes: Object.fromEntries(Object.keys(before).map((key) => [key,
          after[key as keyof typeof after] - before[key as keyof typeof before]])) });
    }
    await writeFile(new URL('../release/019-live-defense-capacity.integration.json', import.meta.url), `${JSON.stringify({
      kind: 'synthetic-isolated-live-defense-parent-history-capacity', measuredAt: new Date().toISOString(),
      providerRequests: 0, totalObservations: 400, observationsPerVariant: 200,
      limitations: ['Owner bulk inserts use runtime serializer into actual parent table; replay uses runtime writer.',
        'Synthetic twelve-defense applied evidence; no live provider or production traffic measurement.',
        'Parent-only incremental scope excludes unchanged official child rows, snapshots, identity tables and ordinary application growth.',
        'Physical allocation includes page/index/TOAST granularity and preexisting free-space effects; stored column/row sizes are separately measured PostgreSQL values.',
        'This measurement alone does not establish a retained-season capacity or transfer allowance.'],
      batches,
    }, null, 2)}\n`);
  }, 30_000);
});
