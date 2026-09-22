import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createProjectionStore } from '../lib/projection-store';
import { DEFENSE_PROJECTION_MODEL_VERSION } from '../lib/projections/domain/contracts';
import { createIndependentDatabase, ownerQuery, type IndependentDatabase } from './neon-integration-harness';
import { databaseTime, stored } from './lineup-lineage-fixture';
import { enrollIntegrationSeason } from './administration-enrollment-fixture';

describe.sequential('compact live defense reuse through the isolated runtime role', () => {
  let database: IndependentDatabase;
  beforeAll(() => { database = createIndependentDatabase(); });
  afterAll(async () => { await database.close(); });

  async function fixture(season = 2199) {
    const store = createProjectionStore(database.database);
    const leagueKey = `defense-reader-${randomUUID()}`;
    const league = stored(await store.registerLeagueSeason({ leagueKey, leagueName: 'Isolated reader fixture',
      season, sleeperLeagueId: `source-${leagueKey}`, scoringRules: { sack: 1, pts_allow_0: 10 } }));
    return { store, leagueKey, league };
  }
  const period = { season: 2199, seasonType: 'regular', week: 18 } as const;
  const offset = (at: string, seconds: number) => new Date(Date.parse(at) + seconds * 1000).toISOString();
  const evidence = (at: string, team: string, sourceRevision: string) => ({
    version: DEFENSE_PROJECTION_MODEL_VERSION, status: 'available', period,
    requestStartedAt: at, requestCompletedAt: at, observedAt: at, sourceRevision,
    entries: [{ team, stats: { pts_allow: 7, pts_allow_7_13: 1, sack: 2 } }],
  });

  it('uses runtime SELECT permissions, exact active enrollment and newest same-source union without exposing full history', async () => {
    const [one, two, excluded] = await Promise.all([fixture(), fixture(), fixture()]);
    await enrollIntegrationSeason(ownerQuery, [one.leagueKey, two.leagueKey], period.season);
    const at = new Date(await databaseTime()).toISOString();
    const originalAt = offset(at, -5);
    const revision = `sha256:${randomUUID()}`;
    const write = async (target: Awaited<ReturnType<typeof fixture>>, detail: ReturnType<typeof evidence>, observedAt: string) => {
      return stored(await target.store.recordLeagueWeekObservation({ leagueSeasonId: target.league.leagueSeasonId,
        week: period.week, sourceRevision: randomUUID(), requestStartedAt: observedAt,
        requestCompletedAt: observedAt, observedAt, quality: 'partial',
        sourceData: { season: String(period.season), liveDefense: detail },
        expectedTank01GameIds: [], playerPoints: [], rosterPoints: [] }));
    };
    await write(one, evidence(offset(at, -65), 'CHI', 'sha256:older-capture'), offset(at, -10));
    await write(one, evidence(originalAt, 'SEA', revision), at);
    await write(two, evidence(originalAt, 'SF', revision), at);
    // A newer record from a league without season enrollment is not reusable.
    await write(excluded, evidence(at, 'ATL', 'sha256:not-enrolled'), at);
    const capture = await one.store.readLiveDefenseStatCapture!(period);
    expect(capture).toEqual({ period, requestStartedAt: originalAt, requestCompletedAt: originalAt,
      observedAt: originalAt, sourceRevision: revision,
      entries: [evidence(originalAt, 'SEA', revision).entries[0], evidence(originalAt, 'SF', revision).entries[0]],
    });
    // Disabling enrollment takes it out of subsequent reuse without deleting history.
    await ownerQuery(`UPDATE league_administration_enrollments SET active=false
      WHERE league_id=(SELECT id FROM leagues WHERE league_key=$1)`, [two.leagueKey]);
    expect((await one.store.readLiveDefenseStatCapture!(period))?.entries.map((entry) => entry.team)).toEqual(['SEA']);
  });

  it('rejects stale original capture timestamps, malformed stats and mismatched periods from real stored rows', async () => {
    const f = await fixture();
    await enrollIntegrationSeason(ownerQuery, [f.leagueKey], period.season);
    const requested = { ...period, week: 17 };
    const at = new Date(await databaseTime()).toISOString();
    const cases = [
      { ...evidence(offset(at, -91), 'SEA', 'sha256:stale'), period: requested },
      evidence(at, 'SEA', 'sha256:wrong-period'),
      { ...evidence(at, 'SEA', 'sha256:malformed'), period: requested,
        entries: [{ team: 'SEA', stats: { pts_allow: '7' } }] },
    ];
    for (const [index, detail] of cases.entries()) {
      // Owner insertion deliberately bypasses the application serializer. The
      // runtime reader must independently reject invalid persisted evidence.
      const observedAt = offset(at, -2 + index);
      await ownerQuery(`INSERT INTO league_week_observations
        (league_season_id,provider,week,source_revision,request_started_at,request_completed_at,
         observed_at,quality,expected_game_count,source_data)
        VALUES($1,'sleeper',$2,$3,$4,$4,$4,'partial',0,$5::jsonb)`,
      [f.league.leagueSeasonId, requested.week, randomUUID(), observedAt,
        JSON.stringify({ season: String(period.season), liveDefense: detail })]);
      expect(await f.store.readLiveDefenseStatCapture!(requested)).toBeNull();
    }
  });

  it('reuses fresh v4 hourly partial defense history through runtime SELECT, retaining source identity and excluding missing rows', async () => {
    const requested = { season: 2187, seasonType: 'regular', week: 18 } as const;
    const f = await fixture(requested.season);
    await enrollIntegrationSeason(ownerQuery, [f.leagueKey], requested.season);
    const at = new Date(await databaseTime()).toISOString();
    const originalAt = offset(at, -4);
    const sourceRevision = `sha256:${createHash('sha256').update(randomUUID()).digest('hex')}`;
    const contentId = randomUUID();
    const semanticHash = createHash('sha256').update(contentId).digest('hex');
    const stats = { pts_allow_0: 1, def_3_and_out: 1, gp: 1 };
    // Structurally valid synthetic partial raw history, installed only by the
    // guarded disposable harness. No score set, pointer or provider request.
    await ownerQuery(`INSERT INTO all_player_stat_contents
      (id,provider,season,season_type,week,normalizer_version,semantic_hash,quality,coverage,entry_count)
      VALUES($1,'sleeper',$2,'reg',$3,'sleeper-weekly-stats-v4',$4,'partial','{"complete":false}',3)`,
    [contentId, requested.season, requested.week, semanticHash]);
    await ownerQuery(`INSERT INTO all_player_stat_entries
      (all_player_stat_content_id,entity_kind,provider_external_id,nfl_team,position,stats,eligibility_evidence,game_phase,ordinal)
      VALUES($1,'team_defense','SEA','SEA','DEF',$2::jsonb,
        '{"kind":"weekly-stat","source":"weekly-stat-provider"}','live',0),
      ($1,'team_defense','SF','SF','DEF','{}','{"kind":"missing-provider-row","inventoryFingerprint":"synthetic"}','live',1),
      ($1,'player','11586','SEA','RB','{"rush_yd":19}',
        '{"kind":"weekly-stat","source":"weekly-stat-provider"}','live',2)`, [contentId, JSON.stringify(stats)]);
    await ownerQuery(`INSERT INTO all_player_stat_observations
      (id,all_player_stat_content_id,provider,season,season_type,week,normalizer_version,source_revision,
       request_started_at,request_completed_at,observed_at,quality)
      VALUES($1,$2,'sleeper',$3,'reg',$4,'sleeper-weekly-stats-v4',$5,$6,$7,$7,'partial')`,
    [randomUUID(), contentId, requested.season, requested.week, sourceRevision, offset(at, -5), originalAt]);
    expect(await f.store.readLiveDefenseStatCapture!(requested)).toEqual({ period: requested,
      sourceRevision, requestStartedAt: offset(at, -5), requestCompletedAt: originalAt,
      observedAt: originalAt, entries: [{ team: 'SEA', stats }] });
    expect(await f.store.readLiveDefenseStatCapture!({ ...requested, week: 17 })).toBeNull();
    await ownerQuery('UPDATE league_administration_enrollments SET active=false WHERE league_id=$1',
      [f.league.leagueId]);
    expect(await f.store.readLiveDefenseStatCapture!(requested)).toBeNull();
  });
});
