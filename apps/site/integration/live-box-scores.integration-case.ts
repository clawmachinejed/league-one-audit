import { createHash, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createProjectionStore } from '../lib/projection-store';
import { prepareLeagueWeekObservation } from '../lib/projections/adapters/neon/observations';
import { buildLiveBoxScoreEvidence, type LiveBoxScoreEntry } from '../lib/projections/shared/live-box-score-evidence';
import { createIndependentDatabase, ownerQuery, type IndependentDatabase } from './neon-integration-harness';
import { databaseTime, stored } from './lineup-lineage-fixture';

const period = { season: 2188, seasonType: 'regular', week: 18 } as const;
const offset = (at: string, seconds: number) => new Date(Date.parse(at) + seconds * 1000).toISOString();
const entries: readonly LiveBoxScoreEntry[] = [
  { entityKind: 'player', providerExternalId: '11586', gamePhase: 'live', stats: { rush_att: 3, rush_yd: 19 } },
  { entityKind: 'player', providerExternalId: '5859', gamePhase: 'final', stats: { rec: 6, rec_yd: 83 } },
];
const identities = entries.map(({ entityKind, providerExternalId }) => ({ entityKind, providerExternalId }));
function evidence(at: string, rows = entries) {
  return buildLiveBoxScoreEvidence({ period, sourceRevision: `synthetic-capture:${at}`,
    bodyHash: `sha256:${createHash('sha256').update(JSON.stringify(rows)).digest('hex')}`,
    requestStartedAt: at, requestCompletedAt: at, observedAt: at, entries: rows });
}

