import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import {
  createProjectionStore,
  type PersistenceOutcome,
  type ProjectionStore,
} from '../lib/projection-store';
import { buildAllPlayerScoreSets, type AllPlayerStatObservation } from '../lib/projections/domain/all-player-statistics';
import { NFL_TEAM_CODES } from '../lib/projections/domain/contracts';
import { SLEEPER_ALL_PLAYER_SCORING_RULE_KEYS } from '../lib/projections/adapters/sleeper/scoring-profile';
import { rulesHash } from '../lib/projections/adapters/neon/database-values';
import {
  createIndependentDatabase,
  ownerQuery,
  runtimeQuery,
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

  beforeAll(async () => {
    database = createIndependentDatabase();
    store = createProjectionStore(database.database);
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
        nflTeam: 'NE', position: 'WR', stats: { gms_active: 1 },
        eligibilityEvidence: { kind: 'weekly-stat', source: 'weekly-stat-provider', gmsActive: 1 },
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
              },
          eligibleGameCount: playing ? 1 as const : 0 as const,
          appearanceGameCount: playing ? 1 as const : 0 as const,
          gamePhase: playing ? 'final' as const : 'unknown' as const,
        };
      })],
    };
  }

  async function batch(source: AllPlayerStatObservation, verifiedAt = source.observedAt) {
    const officialPointsByProfile = [4, 6].map((weight) => [
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
        expectedTank01GameIds: ['integration-all-player-game'],
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
    const built = await buildAllPlayerScoreSets({
      observation: source, scorerVersion: 'sleeper-actual-v1',
      expectedScoringProfileIds: profileIds,
      supportedRuleKeys: SLEEPER_ALL_PLAYER_SCORING_RULE_KEYS,
      resolveIdentity: (entry) => ({
        scoringEntityId: entityIds[entry.providerExternalId] ?? null,
        conflict: false,
      }),
      profiles: [{
        scoringProfileId: profileIds[0], rawRules: { pass_td: 4 },
        officialBatches: [officialBatch(
          officialObservations[0].observationId, officialPointsByProfile[0],
        )],
      }, {
        scoringProfileId: profileIds[1], rawRules: { pass_td: 6 },
        officialBatches: [officialBatch(
          officialObservations[1].observationId, officialPointsByProfile[1],
        )],
      }],
    });
    if (built.status !== 'available') throw new Error(`Batch fixture failed: ${built.reason}`);
    return { observation: source, scoreSets: built.scoreSets, verifiedAt };
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
      }),
      {
        provider: 'tank01', entityKind: 'player', externalId: 'unresolved-free-agent',
        scoringEntityId: null, mappedEntityKind: null,
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
      ) SELECT id, 'player', 'wrong-week-game', $1::uuid, 'NE', 'QB', '{}'::jsonb,
        '{"kind":"weekly-stat","source":"weekly-stat-provider","gmsActive":1}'::jsonb,
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
    await expect(runtimeQuery(`
      SELECT public.advance_current_all_player_score_set(
        score_set.provider, score_set.season, score_set.season_type, score_set.week,
        score_set.scoring_profile_id, score_set.scorer_version, $2::uuid,
        score_set.id, now()
      ) FROM all_player_score_sets score_set WHERE score_set.id = $1::uuid
    `, [forged.id, before.observation_id]))
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
    await expect(runtimeQuery(`
      SELECT public.advance_current_all_player_score_set(
        score_set.provider, score_set.season, score_set.season_type, score_set.week,
        score_set.scoring_profile_id, score_set.scorer_version, $2::uuid,
        score_set.id, now()
      ) FROM all_player_score_sets score_set WHERE score_set.id = $1::uuid
    `, [inserted[0], byProfile.get(profileIds[0])?.observation_id]))
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
      all_player_score_set_id: string; scoring_profile_id: string;
    }>(`
      SELECT all_player_score_set_id::text, scoring_profile_id::text
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
    await expect(runtimeQuery(`
      SELECT public.advance_current_all_player_score_set(
        score_set.provider, score_set.season, score_set.season_type, score_set.week,
        score_set.scoring_profile_id, score_set.scorer_version, observation.id,
        score_set.id, observation.observed_at + interval '1 minute'
      )
      FROM all_player_score_sets score_set
      JOIN all_player_stat_observations observation
        ON observation.all_player_stat_content_id = score_set.all_player_stat_content_id
      WHERE score_set.id = $1::uuid
      ORDER BY observation.observed_at DESC LIMIT 1
    `, [forged.score_set_id])).rejects.toThrow(/not publication eligible/iu);
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
    const [left, right] = await Promise.all([
      store.recordAllPlayerBatch(await batch(concurrent)),
      store.recordAllPlayerBatch(await batch(concurrent)),
    ]);
    const outcomes = [stored(left), stored(right)]
      .flatMap((value) => value.scoreSets.map((set) => set.pointerOutcome));
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

    const readiness = await ownerQuery<{ ready: boolean }>(`
      SELECT public.all_player_score_set_is_publication_ready(
        candidate.id, $3::jsonb
      ) AS ready
      FROM (VALUES ($1::uuid), ($2::uuid)) candidate(id)
      ORDER BY candidate.id
    `, [inserted[0], inserted[1], JSON.stringify([...profileIds].sort())]);
    expect(readiness).toEqual([{ ready: true }, { ready: true }]);

    await expect(runtimeQuery(`
      SELECT public.advance_current_all_player_score_set(
        score_set.provider, score_set.season, score_set.season_type, score_set.week,
        score_set.scoring_profile_id, score_set.scorer_version, $2::uuid,
        score_set.id, now()
      ) FROM all_player_score_sets score_set WHERE score_set.id = $1::uuid
    `, [inserted[0], next.statObservationId]))
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

  it('keeps the pre-010 application store compatible with the expanded schema', async () => {
    await expect(store.registerLeagueSeason({
      leagueKey: 'all-player-old-app-compatibility', leagueName: 'Old App Compatibility',
      season: 2026, sleeperLeagueId: 'all-player-old-app-compatibility',
      scoringRules: { pass_td: 4, pass_yd: 0.04 },
    })).resolves.toMatchObject({ kind: 'stored' });
  });
});
