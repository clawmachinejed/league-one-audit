import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import {
  createProjectionStore,
  type PersistenceOutcome,
  type ProjectionStore,
} from '../lib/projection-store';
import { buildAllPlayerScoreSets, type AllPlayerScoringProfile, type AllPlayerStatObservation }
  from '../lib/projections/domain/all-player-statistics';
import { NFL_TEAM_CODES } from '../lib/projections/domain/contracts';
import { SLEEPER_ALL_PLAYER_SCORING_RULE_KEYS } from '../lib/projections/adapters/sleeper/scoring-profile';
import type { AllPlayerJobFence } from '../lib/projections/adapters/neon/contracts';
import { measuredAllPlayerStore, measureRetainedPartialHistory } from './all-player-capacity-measurement';
import { verifyAllPlayerJobRecovery, verifyAllPlayerPreclaimDiagnostics } from './all-player-job-recovery-fixture';
import { runSyntheticCompleteCapacity } from './all-player-synthetic-capacity';
import { rulesHash } from '../lib/projections/adapters/neon/database-values';
import {
  createIndependentDatabase,
  ownerQuery,
  runtimeQuery as unfencedRuntimeQuery,
  type IndependentDatabase,
} from './neon-integration-harness';

const DATABASE_SEASON = 2199;
const LEAGUE_ONE_TWO_2024_TO_2026_ACTIVE_RULES = {
  sack: 1, pass_int: -2, pts_allow_0: 10, pass_2pt: 2, st_td: 6,
  fgm_yds_over_30: 0.1, rec_td: 6, rush_td: 6, def_4_and_stop: 1,
  pass_td_40p: 1, fgm: 3, rec_2pt: 2, rec: 0.5, pts_allow_14_20: 1,
  def_2pt: 2, int: 2, def_st_fum_rec: 2, fum_lost: -2, pts_allow_1_6: 7,
  xpm: 1, def_3_and_out: 0.5, rush_2pt: 2, fum_rec: 2, def_st_td: 6,
  def_td: 6, rec_td_40p: 1, safe: 2, pass_yd: 0.04, blk_kick: 2,
  pass_td: 6, rush_yd: 0.1, pts_allow_28_34: -1, pts_allow_35p: -4,
  fum_rec_td: 6, rec_yd: 0.1, rush_td_40p: 1, pts_allow_7_13: 4,
} as const;

function stored<Value>(value: PersistenceOutcome<Value>): Value {
  if (value.kind !== 'stored') throw new Error('The integration store is disabled.');
  return value.value as Value;
}

