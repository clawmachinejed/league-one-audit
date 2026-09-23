import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { createProjectionStore, type ProjectionStore, type PersistenceOutcome } from '../lib/projection-store';
import { buildAllPlayerScoreContent, type AllPlayerStatObservation } from '../lib/projections/domain/all-player-statistics';
import { NFL_TEAM_CODES } from '../lib/projections/domain/contracts';
import { scoreSparseStatistics } from '../lib/projections/domain/scoring';
import { SLEEPER_ALL_PLAYER_SCORING_RULE_KEYS } from '../lib/projections/adapters/sleeper/scoring-profile';
import type { AllPlayerJobFence } from '../lib/projections/adapters/neon/contracts';
import { enrollIntegrationSeason } from './administration-enrollment-fixture';
import { createIndependentDatabase, ownerQuery, runtimeQuery, type IndependentDatabase } from './neon-integration-harness';

const DATABASE_SEASON = 2193;
function stored<T>(outcome: PersistenceOutcome<T>): T {
  if (outcome.kind !== 'stored') throw new Error('Expected enabled integration store');
  return outcome.value;
}

describe('shared all-player captures with league-scoped acceptance', () => {
  let database: IndependentDatabase;
  let store: ProjectionStore;
  let fence: AllPlayerJobFence;
  let gameId: string;
  let entityIds: Readonly<Record<string, string>>;
  let leagueSeasonIds: string[];
  let profileId: string;
  let sequence = 0;
  let previousJob: Record<string,unknown> | undefined;
  const capturedAt = Date.now() - 60_000;
  beforeAll(async () => {
    database = createIndependentDatabase(); store = createProjectionStore(database.database);
    previousJob = (await ownerQuery<{job:Record<string,unknown>}>(
      "SELECT to_jsonb(job) AS job FROM projection_jobs job WHERE job_key='all-player-ingestion:sleeper'"))[0]?.job;
    await ownerQuery("DELETE FROM projection_jobs WHERE job_key='all-player-ingestion:sleeper'");
    const claim = await store.acquireAllPlayerJob({mode: 'backfill',
      period: {season: DATABASE_SEASON, seasonType: 'reg', week: 1}, workerId: 'scoped-integration',
      leaseSeconds: 3600, deadlineAt: new Date(Date.now() + 3_500_000).toISOString()});
    if (claim.kind !== 'acquired') throw new Error('Scoped lease unavailable');
    fence = claim.fence;
    expect(await store.markAllPlayerRequest({fence,
      period: {season: DATABASE_SEASON, seasonType: 'reg', week: 1}})).toBe(true);
    const leagues = await Promise.all(['scoped-one', 'scoped-two'].map(async (leagueKey) => stored(await store.registerLeagueSeason({
      leagueKey, leagueName: leagueKey, season: DATABASE_SEASON, sleeperLeagueId: `scoped-${leagueKey}`,
      scoringRules: {pass_td: 4},
    }))));
    leagueSeasonIds = leagues.map((league) => league.leagueSeasonId);
    profileId = leagues[0].scoringProfileId;
    expect(leagues[1].scoringProfileId).toBe(profileId);
    await enrollIntegrationSeason(ownerQuery, ['scoped-one','scoped-two'], DATABASE_SEASON);
    // This intended member has never had a connection. Do not bypass immutable source-history guards.
    await ownerQuery("INSERT INTO leagues(league_key,name) VALUES('scoped-missing','Scoped missing registration')");
    const missing = await ownerQuery<{id:string}>(`INSERT INTO league_seasons(league_id,season,scoring_profile_id)
      SELECT id,$1::smallint,$2::uuid FROM leagues WHERE league_key='scoped-missing' RETURNING id::text`,
    [DATABASE_SEASON,profileId]);
    leagueSeasonIds.push(missing[0].id);
    await enrollIntegrationSeason(ownerQuery, ['scoped-missing'], DATABASE_SEASON);
    for (const leagueKey of ['scoped-one','scoped-two']) await ownerQuery(`INSERT INTO league_period_authorities (
      league_key,default_season,default_season_type,default_week,active_season,active_season_type,active_week,
      league_lifecycle,nfl_phase,source_provider,source_revision,source_observed_at,verified_at,
      source_external_league_id,expected_roster_count,expected_starter_slot_count,expected_roster_ids
    ) VALUES ($1,$2,'reg',1,$2,'reg',1,'active','regular','sleeper','scoped-authority',now(),now(),$3,1,1,ARRAY['roster-1'])
    ON CONFLICT (league_key) DO UPDATE SET default_season=EXCLUDED.default_season,
      active_season=EXCLUDED.active_season,default_season_type='reg',default_week=1,
      active_season_type='reg',active_week=1,league_lifecycle='active',nfl_phase='regular',
      source_provider='sleeper',source_revision='scoped-authority',source_observed_at=now(),
      source_external_league_id=EXCLUDED.source_external_league_id,
      expected_roster_count=1,expected_starter_slot_count=1,expected_roster_ids=ARRAY['roster-1'],verified_at=now()`,
    [leagueKey, DATABASE_SEASON, `scoped-${leagueKey}`]);
    entityIds = Object.fromEntries(stored(await store.upsertScoringEntities([
      {key: 'scoped-player-one',kind: 'player',displayName: 'Scoped QB',nflTeam: 'NE',
        providerIds: [{provider: 'sleeper',externalId: 'scoped-player-one'}]},
      {key: 'scoped-player-zero',kind: 'player',displayName: 'Scoped WR',nflTeam: 'NE',
        providerIds: [{provider: 'sleeper',externalId: 'scoped-player-zero'}]},
      ...NFL_TEAM_CODES.map((team) => ({key: team,kind: 'team_defense' as const,displayName: team,nflTeam: team,
        providerIds: [{provider: 'sleeper',externalId: team}]})),
    ])).map((entity) => {
      if (!entity.entityId || entity.conflict) throw new Error('Scoped identity unavailable');
      return [entity.key,entity.entityId];
    }));
    gameId = stored(await store.upsertNflGames([{key:'scoped-game',provider:'tank01',externalGameId:'scoped-game',
      season:DATABASE_SEASON,seasonType:'reg',week:1,homeTeam:'NE',awayTeam:'ATL',kickoffAt:'2026-09-13T17:00:00.000Z'}]))[0].gameId;
  });
  afterAll(async () => {
    try {
      await ownerQuery("DELETE FROM projection_jobs WHERE job_key='all-player-ingestion:sleeper'");
      if (previousJob) await ownerQuery('INSERT INTO projection_jobs SELECT * FROM jsonb_populate_record(NULL::projection_jobs,$1::jsonb)',
        [JSON.stringify(previousJob)]);
    } finally { await database.close(); }
  });
  function observation(passTouchdowns: number, revision: string, observedAt: string): AllPlayerStatObservation {
    return {
      provider: 'sleeper', season: DATABASE_SEASON, seasonType: 'reg', week: 1,
      normalizerVersion: 'sleeper-weekly-stats-v1', sourceRevision: revision,
      requestStartedAt: new Date(Date.parse(observedAt) - 1_000).toISOString(),
      requestCompletedAt: observedAt, observedAt, quality: 'complete',
      coverage: {
        complete: true,
        expectedInventoryFingerprint: `sha256:${'a'.repeat(64)}`,
        catalogRevision: 'catalog:integration',
        scheduleRevision: 'schedule:integration',
        rosterInventoryFingerprint: `sha256:${'b'.repeat(64)}`,
        projectionInventoryFingerprint: `sha256:${'c'.repeat(64)}`,
        byeInventoryFingerprint: `sha256:${'d'.repeat(64)}`,
        periodInventoryComplete: true,
        periodInventoryEvidence: { source: 'manual-review', sourceRevision: 'synthetic-period',
          observedAt: '2026-09-01T00:00:00.000Z',
          effectivePeriod: { season: DATABASE_SEASON, seasonType: 'reg', week: 1 },
          excludedPlayerReasons: {}, teamsByPlayerId: {
            'scoped-player-one': 'NE', 'scoped-player-zero': 'NE',
          } },
        mode: 'completed-backfill', scheduledGameCount: 1, nonFinalScheduledGameCount: 0,
        scheduleFinalityComplete: true, nonFinalEligibleCount: 0,
        expectedEntityCount: 34,
        expectedPlayerCount: 2,
        expectedTeamDefenseCount: 32,
        providerPresentEntityCount: 4,
        providerMissingEntityCount: 30,
        responseEntityCount: 4,
        fantasyEntityCount: 34,
        unknownEligibilityCount: 0,
        unmappedGameCount: 0,
        unexpectedResponseEntityCount: 0,
      }, warnings: [],
      entries: [{
        entityKind: 'player', providerExternalId: 'scoped-player-one', nflGameId: gameId,
        nflTeam: 'NE', position: 'QB', stats: { gms_active: 1, gp: 1, pass_td: passTouchdowns },
        eligibilityEvidence: {
          kind: 'weekly-stat', source: 'weekly-stat-provider', gmsActive: 1, appearances: 1,
        },
        eligibleGameCount: 1, appearanceGameCount: 1, gamePhase: 'final',
      }, {
        entityKind: 'player', providerExternalId: 'scoped-player-zero', nflGameId: gameId,
        nflTeam: 'NE', position: 'WR', stats: { gms_active: 1, gp: 0 },
        eligibilityEvidence: { kind: 'weekly-stat', source: 'weekly-stat-provider', gmsActive: 1, appearances: 0 },
        eligibleGameCount: 1, appearanceGameCount: 0, gamePhase: 'final',
      }, ...NFL_TEAM_CODES.map((team) => {
        const playing = team === 'NE' || team === 'ATL';
        const stats: Readonly<Record<string, number>> = playing
          ? { gms_active: 1, gp: 1 } : {};
        return {
          entityKind: 'team_defense' as const,
          providerExternalId: team,
          nflGameId: playing ? gameId : null,
          nflTeam: team,
          position: 'DEF' as const,
          stats,
          eligibilityEvidence: playing
            ? {
                kind: 'weekly-stat' as const, source: 'weekly-stat-provider' as const,
                gmsActive: 1 as const, appearances: 1 as const,
              }
            : {
                kind: 'explicit-ineligible' as const, reason: 'bye' as const,
                source: 'schedule' as const, sourceRevision: 'schedule:fixture',
                observedAt: '2026-09-01T00:00:00.000Z',
                effectivePeriod: { season: DATABASE_SEASON, seasonType: 'reg' as const, week: 1 },
              },
          eligibleGameCount: playing ? 1 as const : 0 as const,
          appearanceGameCount: playing ? 1 as const : 0 as const,
          gamePhase: playing ? 'final' as const : 'unknown' as const,
        };
      })],
    };
  }

  function officialEvidence(
    points: readonly Readonly<{ sleeperPlayerId: string; points: number }>[],
  ) {
    const normalized = points.map((point) => ({
      providerExternalId: point.sleeperPlayerId, points: point.points,
    })).sort((left, right) => left.providerExternalId.localeCompare(right.providerExternalId));
    return {
      version: 'players-points-v1' as const,
      expectedRosterCount: 1,
      expectedRosterIds: ['roster-1'],
      expectedEntityCount: normalized.length,
      fingerprint: `sha256:${createHash('sha256').update(normalized
        .map((point) => `${point.providerExternalId}\u001f${String(point.points)}`).join('\n')).digest('hex')}`,
    };
  }


  function source(touchdowns = 2) {
    sequence += 1;
    return observation(touchdowns, `scoped-source-${sequence}`, new Date(capturedAt + sequence * 1000).toISOString());
  }
  async function capture(value = source()) {
    const raw = stored(await store.recordAllPlayerBatch({observation:value,scoreSets:[],fence,verifiedAt:value.observedAt}));
    const built = await buildAllPlayerScoreContent({observation:value,
      profile:{scoringProfileId:profileId,rawRules:{pass_td:4}},scorerVersion:'sleeper-actual-v1',
      supportedRuleKeys:SLEEPER_ALL_PLAYER_SCORING_RULE_KEYS,
      resolveIdentity: (entry) => ({scoringEntityId:entityIds[entry.providerExternalId],conflict:false})});
    if (built.status !== 'available') throw new Error('Scoped content unavailable');
    const content = stored(await store.recordAllPlayerScoreContent({observation:value,scoreSet:built.scoreSet,
      fence,verifiedAt:value.observedAt}));
    expect(content.statObservationId).toBe(raw.statObservationId);
    return {source:value,...content};
  }
  async function official(value: AllPlayerStatObservation, leagueIndex: number, points = value.entries[0].stats.pass_td * 4) {
    const players = [{sleeperPlayerId:'scoped-player-one',entityKind:'player' as const,
      externalRosterId:'roster-1',points,isStarter:true,lineupSlot:'QB'},
    {sleeperPlayerId:'scoped-player-zero',entityKind:'player' as const,
      externalRosterId:'roster-1',points:0,isStarter:false,lineupSlot:'BN'}];
    return stored(await store.recordLeagueWeekObservation({leagueSeasonId:leagueSeasonIds[leagueIndex],week:1,
      sourceRevision:`scoped-official:${value.sourceRevision}:${points}`,requestStartedAt:value.requestStartedAt,
      requestCompletedAt:value.requestCompletedAt,observedAt:value.observedAt,quality:'complete',
      sourceData:{source:'sleeper-matchups-players-points',allPlayerSourceRevision:value.sourceRevision,
        officialPlayersPointsEvidence:officialEvidence(players),complete:true},
      expectedTank01GameIds:['scoped-game'],playerPoints:players,
      rosterPoints:[{externalRosterId:'roster-1',points}],
    })).observationId;
  }
  async function accept(value: Awaited<ReturnType<typeof capture>>, index: number, points?: number) {
    return store.acceptAllPlayerLeagueScore({fence,statObservationId:value.statObservationId,scoreSetId:value.scoreSetId,
      leagueSeasonId:leagueSeasonIds[index],officialObservationId:await official(value.source,index,points),
      verifiedAt:value.source.observedAt});
  }
  const read = (leagueKey: string) => store.readAllPlayerPlayerMetrics({leagueKey,provider:'sleeper',season:DATABASE_SEASON,
    seasonType:'reg',throughWeek:1,provisionalWeek:null,scorerVersion:'sleeper-actual-v1'},
  (stats,rules) => scoreSparseStatistics(stats,rules,SLEEPER_ALL_PLAYER_SCORING_RULE_KEYS));

  it('saves raw data and one shared profile while a missing peer connection cannot veto healthy acceptance', async () => {
    const value = await capture();
    expect(stored(await accept(value,0)).pointerOutcome).toBe('advanced');
    await expect(accept(value,2)).rejects.toThrow();
    const rows = await ownerQuery(`SELECT (SELECT count(*) FROM all_player_stat_observations WHERE id=$1::uuid)::integer AS captures,
      (SELECT count(*) FROM all_player_score_sets WHERE id=$2::uuid)::integer AS scores,
      (SELECT count(*) FROM current_all_player_league_scores WHERE season=$3)::integer AS pointers`,
    [value.statObservationId,value.scoreSetId,DATABASE_SEASON]);
    expect(rows).toEqual([{captures:1,scores:1,pointers:1}]);
    expect((await read('scoped-missing')).metrics).toEqual([]);
    expect(await ownerQuery(`SELECT count(*)::integer AS count FROM league_source_connections
      WHERE league_season_id=$1::uuid`,[leagueSeasonIds[2]])).toEqual([{count:0}]);
  });
  it('reuses score rows across independent league parity populations and observations', async () => {
    const before = await capture();
    await accept(before,0); await accept(before,1);
    const next = await capture();
    expect(next.scoreSetId).toBe(before.scoreSetId);
    expect(next.statObservationId).not.toBe(before.statObservationId);
    expect(stored(await accept(next,0)).pointerOutcome).toBe('verified');
    expect(stored(await accept(next,1)).pointerOutcome).toBe('verified');
    expect(await ownerQuery(`SELECT count(*)::integer AS rows FROM all_player_scores WHERE all_player_score_set_id=$1::uuid`,
      [next.scoreSetId])).toEqual([{rows:34}]);
    const replay = await accept(next,1);
    expect(stored(replay).pointerOutcome).toBe('verified');
  });
  it('advances only the healthy same-profile league after a scoring correction', async () => {
    const value = await capture(source(3));
    await accept(value,0);
    await expect(accept(value,1,8)).rejects.toThrow(/parity/iu);
    const healthy = (await read('scoped-one')).metrics.find((player) => player.providerExternalId==='scoped-player-one');
    const rejected = (await read('scoped-two')).metrics.find((player) => player.providerExternalId==='scoped-player-one');
    expect(healthy?.totalFantasyPoints).toBe(12);
    expect(rejected?.totalFantasyPoints).toBe(8);
  });
  it('rejects cross-league evidence, bad generations and direct pointer/acceptance writes', async () => {
    const value = await capture(source(3));
    const input = {fence,statObservationId:value.statObservationId,scoreSetId:value.scoreSetId,
      leagueSeasonId:leagueSeasonIds[0],officialObservationId:await official(value.source,1),verifiedAt:value.source.observedAt};
    await expect(store.acceptAllPlayerLeagueScore(input)).rejects.toThrow();
    await expect(store.acceptAllPlayerLeagueScore({...input,fence:{...fence,generation:fence.generation+1}})).rejects.toThrow(/lease/iu);
    await expect(runtimeQuery('DELETE FROM current_all_player_league_scores WHERE season=$1',[DATABASE_SEASON])).rejects.toThrow(/permission/iu);
    await expect(runtimeQuery('DELETE FROM all_player_league_acceptances WHERE season=$1',[DATABASE_SEASON])).rejects.toThrow(/permission/iu);
  });
  it('seals accepted parity and preserves it through pruning', async () => {
    const value = await capture(source(3));
    const officialId = await official(value.source,0);
    await store.acceptAllPlayerLeagueScore({fence,statObservationId:value.statObservationId,scoreSetId:value.scoreSetId,
      leagueSeasonId:leagueSeasonIds[0],officialObservationId:officialId,verifiedAt:value.source.observedAt});
    await expect(ownerQuery('UPDATE official_player_point_observations SET points=999 WHERE league_week_observation_id=$1::uuid',
      [officialId])).rejects.toThrow(/immutable/iu);
    await expect(ownerQuery('DELETE FROM all_player_league_acceptances WHERE official_observation_id=$1::uuid',
      [officialId])).rejects.toThrow(/immutable/iu);
    await store.pruneHistory({before:new Date(Date.now()+1000).toISOString()});
    expect(await ownerQuery('SELECT count(*)::integer AS count FROM league_week_observations WHERE id=$1::uuid',[officialId]))
      .toEqual([{count:1}]);
  });

  it('retains a newer league pointer when older verified data arrives and rejects equal-time conflicts', async () => {
    const current = await capture(source(3));
    await accept(current,0);
    const older = await capture(observation(2,'scoped-superseded',new Date(capturedAt-2000).toISOString()));
    expect(stored(await accept(older,0)).pointerOutcome).toBe('superseded');
    const conflict = await capture(observation(4,'scoped-equal-time-conflict',current.source.observedAt));
    await expect(accept(conflict,0)).rejects.toThrow(/equal observation time/iu);
    expect((await read('scoped-one')).metrics.find((player) => player.providerExternalId==='scoped-player-one')?.totalFantasyPoints).toBe(12);
  });

  it('denies a direct runtime forged material set with incomplete physical scores', async () => {
    const value = await capture(source(3));
    const forged = await runtimeQuery<{id:string}>(`INSERT INTO all_player_score_sets (
      id,all_player_stat_content_id,provider,season,season_type,week,scoring_profile_id,scorer_version,
      semantic_hash,quality,scored_entity_count,eligible_game_count,parity_comparison_count,parity_mismatch_count,coverage,warnings
    ) SELECT gen_random_uuid(),all_player_stat_content_id,provider,season,season_type,week,scoring_profile_id,scorer_version,
      repeat('f',64),quality,0,0,0,0,coverage,warnings FROM all_player_score_sets WHERE id=$1::uuid RETURNING id::text`,[value.scoreSetId]);
    const officialId = await official(value.source,0);
    await expect(store.acceptAllPlayerLeagueScore({fence,statObservationId:value.statObservationId,scoreSetId:forged[0].id,
      leagueSeasonId:leagueSeasonIds[0],officialObservationId:officialId,verifiedAt:value.source.observedAt}))
      .rejects.toThrow(/not acceptance eligible/iu);
  });

  // Owner-only fixture renewal avoids waiting an hour or changing the request-budget implementation.
  async function renewFixtureAttempt() {
    const deadlineAt = new Date(Date.now()+3_500_000).toISOString();
    const leaseUntil = new Date(Date.now()+3_600_000).toISOString();
    const rows = await ownerQuery<{generation:number}>(`UPDATE projection_jobs SET state='running',
      lease_owner=$1,lease_until=$2::timestamptz,attempt_count=attempt_count+1,completed_at=NULL,
      payload=payload || jsonb_build_object('deadlineAt',$3::text,'requestGeneration',attempt_count+1)
      WHERE job_key='all-player-ingestion:sleeper' RETURNING attempt_count AS generation`,
    [fence.workerId,leaseUntil,deadlineAt]);
    fence = {...fence,generation:rows[0].generation,leaseUntil,deadlineAt};
    expect(await store.validateAllPlayerJobFence(fence)).toBe(true);
  }

  it('finishes a complete shared capture with one accepted league and keeps only the global request cadence', async () => {
    const value = await capture(source(4));
    await accept(value,0);
    await expect(accept(value,1,8)).rejects.toThrow(/parity/iu);
    const completion = {fence,outcome:'published' as const,scopedCapture:{statObservationId:value.statObservationId},
      diagnostic:{stage:'completed',acceptedLeagueCount:999,failedLeagueCount:1}};
    expect(await store.finishAllPlayerJob(completion)).toBe(true);
    const state = await store.readAllPlayerJobState();
    expect(state?.state).toBe('completed');
    expect(state?.payload.lastOutcome).toMatchObject({outcome:'captured',acceptedLeagueCount:1,
      acceptedProfileCount:1,finalCoverage:true,observationId:value.statObservationId});
    expect(await ownerQuery(`SELECT (payload->>'nextAttemptAt')::timestamptz
      = public.all_player_next_request_at(payload) AS budget_only FROM projection_jobs
      WHERE job_key='all-player-ingestion:sleeper'`)).toEqual([{budget_only:true}]);
    expect(await store.finishAllPlayerJob(completion)).toBe(false);
    const oldFence = fence;
    await renewFixtureAttempt();
    expect(await store.finishAllPlayerJob({...completion,fence:oldFence})).toBe(false);
  });

  it('retains the newer final capture history through partial and older complete attempts', async () => {
    const before = await store.readAllPlayerJobState();
    const priorFinal = (before?.payload.periodHistory as Array<Record<string,unknown>>)[0];
    expect(priorFinal.finalCoverage).toBe(true);
    const full = source(4);
    const partial: AllPlayerStatObservation = {...full,quality:'partial',coverage:{...full.coverage,complete:false,
      scheduleFinalityComplete:false}};
    const raw = stored(await store.recordAllPlayerBatch({observation:partial,scoreSets:[],fence,verifiedAt:partial.observedAt}));
    expect(await store.finishAllPlayerJob({fence,outcome:'partial',scopedCapture:{statObservationId:raw.statObservationId},
      diagnostic:{stage:'partial'}})).toBe(true);
    const afterPartial = await store.readAllPlayerJobState();
    expect((afterPartial?.payload.periodHistory as Array<Record<string,unknown>>)[0])
      .toMatchObject({observationId:priorFinal.observationId,finalCoverage:true,lastAttempt:{outcome:'partial'}});
    await renewFixtureAttempt();
    const older = observation(2,'scoped-older-final',new Date(capturedAt-1000).toISOString());
    const oldCapture = await capture(older);
    expect(await store.finishAllPlayerJob({fence,outcome:'published',scopedCapture:{statObservationId:oldCapture.statObservationId},
      diagnostic:{stage:'completed'}})).toBe(true);
    const afterOlder = await store.readAllPlayerJobState();
    expect((afterOlder?.payload.periodHistory as Array<Record<string,unknown>>)[0])
      .toMatchObject({observationId:priorFinal.observationId,finalCoverage:true});
  });

  it('completes a proven shared pregame empty response without league registrations and rejects invalid or started-game proof', async () => {
    await renewFixtureAttempt();
    const emptySeason = 2192;
    const now = Date.now();
    const firstKickoffAt = new Date(now+3_600_000).toISOString();
    await ownerQuery(`UPDATE projection_jobs SET payload=payload || jsonb_build_object('mode','recurring',
      'period',jsonb_build_object('season',$1::integer,'seasonType','reg','week',1))
      WHERE job_key='all-player-ingestion:sleeper'`,[emptySeason]);
    await ownerQuery("INSERT INTO leagues(league_key,name) VALUES('scoped-empty-missing','Scoped empty missing registration')");
    await enrollIntegrationSeason(ownerQuery,['scoped-empty-missing'],emptySeason);
    const emptyGame = stored(await store.upsertNflGames([{key:'scoped-empty-game',provider:'tank01',externalGameId:'scoped-empty-game',
      season:emptySeason,seasonType:'reg',week:1,homeTeam:'NE',awayTeam:'ATL',kickoffAt:firstKickoffAt}]))[0].gameId;
    const diagnostic = {
      reason:'no-statistics-yet',stage:'no-statistics-yet',period:{season:emptySeason,seasonType:'regular',week:1},
      finalCoverage:false,retryDisposition:'global-budget',entryCount:0,scoringProfileCount:0,
      responseEvidence:{bodyShape:'object',topLevelCount:0,httpStatus:200,bodyHash:`sha256:${'a'.repeat(64)}`,
        requestStartedAt:new Date(now-1000).toISOString(),requestCompletedAt:new Date(now-500).toISOString()},
      pregameEvidence:{policy:'exact-period-shared-pregame-v1',verifiedAt:new Date(now).toISOString(),scheduledGameCount:1,
        scheduleRevision:`sha256:${'b'.repeat(64)}`,firstKickoffAt},
    };
    const finish = (proof: typeof diagnostic) => store.finishAllPlayerJob({fence,outcome:'no-statistics-yet',
      sharedPregame:true,diagnostic:proof});
    expect(await finish({...diagnostic,responseEvidence:{...diagnostic.responseEvidence,topLevelCount:1}})).toBe(false);
    expect(await finish({...diagnostic,pregameEvidence:{...diagnostic.pregameEvidence,
      verifiedAt:new Date(now-91_000).toISOString()}})).toBe(false);
    await ownerQuery('UPDATE nfl_games SET kickoff_at=$2::timestamptz WHERE id=$1::uuid',[emptyGame,new Date(now-1000).toISOString()]);
    expect(await finish(diagnostic)).toBe(false);
    await ownerQuery('UPDATE nfl_games SET kickoff_at=$2::timestamptz WHERE id=$1::uuid',[emptyGame,firstKickoffAt]);
    expect(await ownerQuery('SELECT count(*)::integer AS count FROM league_seasons WHERE season=$1',[emptySeason]))
      .toEqual([{count:0}]);
    expect(await finish(diagnostic)).toBe(true);
    const completed = await store.readAllPlayerJobState();
    expect(completed?.payload.lastOutcome).toMatchObject({outcome:'no-statistics-yet'});
    expect(await finish(diagnostic)).toBe(false);
  });

});