// Only the existing guarded disposable integration runner may execute this file.
describe.sequential('compact live box-score observation persistence and reads', () => {
  let database: IndependentDatabase;
  beforeAll(() => { database = createIndependentDatabase(); });
  afterAll(async () => { await database.close(); });
  async function fixture() {
    const store = createProjectionStore(database.database);
    const leagueKey = `live-box-${randomUUID()}`;
    const league = stored(await store.registerLeagueSeason({ leagueKey, leagueName: 'Synthetic compact stats',
      season: period.season, sleeperLeagueId: `source-${leagueKey}`, scoringRules: { rush_yd: 0.1 } }));
    const at = new Date(await databaseTime()).toISOString();
    const observation = (capture = evidence(at), sourceRevision = `official:${capture.revision}`) => ({
      leagueSeasonId: league.leagueSeasonId, week: period.week, sourceRevision,
      requestStartedAt: at, requestCompletedAt: at, observedAt: at, quality: 'complete' as const,
      sourceData: { leagueKey, season: String(period.season), week: period.week, liveBoxScores: capture },
      expectedTank01GameIds: [], playerPoints: [], rosterPoints: [],
    });
    const read = (key = leagueKey, week: number = period.week) => store.readAllPlayerBoxScores!({ leagueKey: key,
      season: period.season, week, identities });
    return { store, league, leagueKey, at, observation, read };
  }
  async function allPlayerCounts() {
    return (await ownerQuery(`SELECT
      (SELECT count(*) FROM all_player_stat_contents)::integer AS contents,
      (SELECT count(*) FROM all_player_stat_entries)::integer AS entries,
      (SELECT count(*) FROM all_player_stat_observations)::integer AS observations,
      (SELECT count(*) FROM all_player_score_sets)::integer AS score_sets,
      (SELECT count(*) FROM all_player_scores)::integer AS scores,
      (SELECT count(*) FROM current_all_player_score_sets)::integer AS pointers`))[0];
  }

  it('writes and reads live offense and final bench rows using runtime privileges, with exact replay and no score copies', async () => {
    const f = await fixture();
    const before = await allPlayerCounts();
    const input = f.observation();
    const first = stored(await f.store.recordLeagueWeekObservation(input));
    expect(stored(await f.store.recordLeagueWeekObservation(input)).observationId).toBe(first.observationId);
    expect(await f.read()).toEqual({ status: 'available', observedAt: f.at, revision: input.sourceData.liveBoxScores.revision,
      players: { 'player:11586': { stats: { rush_att: 3, rush_yd: 19 }, gamePhase: 'live' },
        'player:5859': { stats: { rec: 6, rec_yd: 83 }, gamePhase: 'final' } } });
    expect(await allPlayerCounts()).toEqual(before);
    expect((await ownerQuery<{ count: number }>('SELECT count(*)::integer AS count FROM league_week_observations WHERE league_season_id=$1',
      [f.league.leagueSeasonId]))[0].count).toBe(1);
    expect(await f.read('different-league')).toMatchObject({ status: 'unavailable' });
    expect(await f.read(f.leagueKey, 17)).toMatchObject({ status: 'unavailable' });
    await expect(f.store.recordLeagueWeekObservation({ ...input, sourceData: { ...input.sourceData,
      liveBoxScores: { ...input.sourceData.liveBoxScores, revision: 'a'.repeat(64) } } }))
      .rejects.toThrow('live-box-scores-invalid');
  });

  it('ignores forged persisted compact evidence and preserves raw-source privacy', async () => {
    const f = await fixture();
    const input = f.observation();
    await ownerQuery(`INSERT INTO league_week_observations
      (league_season_id,provider,week,source_revision,request_started_at,request_completed_at,observed_at,quality,source_data)
      VALUES($1,'sleeper',$2,$3,$4,$4,$4,'complete',$5::jsonb)`, [f.league.leagueSeasonId, period.week,
      randomUUID(), f.at, JSON.stringify({ ...input.sourceData,
        liveBoxScores: { ...input.sourceData.liveBoxScores, revision: 'a'.repeat(64) } })]);
    expect(await f.read()).toEqual({ status: 'unavailable', observedAt: null, revision: null, players: {} });
  });

  it('uses newer hourly history as a whole without stitching an older compact final row into it', async () => {
    const f = await fixture();
    await f.store.recordLeagueWeekObservation(f.observation(evidence(offset(f.at, -10))));
    const contentId = randomUUID();
    const hash = createHash('sha256').update(contentId).digest('hex');
    // Structurally valid synthetic partial raw history; no score set or pointer is created.
    await ownerQuery(`INSERT INTO all_player_stat_contents
      (id,provider,season,season_type,week,normalizer_version,semantic_hash,quality,coverage,entry_count)
      VALUES($1,'sleeper',$2,'reg',$3,'sleeper-weekly-stats-v2',$4,'partial','{"complete":false}',1)`,
    [contentId, period.season, period.week, hash]);
    await ownerQuery(`INSERT INTO all_player_stat_entries
      (all_player_stat_content_id,entity_kind,provider_external_id,position,stats,eligibility_evidence,game_phase,ordinal)
      VALUES($1,'player','11586','RB','{"rush_att":4,"rush_yd":24}',
        '{"kind":"weekly-stat","source":"weekly-stat-provider"}','live',0)`, [contentId]);
    await ownerQuery(`INSERT INTO all_player_stat_observations
      (id,all_player_stat_content_id,provider,season,season_type,week,normalizer_version,source_revision,
       request_started_at,request_completed_at,observed_at,quality)
      VALUES($1,$2,'sleeper',$3,'reg',$4,'sleeper-weekly-stats-v2',$5,$6,$6,$6,'partial')`,
    [randomUUID(), contentId, period.season, period.week, randomUUID(), f.at]);
    expect(await f.read()).toEqual({ status: 'available', observedAt: f.at, revision: hash,
      players: { 'player:11586': { stats: { rush_att: 4, rush_yd: 24 }, gamePhase: 'live' } } });
  });

  it('measures actual parent heap/index/TOAST growth for 180 and 300 roster rows and exact replay', async () => {
    const f = await fixture();
    const measure = async () => (await ownerQuery<{
      heap_bytes: number; indexes_bytes: number; toast_and_auxiliary_bytes: number; total_bytes: number;
    }>(`SELECT pg_relation_size(oid)::integer AS heap_bytes,pg_indexes_size(oid)::integer AS indexes_bytes,
      (pg_table_size(oid)-pg_relation_size(oid))::integer AS toast_and_auxiliary_bytes,
      pg_total_relation_size(oid)::integer AS total_bytes FROM pg_class
      WHERE relnamespace='public'::regnamespace AND relname='league_week_observations'`))[0];
    const batches = [];
    for (const [block, playerCount] of [0, 180, 0, 300].entries()) {
      const label = `compact-size-${block}-${randomUUID()}`;
      const inputs = Array.from({ length: 25 }, (_, index) => {
        const at = offset(f.at, -((4 - block) * 25 - index) * 60);
        const rows: LiveBoxScoreEntry[] = Array.from({ length: playerCount }, (_, playerIndex) => ({
          entityKind: 'player', providerExternalId: String(10000 + playerIndex),
          gamePhase: playerIndex % 2 ? 'final' : 'live', stats: {
            rush_att: (index + playerIndex) % 24, rush_yd: (index * 3 + playerIndex) % 180,
            rush_td: playerIndex % 3, rec: playerIndex % 10, rec_tgt: playerIndex % 14,
            rec_yd: (index * 2 + playerIndex) % 130, rec_td: playerIndex % 2,
            fum: 0, fum_lost: 0,
          },
        }));
        return { leagueSeasonId: f.league.leagueSeasonId, week: period.week,
          sourceRevision: `${label}:${index}`, requestStartedAt: at, requestCompletedAt: at, observedAt: at,
          quality: 'complete' as const, sourceData: { leagueKey: f.leagueKey, season: String(period.season),
            week: period.week, rosteredPlayerCount: playerCount || 180,
            ...(playerCount ? { liveBoxScores: evidence(at, rows) } : {}) },
          expectedTank01GameIds: [], playerPoints: [], rosterPoints: [] };
      });
      const rows = inputs.map(input => ({ source_revision: input.sourceRevision, observed_at: input.observedAt,
        source_data: prepareLeagueWeekObservation(input).sourceData }));
      const before = await measure();
      const start = performance.now();
      await ownerQuery(`INSERT INTO league_week_observations
        (league_season_id,provider,week,source_revision,request_started_at,request_completed_at,observed_at,quality,source_data)
        SELECT $1,'sleeper',$2,row.source_revision,row.observed_at,row.observed_at,row.observed_at,'complete',row.source_data
        FROM jsonb_to_recordset($3::jsonb) AS row(source_revision text,observed_at timestamptz,source_data jsonb)`,
      [f.league.leagueSeasonId, period.week, JSON.stringify(rows)]);
      const after = await measure();
      const replay = stored(await f.store.recordLeagueWeekObservation(inputs[24]));
      const replayAgain = stored(await f.store.recordLeagueWeekObservation(inputs[24]));
      expect(replayAgain.observationId).toBe(replay.observationId);
      const afterReplay = await measure();
      const retained = (await ownerQuery<{ observations: number; source_bytes: number; row_bytes: number }>(
        `SELECT count(*)::integer AS observations,sum(pg_column_size(source_data))::integer AS source_bytes,
          sum(pg_column_size(observation))::integer AS row_bytes FROM league_week_observations observation
          WHERE league_season_id=$1 AND source_revision LIKE $2`, [f.league.leagueSeasonId, `${label}:%`]))[0];
      expect(retained.observations).toBe(25);
      batches.push({ playerCount, observations: 25, before, after, afterReplay, retained,
        jsonInputBytes: Buffer.byteLength(JSON.stringify(rows)), replayAdditionalObservations: 0,
        wallMs: performance.now() - start,
        physicalGrowthBytes: Object.fromEntries(Object.keys(before).map(key => [key,
          after[key as keyof typeof after] - before[key as keyof typeof before]])) });
    }
    const report = { kind: 'synthetic-isolated-compact-box-score-parent-capacity', measuredAt: new Date().toISOString(),
      providerRequests: 0, batches, limitations: [
        'Real PostgreSQL parent heap, indexes, TOAST/auxiliary allocation and stored row sizes; synthetic public stats.',
        'Owner bulk setup uses runtime serializer; exact replay uses real runtime writer and does not add observations.',
        'Excludes unchanged player-point children, snapshots, all-player history and ordinary application workload.',
        'Existing 48-hour pruning still preserves referenced current/history parents; no new retention policy is assumed.',
        'Page allocation and free-space reuse affect small batches. This is not a season-fit or transfer measurement.',
      ] };
    const serialized = `${JSON.stringify(report, null, 2)}\n`;
    console.info(`LIVE_BOX_SCORE_CAPACITY ${JSON.stringify(report)}`);
    if (process.env.PROJECTION_INTEGRATION_ARTIFACT_DIRECTORY) {
      await writeFile(join(process.env.PROJECTION_INTEGRATION_ARTIFACT_DIRECTORY, 'live-box-score-capacity.integration.json'), serialized);
    }
  }, 60_000);
});