describe('all-player statistics foundation', () => {
  let database: IndependentDatabase;
  let store: ProjectionStore;
  let gameId: string;
  let wrongWeekGameId: string;
  let entityIds: Readonly<Record<string, string>>;
  let leagueSeasonIds: readonly string[];
  let profileIds: readonly string[];
  let profileWeights: readonly number[] = [4,6];
  let parityExternalGameId = 'integration-all-player-game';
  let fence: AllPlayerJobFence;
  let forgedObservationSequence = 0;

  async function addForgedSetVerifications(scoreSetIds: readonly string[], sourceObservationId: string) {
    // A separate immutable observation avoids conflicting with the original
    // observation/profile verification. All material lineage remains valid so
    // the deliberately forged profile/count condition reaches publication.
    forgedObservationSequence += 1;
    const observationId = (await runtimeQuery<{ id: string }>(`INSERT INTO all_player_stat_observations (
      id,all_player_stat_content_id,provider,season,season_type,week,normalizer_version,
      source_revision,request_started_at,request_completed_at,observed_at,quality
    ) SELECT gen_random_uuid(),all_player_stat_content_id,provider,season,season_type,week,
      normalizer_version,source_revision,request_started_at,request_completed_at,
      observed_at + ($2::integer * interval '1 second'),quality
      FROM all_player_stat_observations WHERE id=$1::uuid RETURNING id::text`,
    [sourceObservationId, 60 + forgedObservationSequence]))[0].id;
    await runtimeQuery(`INSERT INTO all_player_score_verifications (
      all_player_stat_observation_id,all_player_score_set_id,scoring_profile_id,coverage
    ) SELECT $1::uuid,id,scoring_profile_id,coverage FROM all_player_score_sets
      WHERE id=ANY($2::uuid[])`, [observationId, scoreSetIds]);
    return observationId;
  }

  // Existing SQL invariants must be exercised with valid live ownership, so a
  // missing-fence rejection cannot accidentally mask a parity/count failure.
  async function runtimeQuery<Row extends Record<string, unknown> = Record<string, unknown>>(
    statement: string, parameters: readonly unknown[] = [],
  ): Promise<readonly Row[]> {
    const marker = 'public.advance_current_all_player_score_set(';
    const start = statement.indexOf(marker);
    if (start >= 0) {
      let depth = 1;
      let end = start + marker.length;
      while (depth > 0 && end < statement.length) {
        if (statement[end] === '(') depth += 1;
        if (statement[end] === ')') depth -= 1;
        end += 1;
      }
      statement = statement.slice(0, end - 1) + `, $${parameters.length + 1}::jsonb`
        + statement.slice(end - 1);
      parameters = [...parameters, JSON.stringify(fence)];
    }
    return unfencedRuntimeQuery<Row>(statement, parameters);
  }

  beforeAll(async () => {
    database = createIndependentDatabase();
    store = createProjectionStore(database.database);
    await ownerQuery("DELETE FROM projection_jobs WHERE job_key = 'all-player-ingestion:sleeper'");
    const claim = await store.acquireAllPlayerJob({ mode: 'backfill',
      period: { season: DATABASE_SEASON, seasonType: 'reg', week: 1 },
      workerId: 'all-player-integration', leaseSeconds: 3600,
      deadlineAt: new Date(Date.now() + 3_500_000).toISOString(),
    });
    if (claim.kind !== 'acquired') throw new Error('Integration all-player lease could not be claimed.');
    fence = claim.fence;
    if (!await store.markAllPlayerRequest({ fence,
      period: { season: DATABASE_SEASON, seasonType: 'reg', week: 1 },
    })) throw new Error('Integration request could not be budgeted.');
    const leagueOne = stored(await store.registerLeagueSeason({
      leagueKey: 'league1', leagueName: 'All Player One', season: DATABASE_SEASON,
      sleeperLeagueId: 'all-player-integration-one', scoringRules: { pass_td: 4 },
    }));
    const leagueTwo = stored(await store.registerLeagueSeason({
      leagueKey: 'league2', leagueName: 'All Player Two', season: DATABASE_SEASON,
      sleeperLeagueId: 'all-player-integration-two', scoringRules: { pass_td: 6 },
    }));
    leagueSeasonIds = [leagueOne.leagueSeasonId, leagueTwo.leagueSeasonId];
    profileIds = [leagueOne.scoringProfileId, leagueTwo.scoringProfileId];
    await ownerQuery(`INSERT INTO league_period_authorities (
      league_key, default_season, default_season_type, default_week, active_season,
      active_season_type, active_week, league_lifecycle, nfl_phase, source_provider,
      source_revision, source_observed_at, verified_at, source_external_league_id,
      expected_roster_count, expected_starter_slot_count, expected_roster_ids
    ) VALUES
      ('league1', $1, 'reg', 1, $1, 'reg', 1, 'active', 'regular', 'sleeper',
        'all-player-authority-one', now(), now(), 'all-player-integration-one', 1, 1,
        ARRAY['roster-1']),
      ('league2', $1, 'reg', 1, $1, 'reg', 1, 'active', 'regular', 'sleeper',
        'all-player-authority-two', now(), now(), 'all-player-integration-two', 1, 1,
        ARRAY['roster-1'])
      ON CONFLICT (league_key) DO UPDATE SET
        default_season = EXCLUDED.default_season,
        default_season_type = EXCLUDED.default_season_type,
        default_week = EXCLUDED.default_week,
        active_season = EXCLUDED.active_season,
        active_season_type = EXCLUDED.active_season_type,
        active_week = EXCLUDED.active_week,
        league_lifecycle = EXCLUDED.league_lifecycle,
        nfl_phase = EXCLUDED.nfl_phase,
        source_provider = EXCLUDED.source_provider,
        source_revision = EXCLUDED.source_revision,
        source_observed_at = EXCLUDED.source_observed_at,
        verified_at = EXCLUDED.verified_at,
        source_external_league_id = EXCLUDED.source_external_league_id,
        expected_roster_count = EXCLUDED.expected_roster_count,
        expected_starter_slot_count = EXCLUDED.expected_starter_slot_count,
        expected_roster_ids = EXCLUDED.expected_roster_ids`, [DATABASE_SEASON]);
    const entities = stored(await store.upsertScoringEntities([
      {
        key: 'integration-player-one', kind: 'player', displayName: 'Player One', nflTeam: 'NE',
        providerIds: [{ provider: 'sleeper', externalId: 'integration-player-one' }],
      },
      {
        key: 'integration-player-zero', kind: 'player', displayName: 'Player Zero', nflTeam: 'NE',
        providerIds: [{ provider: 'sleeper', externalId: 'integration-player-zero' }],
      },
      ...NFL_TEAM_CODES.map((team) => ({
        key: team, kind: 'team_defense' as const, displayName: `${team} D/ST`, nflTeam: team,
        providerIds: [{ provider: 'sleeper', externalId: team }],
      })),
    ]));
    entityIds = Object.fromEntries(entities.map((entity) => {
      if (!entity.entityId || entity.conflict) throw new Error('Integration identity failed.');
      return [entity.key, entity.entityId];
    }));
    const games = stored(await store.upsertNflGames([{
      key: 'integration-all-player-game', provider: 'tank01',
      externalGameId: 'integration-all-player-game', season: DATABASE_SEASON,
      seasonType: 'reg', week: 1,
      homeTeam: 'NE', awayTeam: 'ATL', kickoffAt: '2026-09-13T17:00:00.000Z',
    }, {
      key: 'integration-all-player-wrong-week-game', provider: 'tank01',
      externalGameId: 'integration-all-player-wrong-week-game',
      season: DATABASE_SEASON, seasonType: 'reg', week: 2,
      homeTeam: 'NE', awayTeam: 'ATL', kickoffAt: '2026-09-20T17:00:00.000Z',
    }]));
    gameId = games[0].gameId;
    wrongWeekGameId = games[1].gameId;
  });

  afterAll(async () => database.close());

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
            'integration-player-one': 'NE', 'integration-player-zero': 'NE',
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
        entityKind: 'player', providerExternalId: 'integration-player-one', nflGameId: gameId,
        nflTeam: 'NE', position: 'QB', stats: { gms_active: 1, gp: 1, pass_td: passTouchdowns },
        eligibilityEvidence: {
          kind: 'weekly-stat', source: 'weekly-stat-provider', gmsActive: 1, appearances: 1,
        },
        eligibleGameCount: 1, appearanceGameCount: 1, gamePhase: 'final',
      }, {
        entityKind: 'player', providerExternalId: 'integration-player-zero', nflGameId: gameId,
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

  async function batch(source: AllPlayerStatObservation, verifiedAt = source.observedAt) {
    const officialPointsByProfile = profileWeights.map((weight) => [
      {
        sleeperPlayerId: 'integration-player-one', entityKind: 'player' as const,
        externalRosterId: 'roster-1', points: source.entries[0].stats.pass_td * weight,
        isStarter: true, lineupSlot: 'QB',
      },
      {
        sleeperPlayerId: 'integration-player-zero', entityKind: 'player' as const,
        externalRosterId: 'roster-1', points: 0, isStarter: false, lineupSlot: 'BN',
      },
    ]);
    const officialObservations = await Promise.all(leagueSeasonIds.map(async (leagueSeasonId, index) => {
      const official = stored(await store.recordLeagueWeekObservation({
        leagueSeasonId, week: 1,
        sourceRevision: `all-player-parity:${source.sourceRevision}`,
        requestStartedAt: source.requestStartedAt,
        requestCompletedAt: source.requestCompletedAt,
        observedAt: source.observedAt,
        quality: 'complete',
        sourceData: {
          source: 'sleeper-matchups-players-points',
          allPlayerSourceRevision: source.sourceRevision,
          officialPlayersPointsEvidence: officialEvidence(officialPointsByProfile[index]),
          complete: true,
        },
        expectedTank01GameIds: [parityExternalGameId],
        playerPoints: officialPointsByProfile[index],
        rosterPoints: [{
          externalRosterId: 'roster-1',
          points: officialPointsByProfile[index].reduce((total, point) => total + point.points, 0),
        }],
      }));
      expect(official).toMatchObject({
        playerPointsStored: 2, rosterPointsStored: 1,
        unmappedSleeperPlayerIds: [], unmappedTank01GameIds: [],
      });
      return official;
    }));
    const groupedProfiles = new Map<string, AllPlayerScoringProfile>();
    profileIds.forEach((profileId,index) => {
      const previous = groupedProfiles.get(profileId);
      groupedProfiles.set(profileId, { scoringProfileId:profileId,
        rawRules:{pass_td:profileWeights[index]}, officialBatches:[...(previous?.officialBatches ?? []),
          officialBatch(officialObservations[index].observationId,officialPointsByProfile[index])] });
    });
    const built = await buildAllPlayerScoreSets({
      observation: source, scorerVersion: 'sleeper-actual-v1',
      expectedScoringProfileIds: [...new Set(profileIds)],
      supportedRuleKeys: SLEEPER_ALL_PLAYER_SCORING_RULE_KEYS,
      resolveIdentity: (entry) => ({
        scoringEntityId: entityIds[entry.providerExternalId] ?? null,
        conflict: false,
      }),
      profiles: [...groupedProfiles.values()],
    });
    if (built.status !== 'available') throw new Error(`Batch fixture failed: ${built.reason}`);
    return { observation: source, scoreSets: built.scoreSets, verifiedAt, fence };
  }

  function officialBatch(
    observationId: string,
    points: readonly Readonly<{ sleeperPlayerId: string; points: number }>[],
  ) {
    const normalized = points.map((point) => ({
      providerExternalId: point.sleeperPlayerId, points: point.points,
    })).sort((left, right) => left.providerExternalId.localeCompare(right.providerExternalId));
    const evidence = officialEvidence(points);
    return {
      observationId,
      rosterCount: evidence.expectedRosterCount,
      rosterIds: evidence.expectedRosterIds,
      entityCount: evidence.expectedEntityCount,
      fingerprint: evidence.fingerprint,
      points: normalized,
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

  it('reads canonical profiles, identities, game context, and runtime database identity', async () => {
    await expect(store.readAllPlayerLeagueProfiles({
      season: DATABASE_SEASON, provider: 'sleeper',
      leagues: [{
        leagueKey: 'league1', externalLeagueId: 'all-player-integration-one',
        rulesHash: rulesHash({ pass_td: 4 }),
      }, {
        leagueKey: 'league2', externalLeagueId: 'all-player-integration-two',
        rulesHash: rulesHash({ pass_td: 6 }),
      }],
    })).resolves.toEqual([
      expect.objectContaining({
        leagueKey: 'league1', leagueSeasonId: leagueSeasonIds[0],
        scoringProfileId: profileIds[0], rules: { pass_td: 4 },
      }),
      expect.objectContaining({
        leagueKey: 'league2', leagueSeasonId: leagueSeasonIds[1],
        scoringProfileId: profileIds[1], rules: { pass_td: 6 },
      }),
    ]);
    await expect(store.readAllPlayerIdentityMappings([{
      provider: 'sleeper', entityKind: 'player', externalId: 'integration-player-one',
    }, {
      provider: 'tank01', entityKind: 'player', externalId: 'unresolved-free-agent',
    }])).resolves.toEqual([
      expect.objectContaining({
        provider: 'sleeper', externalId: 'integration-player-one',
        scoringEntityId: entityIds['integration-player-one'], mappedEntityKind: 'player',
        mappingStatus: 'verified', validTo: null,
      }),
      {
        provider: 'tank01', entityKind: 'player', externalId: 'unresolved-free-agent',
        scoringEntityId: null, mappedEntityKind: null, mappingStatus: null, validFrom: null, validTo: null,
      },
    ]);
    await expect(store.readAllPlayerGameContext({
      season: DATABASE_SEASON, seasonType: 'reg', week: 1, gameStateProvider: 'tank01',
    })).resolves.toEqual([
      expect.objectContaining({ nflGameId: gameId, homeTeam: 'NE', awayTeam: 'ATL', phase: 'unknown' }),
    ]);
    await expect(store.readDatabaseIdentity()).resolves.toMatchObject({
      databaseName: expect.any(String), roleName: 'league_one_runtime',
    });
  });

  it('rejects forged eligibility counts and mismatched NFL game context in the database', async () => {
    await expect(runtimeQuery(`
      WITH content AS (
        INSERT INTO all_player_stat_contents (
          id, provider, season, season_type, week, normalizer_version,
          semantic_hash, quality, coverage, warnings, entry_count
        ) VALUES (
          gen_random_uuid(), 'sleeper', 2199, 'reg', 1, 'eligibility-guard-v1',
          encode(gen_random_bytes(32), 'hex'), 'partial', '{}'::jsonb, '[]'::jsonb, 1
        ) RETURNING id
      )
      INSERT INTO all_player_stat_entries (
        all_player_stat_content_id, entity_kind, provider_external_id, nfl_game_id,
        nfl_team, position, stats, eligibility_evidence, eligible_game_count,
        appearance_game_count, game_phase, ordinal
      ) SELECT id, 'player', 'forged-eligibility', $1::uuid, 'NE', 'QB', '{}'::jsonb,
        jsonb_build_object('kind', 'missing-provider-row',
          'inventoryFingerprint', 'sha256:' || repeat('a', 64)),
        1, 0, 'final', 0 FROM content
    `, [gameId])).rejects.toThrow(/eligibility evidence/iu);

    for (const [externalId, evidence] of [
      ['missing-ineligibility-source', {
        kind: 'explicit-ineligible', reason: 'bye', sourceRevision: 'schedule:fixture',
      }],
      ['malformed-combined-ineligibility', {
        kind: 'combined-ineligible',
        weekly: { kind: 'unknown-weekly-stat', source: 'weekly-stat-provider' },
        ineligibility: {
          kind: 'explicit-ineligible', reason: 'bye', sourceRevision: 'schedule:fixture',
        },
      }],
    ] as const) {
      await expect(runtimeQuery(`
        WITH content AS (
          INSERT INTO all_player_stat_contents (
            id, provider, season, season_type, week, normalizer_version,
            semantic_hash, quality, coverage, warnings, entry_count
          ) VALUES (
            gen_random_uuid(), 'sleeper', 2199, 'reg', 1, 'eligibility-null-guard-v1',
            encode(gen_random_bytes(32), 'hex'), 'partial', '{}'::jsonb, '[]'::jsonb, 1
          ) RETURNING id
        )
        INSERT INTO all_player_stat_entries (
          all_player_stat_content_id, entity_kind, provider_external_id, nfl_game_id,
          nfl_team, position, stats, eligibility_evidence, eligible_game_count,
          appearance_game_count, game_phase, ordinal
        ) SELECT id, 'player', $1, NULL, 'NE', 'QB', '{}'::jsonb,
          $2::jsonb, 0, 0, 'unknown', 0 FROM content
      `, [externalId, JSON.stringify(evidence)]))
        .rejects.toThrow(/eligibility evidence/iu);
    }

    await expect(runtimeQuery(`
      WITH content AS (
        INSERT INTO all_player_stat_contents (
          id, provider, season, season_type, week, normalizer_version,
          semantic_hash, quality, coverage, warnings, entry_count
        ) VALUES (
          gen_random_uuid(), 'sleeper', 2199, 'reg', 1, 'game-context-guard-v1',
          encode(gen_random_bytes(32), 'hex'), 'partial', '{}'::jsonb, '[]'::jsonb, 1
        ) RETURNING id
      )
      INSERT INTO all_player_stat_entries (
        all_player_stat_content_id, entity_kind, provider_external_id, nfl_game_id,
        nfl_team, position, stats, eligibility_evidence, eligible_game_count,
        appearance_game_count, game_phase, ordinal
      ) SELECT id, 'player', 'wrong-week-game', $1::uuid, 'NE', 'QB', '{"gms_active":1,"gp":0}'::jsonb,
        '{"kind":"weekly-stat","source":"weekly-stat-provider","gmsActive":1,"appearances":0}'::jsonb,
        1, 0, 'final', 0 FROM content
    `, [wrongWeekGameId])).rejects.toThrow(/content period and team/iu);
  });

  it('requires provider-validated completeness evidence for an all-player parity observation', async () => {
    await expect(store.recordLeagueWeekObservation({
      leagueSeasonId: leagueSeasonIds[0], week: 1,
      sourceRevision: 'all-player-parity:forged-subset',
      requestStartedAt: '2026-09-15T00:00:00.000Z',
      requestCompletedAt: '2026-09-15T00:00:01.000Z',
      observedAt: '2026-09-15T00:00:01.000Z', quality: 'complete',
      sourceData: {
        allPlayerSourceRevision: 'etag:forged-subset',
        officialPlayersPointsEvidence: {
          version: 'players-points-v1', expectedEntityCount: 2, expectedRosterCount: 1,
          expectedRosterIds: ['roster-1'],
          fingerprint: `sha256:${'f'.repeat(64)}`,
        },
      },
      expectedTank01GameIds: ['integration-all-player-game'],
      playerPoints: [{
        sleeperPlayerId: 'integration-player-one', entityKind: 'player',
        externalRosterId: 'roster-1', points: 4, isStarter: true, lineupSlot: 'QB',
      }],
      rosterPoints: [{ externalRosterId: 'roster-1', points: 4 }],
    })).rejects.toThrow(/provider-validated evidence/iu);
  });

  it('shares immutable raw content while separating scores by league scoring profile', async () => {
    const source = observation(1, 'etag:integration-one', '2026-09-15T00:00:01.000Z');
    const first = stored(await store.recordAllPlayerBatch(await batch(source)));
    expect(first).toMatchObject({
      entriesStored: 34, entryCount: 34,
      scoreSets: [
        { pointerOutcome: 'advanced' }, { pointerOutcome: 'advanced' },
      ],
    });
    const rows = await ownerQuery<{
      contents: number; observations: number; score_sets: number; scores: number; pointers: number;
    }>(`SELECT
      (SELECT count(*)::integer FROM all_player_stat_contents) AS contents,
      (SELECT count(*)::integer FROM all_player_stat_observations) AS observations,
      (SELECT count(*)::integer FROM all_player_score_sets) AS score_sets,
      (SELECT count(*)::integer FROM all_player_scores) AS scores,
      (SELECT count(*)::integer FROM current_all_player_score_sets) AS pointers`);
    expect(rows[0]).toEqual({ contents: 1, observations: 1, score_sets: 2, scores: 68, pointers: 2 });
    const shared = await ownerQuery<{ distinct_contents: number; distinct_profiles: number }>(`
      SELECT count(DISTINCT all_player_stat_content_id)::integer AS distinct_contents,
        count(DISTINCT scoring_profile_id)::integer AS distinct_profiles
      FROM all_player_score_sets
    `);
    expect(shared[0]).toEqual({ distinct_contents: 1, distinct_profiles: 2 });
  });

  it('rejects self-consistent official points that omit an authoritative roster', async () => {
    const current = (await runtimeQuery<{
      score_set_id: string; observation_id: string;
    }>(`SELECT all_player_score_set_id::text AS score_set_id,
        all_player_stat_observation_id::text AS observation_id
      FROM current_all_player_score_sets WHERE scoring_profile_id = $1::uuid`,
    [profileIds[0]]))[0];
    await ownerQuery(`UPDATE league_period_authorities
      SET expected_roster_count = 2, expected_roster_ids = ARRAY['roster-1','roster-2']
      WHERE league_key = 'league1'`);
    try {
      await expect(runtimeQuery(`
        SELECT public.advance_current_all_player_score_set(
          score_set.provider, score_set.season, score_set.season_type, score_set.week,
          score_set.scoring_profile_id, score_set.scorer_version, $2::uuid,
          score_set.id, now()
        ) FROM all_player_score_sets score_set WHERE score_set.id = $1::uuid
      `, [current.score_set_id, current.observation_id]))
        .rejects.toThrow(/missing a canonical scoring profile/iu);
    } finally {
      await ownerQuery(`UPDATE league_period_authorities
        SET expected_roster_count = 1, expected_roster_ids = ARRAY['roster-1']
        WHERE league_key = 'league1'`);
    }
  });

  it('enforces the scorer-version rule allowlist and preserves referenced parity evidence', async () => {
    expect((await ownerQuery<{ supported: boolean }>(`
      SELECT public.all_player_scoring_contract_supported(
        'sleeper', 'sleeper-actual-v1', $1::jsonb
      ) AS supported
    `, [JSON.stringify(LEAGUE_ONE_TWO_2024_TO_2026_ACTIVE_RULES)]))[0].supported).toBe(true);
    const unsupported = stored(await store.registerLeagueSeason({
      leagueKey: 'all-player-unsupported-rule', leagueName: 'Unsupported Rule Fixture',
      season: DATABASE_SEASON, sleeperLeagueId: 'all-player-unsupported-rule',
      scoringRules: { future_rule: 1 },
    }));
    const forgedSet = (await runtimeQuery<{ id: string }>(`
      INSERT INTO all_player_score_sets (
        id, all_player_stat_content_id, provider, season, season_type, week,
        scoring_profile_id, scorer_version, semantic_hash, quality,
        scored_entity_count, eligible_game_count, parity_comparison_count,
        parity_mismatch_count, coverage, warnings
      ) SELECT gen_random_uuid(), all_player_stat_content_id, provider, season, season_type, week,
        $1::uuid, scorer_version, encode(gen_random_bytes(32), 'hex'), quality,
        scored_entity_count, eligible_game_count, parity_comparison_count,
        parity_mismatch_count, coverage, warnings
      FROM all_player_score_sets
      WHERE scoring_profile_id = $2::uuid
      ORDER BY created_at LIMIT 1 RETURNING id::text
    `, [unsupported.scoringProfileId, profileIds[0]]))[0];
    await expect(runtimeQuery(`
      INSERT INTO all_player_scores (
        all_player_score_set_id, all_player_stat_content_id, scoring_entity_id,
        entity_kind, provider_external_id, nfl_game_id, nfl_team, position,
        fantasy_points, eligible_game_count, appearance_game_count, game_phase,
        scoring_breakdown, ordinal
      ) SELECT $1::uuid, entry.all_player_stat_content_id, $2::uuid,
        entry.entity_kind, entry.provider_external_id, entry.nfl_game_id, entry.nfl_team,
        entry.position, 0, entry.eligible_game_count, entry.appearance_game_count,
        entry.game_phase,
        '{"future_rule":{"stat":0,"weight":1,"points":0}}'::jsonb, 0
      FROM all_player_stat_entries entry
      WHERE entry.provider_external_id = 'integration-player-one'
      ORDER BY entry.created_at LIMIT 1
    `, [forgedSet.id, entityIds['integration-player-one']]))
      .rejects.toThrow(/unsupported by this scorer contract/iu);

    await expect(ownerQuery(`
      DELETE FROM official_player_point_observations point
      WHERE point.league_week_observation_id = (
        SELECT (jsonb_array_elements_text(score_set.coverage->'parity_observation_ids'))::uuid
        FROM all_player_score_sets score_set
        WHERE score_set.scoring_profile_id = $1::uuid
        ORDER BY score_set.created_at LIMIT 1
      )
    `, [profileIds[0]])).rejects.toThrow(/parity evidence is immutable/iu);

    const parityObservation = (await ownerQuery<{ observation_id: string }>(`
      SELECT jsonb_array_elements_text(score_set.coverage->'parity_observation_ids')
        AS observation_id
      FROM all_player_score_sets score_set
      WHERE score_set.scoring_profile_id = $1::uuid
      ORDER BY score_set.created_at LIMIT 1
    `, [profileIds[0]]))[0].observation_id;
    await expect(runtimeQuery(`INSERT INTO official_roster_point_observations (
      league_week_observation_id, external_roster_id, points
    ) VALUES ($1::uuid, 'roster-forged', 0)`, [parityObservation]))
      .rejects.toThrow(/parity evidence is immutable/iu);
    await expect(runtimeQuery(`INSERT INTO official_player_point_observations (
      league_week_observation_id, external_roster_id, scoring_entity_id,
      points, is_starter, lineup_slot
    ) VALUES ($1::uuid, 'roster-1', $2::uuid, 0, false, 'BN')`, [
      parityObservation, entityIds.ATL,
    ])).rejects.toThrow(/parity evidence is immutable/iu);
  });

  it('rejects a physically complete score set that omits the other canonical profile', async () => {
    const before = (await runtimeQuery<{ score_set_id: string; observation_id: string }>(`
      SELECT current.all_player_score_set_id::text AS score_set_id,
        current.all_player_stat_observation_id::text AS observation_id
      FROM current_all_player_score_sets current
      WHERE current.scoring_profile_id = $1::uuid
    `, [profileIds[0]]))[0];
    const forged = (await runtimeQuery<{ id: string }>(`
      INSERT INTO all_player_score_sets (
        id, all_player_stat_content_id, provider, season, season_type, week,
        scoring_profile_id, scorer_version, semantic_hash, quality,
        scored_entity_count, eligible_game_count, parity_comparison_count,
        parity_mismatch_count, coverage, warnings
      ) SELECT gen_random_uuid(), all_player_stat_content_id, provider, season, season_type, week,
        scoring_profile_id, scorer_version, encode(gen_random_bytes(32), 'hex'), quality,
        scored_entity_count, eligible_game_count, parity_comparison_count,
        parity_mismatch_count,
        jsonb_set(coverage, '{expected_scoring_profile_ids}',
          jsonb_build_array(scoring_profile_id::text)), warnings
      FROM all_player_score_sets WHERE id = $1::uuid RETURNING id::text
    `, [before.score_set_id]))[0];
    await runtimeQuery(`
      INSERT INTO all_player_scores (
        all_player_score_set_id, all_player_stat_content_id, scoring_entity_id,
        entity_kind, provider_external_id, nfl_game_id, nfl_team, position,
        fantasy_points, eligible_game_count, appearance_game_count, game_phase,
        scoring_breakdown, ordinal
      ) SELECT $1::uuid, all_player_stat_content_id, scoring_entity_id,
        entity_kind, provider_external_id, nfl_game_id, nfl_team, position,
        fantasy_points, eligible_game_count, appearance_game_count, game_phase,
        scoring_breakdown, ordinal
      FROM all_player_scores WHERE all_player_score_set_id = $2::uuid
    `, [forged.id, before.score_set_id]);
    const forgedObservationId = await addForgedSetVerifications([forged.id], before.observation_id);
    await expect(runtimeQuery(`
      SELECT public.advance_current_all_player_score_set(
        score_set.provider, score_set.season, score_set.season_type, score_set.week,
        score_set.scoring_profile_id, score_set.scorer_version, $2::uuid,
        score_set.id, now()
      ) FROM all_player_score_sets score_set WHERE score_set.id = $1::uuid
    `, [forged.id, forgedObservationId]))
      .rejects.toThrow(/canonical league scoring profiles/iu);
  });

  it('rejects a valid candidate paired with a correctly labelled empty peer profile', async () => {
    const current = await runtimeQuery<{
      scoring_profile_id: string; score_set_id: string; observation_id: string;
    }>(`SELECT scoring_profile_id::text, all_player_score_set_id::text AS score_set_id,
        all_player_stat_observation_id::text AS observation_id
      FROM current_all_player_score_sets ORDER BY scoring_profile_id`);
    const byProfile = new Map(current.map((row) => [row.scoring_profile_id, row]));
    const batchFingerprint = `sha256:${'9'.repeat(64)}`;
    const inserted: string[] = [];
    for (const [index, profileId] of profileIds.entries()) {
      const source = byProfile.get(profileId);
      if (!source) throw new Error('Missing current profile fixture.');
      const row = (await runtimeQuery<{ id: string }>(`
        INSERT INTO all_player_score_sets (
          id, all_player_stat_content_id, provider, season, season_type, week,
          scoring_profile_id, scorer_version, semantic_hash, quality,
          scored_entity_count, eligible_game_count, parity_comparison_count,
          parity_mismatch_count, coverage, warnings
        ) SELECT gen_random_uuid(), all_player_stat_content_id, provider, season, season_type, week,
          scoring_profile_id, scorer_version, $2, quality,
          scored_entity_count, eligible_game_count, parity_comparison_count,
          parity_mismatch_count,
          jsonb_set(coverage, '{score_batch_fingerprint}', to_jsonb($3::text)), warnings
        FROM all_player_score_sets WHERE id = $1::uuid RETURNING id::text
      `, [source.score_set_id, `${index + 7}`.repeat(64), batchFingerprint]))[0];
      inserted.push(row.id);
    }
    await runtimeQuery(`
      INSERT INTO all_player_scores (
        all_player_score_set_id, all_player_stat_content_id, scoring_entity_id,
        entity_kind, provider_external_id, nfl_game_id, nfl_team, position,
        fantasy_points, eligible_game_count, appearance_game_count, game_phase,
        scoring_breakdown, ordinal
      ) SELECT $1::uuid, all_player_stat_content_id, scoring_entity_id,
        entity_kind, provider_external_id, nfl_game_id, nfl_team, position,
        fantasy_points, eligible_game_count, appearance_game_count, game_phase,
        scoring_breakdown, ordinal
      FROM all_player_scores WHERE all_player_score_set_id = $2::uuid
    `, [inserted[0], byProfile.get(profileIds[0])?.score_set_id]);
    const forgedObservationId = await addForgedSetVerifications(inserted,
      byProfile.get(profileIds[0])!.observation_id);
    await expect(runtimeQuery(`
      SELECT public.advance_current_all_player_score_set(
        score_set.provider, score_set.season, score_set.season_type, score_set.week,
        score_set.scoring_profile_id, score_set.scorer_version, $2::uuid,
        score_set.id, now()
      ) FROM all_player_score_sets score_set WHERE score_set.id = $1::uuid
    `, [inserted[0], forgedObservationId]))
      .rejects.toThrow(/missing a canonical scoring profile/iu);
  });

  it('preserves canonical catalog metadata when a full-slate projection adds aliases', async () => {
    stored(await store.upsertScoringEntities([{
      key: 'projection-placeholder', kind: 'player', displayName: 'NE QB projection', nflTeam: 'NE',
      preserveExistingMetadata: true,
      providerIds: [
        { provider: 'sleeper', externalId: 'integration-player-one' },
        { provider: 'tank01', externalId: 'tank-integration-player-one' },
      ],
    }]));
    expect((await ownerQuery<{ display_name: string; nfl_team: string }>(`
      SELECT display_name, nfl_team FROM scoring_entities WHERE id = $1
    `, [entityIds['integration-player-one']]))[0]).toEqual({
      display_name: 'Player One', nfl_team: 'NE',
    });
  });

  it('revalidates immutable parity from score-line identities after an unrelated alias is added', async () => {
    await runtimeQuery(`INSERT INTO external_scoring_entity_ids (
      provider, entity_kind, external_id, scoring_entity_id, mapping_status
    ) VALUES ('sleeper', 'player', 'integration-player-one-alias', $1::uuid, 'verified')`, [
      entityIds['integration-player-one'],
    ]);
    const result = await runtimeQuery<{ outcome: string }>(`
      SELECT public.advance_current_all_player_score_set(
        score_set.provider, score_set.season, score_set.season_type, score_set.week,
        score_set.scoring_profile_id, score_set.scorer_version,
        current.all_player_stat_observation_id, score_set.id,
        current.observed_at + interval '1 minute'
      ) AS outcome
      FROM current_all_player_score_sets current
      JOIN all_player_score_sets score_set ON score_set.id = current.all_player_score_set_id
      WHERE current.scoring_profile_id = $1::uuid
    `, [profileIds[0]]);
    expect(result[0].outcome).toBe('verified');
  });

  it('rolls back orphan content when an observation replay conflicts', async () => {
    const before = (await ownerQuery<{ contents: number; entries: number; observations: number }>(`
      SELECT
        (SELECT count(*)::integer FROM all_player_stat_contents) AS contents,
        (SELECT count(*)::integer FROM all_player_stat_entries) AS entries,
        (SELECT count(*)::integer FROM all_player_stat_observations) AS observations
    `))[0];
    const conflicting = {
      ...observation(9, 'etag:integration-one', '2026-09-15T00:00:01.000Z'),
      quality: 'partial' as const,
      coverage: { complete: false, conflictFixture: true },
    };
    await expect(store.recordAllPlayerBatch({
      fence,
      observation: conflicting, scoreSets: [], verifiedAt: conflicting.observedAt,
    })).rejects.toThrow();
    expect((await ownerQuery<{ contents: number; entries: number; observations: number }>(`
      SELECT
        (SELECT count(*)::integer FROM all_player_stat_contents) AS contents,
        (SELECT count(*)::integer FROM all_player_stat_entries) AS entries,
        (SELECT count(*)::integer FROM all_player_stat_observations) AS observations
    `))[0]).toEqual(before);
  });

  it('rejects a forged score row whose breakdown belongs to another scoring profile', async () => {
    const source = await runtimeQuery<{ score_set_id: string }>(`
      WITH profile_sets AS (
        SELECT current.scoring_profile_id, current.all_player_score_set_id,
          (profile.rules->>'pass_td')::numeric AS pass_td
        FROM current_all_player_score_sets current
        JOIN scoring_profiles profile ON profile.id = current.scoring_profile_id
      ), target AS (
        SELECT score_set.* FROM all_player_score_sets score_set
        JOIN profile_sets ON profile_sets.all_player_score_set_id = score_set.id
        WHERE profile_sets.pass_td = 4
      ), inserted AS (
        INSERT INTO all_player_score_sets (
          id, all_player_stat_content_id, provider, season, season_type, week,
          scoring_profile_id, scorer_version, semantic_hash, quality,
          scored_entity_count, eligible_game_count, parity_comparison_count,
          parity_mismatch_count, coverage, warnings
        ) SELECT gen_random_uuid(), all_player_stat_content_id, provider, season, season_type, week,
          scoring_profile_id, scorer_version, repeat('e',64), quality,
          scored_entity_count, eligible_game_count, parity_comparison_count,
          parity_mismatch_count, coverage, warnings
        FROM target RETURNING id
      ) SELECT id::text AS score_set_id FROM inserted
    `);
    await expect(runtimeQuery(`
      INSERT INTO all_player_scores (
        all_player_score_set_id, all_player_stat_content_id, scoring_entity_id,
        entity_kind, provider_external_id, nfl_game_id, nfl_team, position,
        fantasy_points, eligible_game_count, appearance_game_count, game_phase,
        scoring_breakdown, ordinal
      ) SELECT $1::uuid, score.all_player_stat_content_id, score.scoring_entity_id,
        score.entity_kind, score.provider_external_id, score.nfl_game_id, score.nfl_team,
        score.position, score.fantasy_points, score.eligible_game_count,
        score.appearance_game_count, score.game_phase, score.scoring_breakdown, score.ordinal
      FROM all_player_scores score
      JOIN current_all_player_score_sets current
        ON current.all_player_score_set_id = score.all_player_score_set_id
      JOIN scoring_profiles profile ON profile.id = current.scoring_profile_id
      WHERE (profile.rules->>'pass_td')::numeric = 6
        AND score.provider_external_id = 'integration-player-one'
    `, [source[0].score_set_id])).rejects.toThrow(/breakdown does not match/iu);
  });

  it('rejects a forged subset before the guarded current pointer can advance', async () => {
    const before = (await runtimeQuery<{
      all_player_score_set_id: string; scoring_profile_id: string; observation_id: string;
    }>(`
      SELECT all_player_score_set_id::text, scoring_profile_id::text,
        all_player_stat_observation_id::text AS observation_id
      FROM current_all_player_score_sets
      JOIN scoring_profiles profile ON profile.id = scoring_profile_id
      WHERE (profile.rules->>'pass_td')::numeric = 4
    `))[0];
    const forged = (await runtimeQuery<{ score_set_id: string }>(`
      WITH target AS (
        SELECT score_set.* FROM all_player_score_sets score_set WHERE score_set.id = $1::uuid
      ), inserted AS (
        INSERT INTO all_player_score_sets (
          id, all_player_stat_content_id, provider, season, season_type, week,
          scoring_profile_id, scorer_version, semantic_hash, quality,
          scored_entity_count, eligible_game_count, parity_comparison_count,
          parity_mismatch_count, coverage, warnings
        ) SELECT gen_random_uuid(), all_player_stat_content_id, provider, season, season_type, week,
          scoring_profile_id, scorer_version, repeat('f',64), quality,
          1, 1, parity_comparison_count, parity_mismatch_count, coverage, warnings
        FROM target RETURNING id
      ) SELECT id::text AS score_set_id FROM inserted
    `, [before.all_player_score_set_id]))[0];
    await runtimeQuery(`
      INSERT INTO all_player_scores (
        all_player_score_set_id, all_player_stat_content_id, scoring_entity_id,
        entity_kind, provider_external_id, nfl_game_id, nfl_team, position,
        fantasy_points, eligible_game_count, appearance_game_count, game_phase,
        scoring_breakdown, ordinal
      ) SELECT $1::uuid, all_player_stat_content_id, scoring_entity_id,
        entity_kind, provider_external_id, nfl_game_id, nfl_team, position,
        fantasy_points, eligible_game_count, appearance_game_count, game_phase,
        scoring_breakdown, 0
      FROM all_player_scores
      WHERE all_player_score_set_id = $2::uuid
        AND provider_external_id = 'integration-player-one'
    `, [forged.score_set_id, before.all_player_score_set_id]);
    const forgedObservationId = await addForgedSetVerifications([forged.score_set_id], before.observation_id);
    await expect(runtimeQuery(`
      SELECT public.advance_current_all_player_score_set(
        score_set.provider, score_set.season, score_set.season_type, score_set.week,
        score_set.scoring_profile_id, score_set.scorer_version, observation.id,
        score_set.id, observation.observed_at + interval '1 minute'
      )
      FROM all_player_score_sets score_set
      JOIN all_player_stat_observations observation
        ON observation.all_player_stat_content_id = score_set.all_player_stat_content_id
      WHERE score_set.id = $1::uuid AND observation.id = $2::uuid
      ORDER BY observation.observed_at DESC LIMIT 1
    `, [forged.score_set_id, forgedObservationId])).rejects.toThrow(/not publication eligible/iu);
    expect((await runtimeQuery<{ all_player_score_set_id: string }>(`
      SELECT all_player_score_set_id::text FROM current_all_player_score_sets
      WHERE scoring_profile_id = $1::uuid
    `, [before.scoring_profile_id]))[0].all_player_score_set_id)
      .toBe(before.all_player_score_set_id);
  });

  it('replays idempotently and advances only immutable corrections', async () => {
    const source = observation(1, 'etag:integration-one', '2026-09-15T00:00:01.000Z');
    const replay = stored(await store.recordAllPlayerBatch(await batch(
      source, '2026-09-15T00:00:02.000Z',
    )));
    expect(replay.entriesStored).toBe(0);
    expect(replay.scoreSets.map((set) => set.pointerOutcome)).toEqual(['verified', 'verified']);

    const corrected = observation(2, 'etag:integration-two', '2026-09-15T00:01:01.000Z');
    const correction = stored(await store.recordAllPlayerBatch(await batch(corrected)));
    expect(correction.statContentId).not.toBe(replay.statContentId);
    expect(correction.scoreSets.map((set) => set.pointerOutcome)).toEqual(['advanced', 'advanced']);
    const points = await ownerQuery<{ weight: string; points: string }>(`
      SELECT (score.scoring_breakdown->'pass_td'->>'weight')::numeric AS weight,
        score.fantasy_points::text AS points
      FROM current_all_player_score_sets current
      JOIN all_player_scores score ON score.all_player_score_set_id = current.all_player_score_set_id
      WHERE score.provider_external_id = 'integration-player-one'
      ORDER BY weight
    `);
    expect(points).toEqual([{ weight: '4', points: '8.0000' }, { weight: '6', points: '12.0000' }]);
  });

  it('serializes concurrent replay and rolls back an equal-time conflicting correction', async () => {
    const concurrent = observation(3, 'etag:integration-three', '2026-09-15T00:02:01.000Z');
    const input = await batch(concurrent);
    const peer = createIndependentDatabase();
    const peerStore = createProjectionStore(peer.database);
    let outcomes: string[];
    try {
      const results = await Promise.allSettled([
        store.recordAllPlayerBatch(input), peerStore.recordAllPlayerBatch(input),
      ]);
      outcomes = results.flatMap((result) => {
        if (result.status !== 'fulfilled') throw result.reason;
        return stored(result.value).scoreSets.map((set) => set.pointerOutcome);
      });
    } finally { await peer.close(); }
    expect(outcomes.filter((outcome) => outcome === 'advanced')).toHaveLength(2);
    expect(outcomes.filter((outcome) => outcome === 'verified')).toHaveLength(2);

    const before = (await ownerQuery<{ contents: number; observations: number }>(`
      SELECT (SELECT count(*)::integer FROM all_player_stat_contents) AS contents,
        (SELECT count(*)::integer FROM all_player_stat_observations) AS observations
    `))[0];
    const conflict = observation(4, 'etag:integration-conflict', concurrent.observedAt);
    await expect(store.recordAllPlayerBatch(await batch(conflict)))
      .rejects.toThrow(/equal observation time/iu);
    const after = (await ownerQuery<{ contents: number; observations: number }>(`
      SELECT (SELECT count(*)::integer FROM all_player_stat_contents) AS contents,
        (SELECT count(*)::integer FROM all_player_stat_observations) AS observations
    `))[0];
    expect(after).toEqual(before);
  });

  it('retains a newer partial observation without moving either last-verified pointer', async () => {
    const before = await ownerQuery<{ scoring_profile_id: string; all_player_score_set_id: string }>(`
      SELECT scoring_profile_id::text, all_player_score_set_id::text
      FROM current_all_player_score_sets ORDER BY scoring_profile_id
    `);
    const partialSource: AllPlayerStatObservation = {
      ...observation(0, 'etag:integration-partial', '2026-09-15T00:03:01.000Z'),
      quality: 'partial',
      coverage: { complete: false, unknownEligibilityCount: 1 },
      warnings: ['unknown-eligibility:1'],
      entries: [{
        ...observation(0, 'unused', '2026-09-15T00:03:01.000Z').entries[0],
        eligibleGameCount: null,
        appearanceGameCount: null,
        eligibilityEvidence: {
          kind: 'missing-provider-row', inventoryFingerprint: `sha256:${'e'.repeat(64)}`,
        },
      }],
    };
    const retained = stored(await store.recordAllPlayerBatch({
      fence,
      observation: partialSource, scoreSets: [], verifiedAt: partialSource.observedAt,
    }));
    expect(retained.scoreSets).toEqual([]);
    expect(await ownerQuery<{ scoring_profile_id: string; all_player_score_set_id: string }>(`
      SELECT scoring_profile_id::text, all_player_score_set_id::text
      FROM current_all_player_score_sets ORDER BY scoring_profile_id
    `)).toEqual(before);
    expect((await ownerQuery<{ count: number }>(`
      SELECT count(*)::integer AS count FROM all_player_stat_observations
      WHERE source_revision = 'etag:integration-partial' AND quality = 'partial'
    `))[0].count).toBe(1);
  });

  it('rejects a cross-revision peer even when both profile sets are publication ready', async () => {
    const prior = await runtimeQuery<{
      scoring_profile_id: string; score_set_id: string; observation_id: string;
    }>(`SELECT scoring_profile_id::text, all_player_score_set_id::text AS score_set_id,
        all_player_stat_observation_id::text AS observation_id
      FROM current_all_player_score_sets ORDER BY scoring_profile_id`);
    const priorByProfile = new Map(prior.map((row) => [row.scoring_profile_id, row]));

    const nextSource = observation(
      3, 'etag:integration-cross-revision', '2026-09-15T00:04:01.000Z',
    );
    const prepared = await batch(nextSource);
    const next = stored(await store.recordAllPlayerBatch({
      fence,
      observation: nextSource, scoreSets: [], verifiedAt: nextSource.observedAt,
    }));
    expect(next.scoreSets).toEqual([]);
    const nextCoverageByProfile = new Map(prepared.scoreSets.map((set) => [
      set.scoringProfileId, set.coverage,
    ]));

    const sourceSets = [
      priorByProfile.get(profileIds[0])?.score_set_id,
      priorByProfile.get(profileIds[1])?.score_set_id,
    ];
    if (sourceSets.some((id) => !id)) throw new Error('Missing cross-revision source fixture.');
    const batchFingerprint = `sha256:${'8'.repeat(64)}`;
    const inserted: string[] = [];
    for (const [index, sourceSetId] of sourceSets.entries()) {
      const row = (await runtimeQuery<{ id: string }>(`
        INSERT INTO all_player_score_sets (
          id, all_player_stat_content_id, provider, season, season_type, week,
          scoring_profile_id, scorer_version, semantic_hash, quality,
          scored_entity_count, eligible_game_count, parity_comparison_count,
          parity_mismatch_count, coverage, warnings
        ) SELECT gen_random_uuid(), all_player_stat_content_id, provider, season, season_type, week,
          scoring_profile_id, scorer_version, $2, quality,
          scored_entity_count, eligible_game_count, parity_comparison_count,
          parity_mismatch_count,
          jsonb_set(COALESCE($4::jsonb, coverage), '{score_batch_fingerprint}',
            to_jsonb($3::text)), warnings
        FROM all_player_score_sets WHERE id = $1::uuid RETURNING id::text
      `, [sourceSetId, `${index + 5}`.repeat(64), batchFingerprint,
        index === 0 ? JSON.stringify(nextCoverageByProfile.get(profileIds[0])) : null]))[0];
      inserted.push(row.id);
      await runtimeQuery(`
        INSERT INTO all_player_scores (
          all_player_score_set_id, all_player_stat_content_id, scoring_entity_id,
          entity_kind, provider_external_id, nfl_game_id, nfl_team, position,
          fantasy_points, eligible_game_count, appearance_game_count, game_phase,
          scoring_breakdown, ordinal
        ) SELECT $1::uuid, all_player_stat_content_id, scoring_entity_id,
          entity_kind, provider_external_id, nfl_game_id, nfl_team, position,
          fantasy_points, eligible_game_count, appearance_game_count, game_phase,
          scoring_breakdown, ordinal
        FROM all_player_scores WHERE all_player_score_set_id = $2::uuid
      `, [row.id, sourceSetId]);
    }

    const verifiedObservations = [
      await addForgedSetVerifications([inserted[0]], next.statObservationId),
      await addForgedSetVerifications([inserted[1]], priorByProfile.get(profileIds[1])!.observation_id),
    ];
    const readiness = await ownerQuery<{ ready: boolean }>(`
      SELECT public.all_player_score_set_is_publication_ready(
        candidate.id, $3::jsonb, candidate.observation_id
      ) AS ready
      FROM (VALUES ($1::uuid,$4::uuid), ($2::uuid,$5::uuid)) candidate(id,observation_id)
      ORDER BY candidate.id
    `, [inserted[0], inserted[1], JSON.stringify([...profileIds].sort()), ...verifiedObservations]);
    expect(readiness).toEqual([{ ready: true }, { ready: true }]);

    await expect(runtimeQuery(`
      SELECT public.advance_current_all_player_score_set(
        score_set.provider, score_set.season, score_set.season_type, score_set.week,
        score_set.scoring_profile_id, score_set.scorer_version, $2::uuid,
        score_set.id, now()
      ) FROM all_player_score_sets score_set WHERE score_set.id = $1::uuid
    `, [inserted[0], verifiedObservations[0]]))
      .rejects.toThrow(/missing a canonical scoring profile/iu);
    expect(await runtimeQuery<{
      scoring_profile_id: string; score_set_id: string; observation_id: string;
    }>(`SELECT scoring_profile_id::text, all_player_score_set_id::text AS score_set_id,
        all_player_stat_observation_id::text AS observation_id
      FROM current_all_player_score_sets ORDER BY scoring_profile_id`)).toEqual(prior);
  });

  it('enforces append-only history and a function-only runtime pointer', async () => {
    await expect(runtimeQuery(`UPDATE all_player_stat_contents SET quality='invalid'`))
      .rejects.toThrow(/permission/iu);
    await expect(ownerQuery(`UPDATE all_player_stat_contents SET quality='invalid'`))
      .rejects.toThrow(/immutable/iu);
    await expect(runtimeQuery(`DELETE FROM all_player_scores`)).rejects.toThrow(/permission/iu);
    await expect(runtimeQuery(`INSERT INTO current_all_player_score_sets (
      provider,season,season_type,week,scoring_profile_id,scorer_version,
      all_player_stat_observation_id,all_player_score_set_id,observed_at,verified_at,material_changed_at
    ) SELECT provider,season,season_type,week,scoring_profile_id,scorer_version,
      all_player_stat_observation_id,all_player_score_set_id,observed_at,verified_at,material_changed_at
    FROM current_all_player_score_sets LIMIT 1`)).rejects.toThrow(/permission/iu);
  });

  it('rejects expired and taken-over owners before raw writes or pointer movement', async () => {
    const input = await batch(observation(4, 'etag:fence-rejected', '2026-09-15T00:10:01.000Z'));
    const before = await ownerQuery(`SELECT
      (SELECT count(*) FROM all_player_stat_observations)::integer AS observations,
      (SELECT jsonb_agg(row_to_json(pointer)) FROM current_all_player_score_sets pointer) AS pointers`);
    try {
      await ownerQuery(`UPDATE projection_jobs SET lease_until = clock_timestamp() - interval '1 second'
        WHERE job_key = $1`, [fence.jobKey]);
      expect(await store.validateAllPlayerJobFence(fence)).toBe(false);
      await expect(store.recordAllPlayerBatch(input)).rejects.toThrow(/lease|deadline/iu);
      expect(await store.finishAllPlayerJob({ fence, outcome: 'published', diagnostic: {} })).toBe(false);
      await ownerQuery(`UPDATE projection_jobs SET lease_until = $2, lease_owner = 'successor',
        attempt_count = attempt_count + 1 WHERE job_key = $1`, [fence.jobKey, fence.leaseUntil]);
      await expect(store.recordAllPlayerBatch(input)).rejects.toThrow(/lease|generation/iu);
      expect(await store.finishAllPlayerJob({ fence, outcome: 'partial', diagnostic: {} })).toBe(false);
    } finally {
      await ownerQuery(`UPDATE projection_jobs SET lease_until = $2, lease_owner = $3,
        attempt_count = $4 WHERE job_key = $1`,
      [fence.jobKey, fence.leaseUntil, fence.workerId, fence.generation]);
    }
    expect(await ownerQuery(`SELECT
      (SELECT count(*) FROM all_player_stat_observations)::integer AS observations,
      (SELECT jsonb_agg(row_to_json(pointer)) FROM current_all_player_score_sets pointer) AS pointers`))
      .toEqual(before);
  });

  it('rolls back a deadline that expires inside the SQL pointer statement', async () => {
    const source = observation(4, 'etag:deadline-rejected', '2026-09-15T00:11:01.000Z');
    const input = await batch(source);
    await ownerQuery(`CREATE SEQUENCE public.integration_all_player_delay_entered;
      CREATE FUNCTION public.integration_delay_all_player_pointer() RETURNS trigger
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
      AS $fn$ DECLARE current_fence jsonb; wait_seconds numeric; BEGIN
        current_fence := current_setting('league_one.all_player_fence')::jsonb;
        IF NOT public.all_player_job_fence_is_live(current_fence) THEN
          RAISE EXCEPTION 'delay fixture did not begin with live ownership'; END IF;
        PERFORM nextval('public.integration_all_player_delay_entered');
        wait_seconds := GREATEST(0,extract(epoch FROM
          (current_fence->>'deadlineAt')::timestamptz - clock_timestamp())) + 0.05;
        PERFORM pg_sleep(wait_seconds::double precision);
        RETURN NEW;
      END $fn$;
      CREATE TRIGGER integration_delay_all_player_pointer BEFORE INSERT ON current_all_player_score_sets
        FOR EACH ROW EXECUTE FUNCTION public.integration_delay_all_player_pointer()`);
    const deadline = new Date(Date.now() + 5_000).toISOString();
    const delayedFence = { ...fence, deadlineAt: deadline };
    await ownerQuery(`UPDATE projection_jobs SET payload = jsonb_set(payload,'{deadlineAt}',
      to_jsonb($2::text)) WHERE job_key = $1`, [fence.jobKey, deadline]);
    try {
      await expect(store.recordAllPlayerBatch({ ...input, fence: delayedFence }))
        .rejects.toThrow(/all-player lease, generation, period, request or deadline/iu);
      // nextval survives rollback; this proves SQL reached the live pointer
      // boundary before the deadline, rather than merely rejecting stale input.
      expect((await ownerQuery<{ is_called: boolean }>(
        'SELECT is_called FROM public.integration_all_player_delay_entered'))[0].is_called).toBe(true);
      expect((await ownerQuery<{ count: number }>(`SELECT count(*)::integer AS count
        FROM all_player_stat_observations WHERE source_revision = $1`, [source.sourceRevision]))[0].count).toBe(0);
    } finally {
      await ownerQuery(`DROP TRIGGER integration_delay_all_player_pointer ON current_all_player_score_sets;
        DROP FUNCTION public.integration_delay_all_player_pointer();
        DROP SEQUENCE public.integration_all_player_delay_entered`);
      await ownerQuery(`UPDATE projection_jobs SET payload = jsonb_set(payload,'{deadlineAt}',
        to_jsonb($2::text)) WHERE job_key = $1`, [fence.jobKey, fence.deadlineAt]);
    }
  });

  it('rejects malformed direct-role claims and completion without ownership tokens', async () => {
    const before = await store.readAllPlayerJobState();
    for (const value of [null, {}, { jobKey: fence.jobKey }, { ...fence, generation: null },
      { ...fence, workerId: null }, { ...fence, deadlineAt: null }]) {
      const result = await runtimeQuery<{ finished: boolean }>(
        "SELECT public.finish_all_player_job($1::jsonb,'partial','{}'::jsonb) AS finished",
        [JSON.stringify(value)]);
      expect(result[0].finished).toBe(false);
    }
    await expect(runtimeQuery(`SELECT * FROM public.claim_all_player_job(NULL,
      '{"season":2199,"seasonType":"reg","week":1}'::jsonb,'missing-mode',60,clock_timestamp()+interval '1 minute')`))
      .rejects.toThrow(/claim input/iu);
    await expect(runtimeQuery(`SELECT * FROM public.claim_all_player_job('backfill',
      '{"season":null,"seasonType":"reg","week":1}'::jsonb,'missing-season',60,clock_timestamp()+interval '1 minute')`))
      .rejects.toThrow(/claim input/iu);
    expect(await store.readAllPlayerJobState()).toEqual(before);
  });

  it('protects the durable global budget against generic runtime job mutation', async () => {
    const before = await store.readAllPlayerJobState();
    await expect(runtimeQuery("DELETE FROM projection_jobs WHERE job_key = $1", [fence.jobKey]))
      .rejects.toThrow(/dedicated job functions/iu);
    await expect(runtimeQuery("UPDATE projection_jobs SET payload = '{}'::jsonb WHERE job_key = $1", [fence.jobKey]))
      .rejects.toThrow(/dedicated job functions/iu);
    await expect(store.acquireJob({ jobKey: fence.jobKey, jobType: 'all-player-ingestion',
      workerId: 'generic-bypass', scheduledFor: new Date().toISOString(), payload: {}, leaseSeconds: 60 }))
      .rejects.toThrow(/dedicated job functions/iu);
    expect(await store.readAllPlayerJobState()).toEqual(before);
  });

  it('rejects valid raw child append to sealed partial history', async () => {
    await expect(runtimeQuery(`INSERT INTO all_player_stat_entries (
      all_player_stat_content_id, entity_kind, provider_external_id, nfl_game_id,
      nfl_team, position, stats, eligibility_evidence, eligible_game_count,
      appearance_game_count, game_phase, ordinal
    ) SELECT observation.all_player_stat_content_id, 'player', 'additional-valid-raw-player',
      NULL, NULL, 'QB', '{}'::jsonb,
      '{"kind":"unknown-weekly-stat","source":"weekly-stat-provider"}'::jsonb,
      NULL, NULL, 'unknown', 1 FROM all_player_stat_observations observation
      WHERE source_revision = 'etag:integration-partial'`)).rejects.toThrow(/sealed/iu);
  });

  it('keeps new mapping writes strict after expiry while preserving exact historical replay', async () => {
    const replay = await batch(observation(3, 'etag:integration-three', '2026-09-15T00:02:01.000Z'));
    const correction = await batch(observation(5, 'etag:expired-mapping', '2026-09-15T00:12:01.000Z'));
    await ownerQuery(`UPDATE external_scoring_entity_ids SET valid_to = clock_timestamp()
      WHERE provider = 'sleeper' AND external_id = 'integration-player-one'`);
    try {
      await expect(store.recordAllPlayerBatch(correction)).rejects.toThrow(/verified/iu);
      const unchangedNewObservation = await batch(
        observation(3, 'etag:expired-unchanged', '2026-09-15T00:12:31.000Z'));
      await expect(store.recordAllPlayerBatch(unchangedNewObservation))
        .rejects.toThrow(/canonical scoring profile|verified/iu);
      expect((await ownerQuery<{ count: number }>(`SELECT count(*)::integer AS count
        FROM all_player_stat_observations WHERE source_revision = 'etag:expired-unchanged'`))[0].count).toBe(0);
      await expect(store.recordAllPlayerBatch(replay)).resolves.toMatchObject({ kind: 'stored' });
    } finally {
      await ownerQuery(`UPDATE external_scoring_entity_ids SET valid_to = NULL
        WHERE provider = 'sleeper' AND external_id = 'integration-player-one'`);
    }
  });

  it('retains fresh parity verifications without copying unchanged score rows', async () => {
    const counts = () => ownerQuery(`SELECT
      (SELECT count(*) FROM all_player_stat_entries)::integer AS entries,
      (SELECT count(*) FROM all_player_scores)::integer AS scores,
      (SELECT count(*) FROM all_player_score_verifications)::integer AS verifications,
      (SELECT count(*) FROM all_player_stat_observations)::integer AS observations`);
    const before = (await counts())[0];
    const next = stored(await store.recordAllPlayerBatch(await batch(
      observation(3, 'etag:unchanged-later-retrieval', '2026-09-15T00:13:01.000Z'),
    )));
    const after = (await counts())[0];
    expect(next.entriesStored).toBe(0);
    expect(after).toEqual({ ...before, verifications: Number(before.verifications) + 2,
      observations: Number(before.observations) + 1 });
    expect(next.scoreSets.map((score) => score.pointerOutcome)).toEqual(['verified', 'verified']);
    const physical = await ownerQuery(`SELECT relation.relname,
      pg_relation_size(relation.oid)::text AS heap_bytes,
      pg_indexes_size(relation.oid)::text AS index_bytes,
      pg_total_relation_size(relation.oid)::text AS total_bytes
      FROM pg_class relation JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public' AND relation.relkind = 'r'
        AND relation.relname IN ('all_player_stat_contents','all_player_stat_entries',
          'all_player_stat_observations','all_player_score_sets','all_player_scores',
          'all_player_score_verifications','official_player_point_observations')
      ORDER BY relation.relname`);
    process.stdout.write(`${JSON.stringify({ kind: 'isolated-physical-measurement',
      scope: '34 synthetic entries, divergent profiles, preceding invariant fixtures',
      unchangedCounts: { before, after }, physical })}\n`);
  });

  it('preserves final capture evidence across a real takeover and failed correction', async () => {
    await verifyAllPlayerJobRecovery(store, fence);
  });

  it('enforces one global request budget across failure and different periods', async () => {
    expect(await store.markAllPlayerRequest({ fence,
      period: { season: DATABASE_SEASON, seasonType: 'reg', week: 1 },
    })).toBe(false);
    expect(await store.finishAllPlayerJob({ fence, outcome: 'provider-failed',
      diagnostic: { stage: 'weekly-stat-request', reason: 'synthetic-outage' },
    })).toBe(true);
    const result = await store.acquireAllPlayerJob({ mode: 'backfill',
      period: { season: DATABASE_SEASON, seasonType: 'reg', week: 2 },
      workerId: 'rollover-worker', leaseSeconds: 60,
      deadlineAt: new Date(Date.now() + 50_000).toISOString(),
    });
    expect(result.kind).toBe('not-due');
    const state = await store.readAllPlayerJobState();
    expect(state?.state).toBe('failed');
    expect(state?.payload.lastOutcome).toMatchObject({ outcome: 'provider-failed' });
    expect(state?.payload.requestStarts).toHaveLength(1);
  });

  it('retains bounded preclaim diagnostics without mutating live ownership or request budgets', async () => {
    await verifyAllPlayerPreclaimDiagnostics(store);
  });

  it('measures real retained partial history without publishing incomplete scores', async () => {
    const before = (await ownerQuery<{ job: Record<string, unknown> }>(
      'SELECT to_jsonb(job) AS job FROM projection_jobs job WHERE job_key=$1', [fence.jobKey]))[0].job;
    try {
      await ownerQuery('DELETE FROM projection_jobs WHERE job_key=$1', [fence.jobKey]);
      const measured = measuredAllPlayerStore(database.database);
      const claim = await measured.store.acquireAllPlayerJob({ mode:'backfill',
        period:{season:2026,seasonType:'reg',week:1},workerId:'retained-partial-capacity',
        leaseSeconds:600,deadlineAt:new Date(Date.now()+550_000).toISOString() });
      if (claim.kind !== 'acquired') throw new Error('The isolated capacity claim was not acquired.');
      expect(await measured.store.markAllPlayerRequest({ fence:claim.fence,
        period:{season:2026,seasonType:'reg',week:1} })).toBe(true);
      const result = await measureRetainedPartialHistory({ store:measured.store,
        fence:claim.fence,transportSnapshot:measured.snapshot });
      expect(result.liveProviderRequests).toBe(0);
      expect(await measured.store.finishAllPlayerJob({ fence:claim.fence,outcome:'partial',
        diagnostic:{stage:'isolated-capacity',reason:'retained-incomplete-week1'} })).toBe(true);
      process.stdout.write(`${JSON.stringify({kind:result.kind,
        artifact:'release/011-capacity.partial.integration.json',
        scenarios:result.scenarios.length, liveProviderRequests:result.liveProviderRequests})}\n`);
    } finally {
      await ownerQuery('DELETE FROM projection_jobs WHERE job_key=$1', [fence.jobKey]);
      await ownerQuery('INSERT INTO projection_jobs SELECT * FROM jsonb_populate_record(NULL::projection_jobs,$1::jsonb)',
        [JSON.stringify(before)]);
    }
  }, 120_000);

  it('keeps the pre-010 application store compatible with the expanded schema', async () => {
    await expect(store.registerLeagueSeason({
      leagueKey: 'all-player-old-app-compatibility', leagueName: 'Old App Compatibility',
      season: 2026, sleeperLeagueId: 'all-player-old-app-compatibility',
      scoringRules: { pass_td: 4, pass_yd: 0.04 },
    })).resolves.toMatchObject({ kind: 'stored' });
  });

  it('measures explicitly synthetic complete shared and divergent profiles with retained corrections', async () => {
    const saved = { store, fence, entityIds, leagueSeasonIds, profileIds, profileWeights, parityExternalGameId };
    const priorJob = (await ownerQuery<{ job: Record<string, unknown> }>(
      'SELECT to_jsonb(job) AS job FROM projection_jobs job WHERE job_key=$1', [fence.jobKey]))[0].job;
    const authorities = await ownerQuery<{ authority: Record<string, unknown> }>(
      "SELECT to_jsonb(authority) AS authority FROM league_period_authorities authority WHERE league_key IN ('league1','league2')");
    let shared = false;
    let sharedGameId = '';
    const restoreAuthorities = async () => {
      await ownerQuery("DELETE FROM league_period_authorities WHERE league_key IN ('league1','league2')");
      await ownerQuery(`INSERT INTO league_period_authorities
        SELECT * FROM jsonb_populate_recordset(NULL::league_period_authorities,$1::jsonb)`,
      [JSON.stringify(authorities.map((row) => row.authority))]);
    };
    const claimPeriod = async (season: number) => {
      await ownerQuery('DELETE FROM projection_jobs WHERE job_key=$1', [saved.fence.jobKey]);
      const claim = await store.acquireAllPlayerJob({mode:'backfill',
        period:{season,seasonType:'reg',week:1},workerId:`synthetic-capacity-${season}`,
        leaseSeconds:600,deadlineAt:new Date(Date.now()+550_000).toISOString()});
      if (claim.kind !== 'acquired') throw new Error('The isolated synthetic claim was not acquired.');
      fence = claim.fence;
      expect(await store.markAllPlayerRequest({fence,period:{season,seasonType:'reg',week:1}})).toBe(true);
    };
    try {
      const measured = measuredAllPlayerStore(database.database);
      store = measured.store;
      await claimPeriod(DATABASE_SEASON);
      const result = await runSyntheticCompleteCapacity({store,
        baseObservation:observation(3,'synthetic-capacity-base','2026-09-16T00:00:01.000Z'),
        transportSnapshot:measured.snapshot,
        addResolvedIdentities(refs) {
          entityIds = {...entityIds,...Object.fromEntries(refs.map((ref) => {
            if (!ref.entityId || ref.conflict) throw new Error('Synthetic capacity identity was unresolved.');
            return [ref.key,ref.entityId];
          }))};
        },
        async setSharedProfile(enabled) {
          shared = enabled;
          if (!enabled) {
            leagueSeasonIds=saved.leagueSeasonIds; profileIds=saved.profileIds;
            profileWeights=saved.profileWeights; parityExternalGameId=saved.parityExternalGameId;
            await restoreAuthorities();
            return;
          }
          const leagues = await Promise.all(['one','two'].map(async (suffix,index) =>
            stored(await store.registerLeagueSeason({leagueKey:`league${index+1}`,
              leagueName:`Synthetic Capacity ${suffix}`,season:2198,
              sleeperLeagueId:`synthetic-capacity-shared-${suffix}`,scoringRules:{pass_td:4}}))));
          leagueSeasonIds=leagues.map((league) => league.leagueSeasonId);
          profileIds=leagues.map((league) => league.scoringProfileId);
          profileWeights=[4,4];
          parityExternalGameId='synthetic-capacity-shared-game';
          const games=stored(await store.upsertNflGames([{key:parityExternalGameId,
            provider:'tank01',externalGameId:parityExternalGameId,season:2198,seasonType:'reg',week:1,
            homeTeam:'NE',awayTeam:'ATL',kickoffAt:'2026-09-13T17:00:00.000Z'}]));
          sharedGameId=games[0].gameId;
          await ownerQuery(`UPDATE league_period_authorities SET default_season=2198,active_season=2198,
            source_revision='synthetic-capacity-shared-authority',
            source_external_league_id=CASE league_key WHEN 'league1' THEN 'synthetic-capacity-shared-one'
              ELSE 'synthetic-capacity-shared-two' END
            WHERE league_key IN ('league1','league2')`);
          await claimPeriod(2198);
        },
        async prepareBatch(source) {
          if (!shared) return batch(source);
          const period={season:2198,seasonType:'reg' as const,week:1};
          const manifest=source.coverage.periodInventoryEvidence as Record<string,unknown>;
          return batch({...source,season:2198,coverage:{...source.coverage,
            periodInventoryEvidence:{...manifest,effectivePeriod:period}},
          entries:source.entries.map((entry) => ({...entry,nflGameId:entry.nflGameId ? sharedGameId : null,
            eligibilityEvidence:entry.eligibilityEvidence.kind === 'explicit-ineligible'
              ? {...entry.eligibilityEvidence,effectivePeriod:period} : entry.eligibilityEvidence}))});
        },
      });
      expect(result).toBeDefined();
    } finally {
      await restoreAuthorities();
      store=saved.store; fence=saved.fence; entityIds=saved.entityIds; leagueSeasonIds=saved.leagueSeasonIds;
      profileIds=saved.profileIds; profileWeights=saved.profileWeights; parityExternalGameId=saved.parityExternalGameId;
      await ownerQuery('DELETE FROM projection_jobs WHERE job_key=$1',[fence.jobKey]);
      await ownerQuery('INSERT INTO projection_jobs SELECT * FROM jsonb_populate_record(NULL::projection_jobs,$1::jsonb)',
        [JSON.stringify(priorJob)]);
    }
  },240_000);
});
