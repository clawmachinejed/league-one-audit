import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import {
  createProjectionStore,
  type PersistenceOutcome,
  type ProjectionStore,
} from '../lib/projection-store';
import { buildAllPlayerScoreSets, type AllPlayerScoringProfile, type AllPlayerStatObservation }
  from '../lib/projections/domain/all-player-statistics';
import { scoreSparseStatistics } from '../lib/projections/domain/scoring';
import { NFL_TEAM_CODES } from '../lib/projections/domain/contracts';
import { SLEEPER_ALL_PLAYER_SCORING_RULE_KEYS } from '../lib/projections/adapters/sleeper/scoring-profile';
import type { AllPlayerJobFence } from '../lib/projections/adapters/neon/contracts';
import { measuredAllPlayerStore, measureRetainedPartialHistory } from './all-player-capacity-measurement';
import { verifyAllPlayerJobRecovery, verifyAllPlayerPreclaimDiagnostics } from './all-player-job-recovery-fixture';
import { runSyntheticCompleteCapacity } from './all-player-synthetic-capacity';
import { enrollIntegrationSeason, registerEnrolledIntegrationSeason } from './administration-enrollment-fixture';
import { verifyEnrolledPublication } from './enrolled-publication-fixture';
import { rulesHash } from '../lib/projections/adapters/neon/database-values';
import { readEnrollmentInventory } from '../lib/league-administration/neon/enrollment';
import {
  createIndependentDatabase,
  createPinnedIntegrationDatabase,
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
  let initialNullPopulationProof: Readonly<{ runtimeRole: string; membershipCount: number; intendedCount: number; refusedAtomically: boolean }> | undefined;

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

    // R037 authored / unexecuted. Use the FIRST genuine marked 2199 request.
    // Configured seasons exist but have not yet been enrolled. Only this exact
    // DATA/NULL membership is intended input; no second admission or job reset.
    const runtimeRole = String((await database.database.query('SELECT session_user AS role'))[0].role);
    expect(runtimeRole).toBe('league_one_runtime');
    const officialOnly = stored(await store.registerLeagueSeason({ mode: 'official-data',
      leagueKey: 'all-null-initial-publication', leagueName: 'All NULL initial negative prerequisite',
      sleeperLeagueId: 'all-null-initial-publication', season: DATABASE_SEASON }));
    expect(officialOnly.scoringProfileId).toBeNull();
    // Owner creates enrollment metadata only, never an accepted result or credit.
    await ownerQuery(`INSERT INTO league_administration_enrollments(league_id,provider,active,evidence)
      VALUES($1,'sleeper',false,'public-data-intake-v1')`, [officialOnly.leagueId]);
    await ownerQuery(`INSERT INTO league_administration_enrollment_seasons(league_id,season,provider,evidence)
      VALUES($1,$2,'sleeper','public-data-intake-v1')`, [officialOnly.leagueId, DATABASE_SEASON]);
    const [membership] = await ownerQuery<{ total: number; intended: number }>(`SELECT count(*)::integer AS total,
      count(*) FILTER (WHERE NOT EXISTS(SELECT 1 FROM league_seasons season JOIN league_source_connections connection
        ON connection.league_season_id=season.id AND connection.provider=enrollment.provider
        WHERE enrollment.evidence='public-data-intake-v1' AND season.league_id=enrollment.league_id
          AND season.season=enrollment.season AND season.scoring_profile_id IS NULL))::integer AS intended
      FROM league_administration_enrollment_seasons enrollment WHERE season=$1 AND provider='sleeper'`, [DATABASE_SEASON]);
    expect(membership).toEqual({ total: 1, intended: 0 });
    const input = await batch(observation(1, 'all-null-initial-negative', '2026-09-15T00:00:00.000Z'));
    // Snapshot AFTER real scorer/parity prerequisites so the rejected atomic
    // writer must leave data, pointer history AND request accounting unchanged.
    const snapshotSql = `SELECT jsonb_build_object(
      'contents',(SELECT COALESCE(jsonb_agg(to_jsonb(row) ORDER BY id),'[]') FROM all_player_stat_contents row),
      'entries',(SELECT COALESCE(jsonb_agg(to_jsonb(row) ORDER BY all_player_stat_content_id,ordinal),'[]') FROM all_player_stat_entries row),
      'observations',(SELECT COALESCE(jsonb_agg(to_jsonb(row) ORDER BY id),'[]') FROM all_player_stat_observations row),
      'sets',(SELECT COALESCE(jsonb_agg(to_jsonb(row) ORDER BY id),'[]') FROM all_player_score_sets row),
      'scores',(SELECT COALESCE(jsonb_agg(to_jsonb(row) ORDER BY all_player_score_set_id,ordinal),'[]') FROM all_player_scores row),
      'verifications',(SELECT COALESCE(jsonb_agg(to_jsonb(row) ORDER BY all_player_stat_observation_id,all_player_score_set_id),'[]') FROM all_player_score_verifications row),
      'pointers',(SELECT COALESCE(jsonb_agg(to_jsonb(row) ORDER BY scoring_profile_id),'[]') FROM current_all_player_score_sets row),
      'leagueHeads',(SELECT COALESCE(jsonb_agg(to_jsonb(row) ORDER BY league_season_id),'[]') FROM current_all_player_league_scores row),
      'job',(SELECT to_jsonb(row) FROM projection_jobs row WHERE job_key=$1)) AS state`;
    const before = await ownerQuery(snapshotSql, [fence.jobKey]);
    await expect(store.recordAllPlayerBatch(input)).rejects.toMatchObject({ code: 'P0001',
      message: 'all-player score batch does not cover the canonical league scoring profiles' });
    expect(await ownerQuery(snapshotSql, [fence.jobKey])).toEqual(before);
    initialNullPopulationProof = { runtimeRole, membershipCount: membership.total,
      intendedCount: membership.intended, refusedAtomically: true };
    // Existing configured fixture begins only after the exact negative succeeds.
    await enrollIntegrationSeason(ownerQuery, ['league1', 'league2'], DATABASE_SEASON);
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

  it('refuses all-DATA/NULL publication atomically under the first genuine restricted LOGIN admission', () => {
    // This named result reports the mandatory beforeAll proof; filtering other
    // cases never bypasses its real role, candidate, error or snapshot assertions.
    expect(initialNullPopulationProof).toEqual({ runtimeRole: 'league_one_runtime',
      membershipCount: 1, intendedCount: 0, refusedAtomically: true });
  });

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

  it('uses complete owner-approved season membership without bootstrap names or later-season leakage', async () => {
    const transaction = await createPinnedIntegrationDatabase('owner');
    const saved = { store, leagueSeasonIds, profileIds, profileWeights };
    try {
      await transaction.database.query('BEGIN');
      store = createProjectionStore(transaction.database);
      const source = observation(2, 'portable-enrollment-source', '2026-09-15T00:00:02.000Z');
      await verifyEnrolledPublication({ query: transaction.database.query, store, original: await batch(source),
        async buildExpanded(league, weight) {
          leagueSeasonIds = [...saved.leagueSeasonIds, league.leagueSeasonId];
          profileIds = [...saved.profileIds, league.scoringProfileId];
          profileWeights = [...saved.profileWeights, weight];
          return batch({ ...source, sourceRevision: `portable-enrollment-${weight}`,
            requestCompletedAt: '2026-09-15T00:00:03.000Z', observedAt: '2026-09-15T00:00:03.000Z' });
        },
      });
    } finally {
      store = saved.store; leagueSeasonIds = saved.leagueSeasonIds;
      profileIds = saved.profileIds; profileWeights = saved.profileWeights;
      try { await transaction.database.query('ROLLBACK'); } finally { await transaction.close(); }
    }
  });

  it('keeps configured publication ready through a genuine runtime replay after exact DATA/NULL enrollment', async () => {
    // Owner creates only immutable enrollment
    // metadata; the same restricted LOGIN runs the maintained batch writer.
    expect((await database.database.query('SELECT session_user AS role'))[0].role).toBe('league_one_runtime');
    const key = 'official-only-mixed-publication';
    const registration = stored(await store.registerLeagueSeason({ mode: 'official-data', leagueKey: key,
      leagueName: key, season: DATABASE_SEASON, sleeperLeagueId: key }));
    expect(registration.scoringProfileId).toBeNull();
    await ownerQuery(`INSERT INTO league_administration_enrollments(league_id,provider,active,evidence)
      VALUES($1,'sleeper',false,'public-data-intake-v1')`, [registration.leagueId]);
    await ownerQuery(`INSERT INTO league_administration_enrollment_seasons(league_id,season,provider,evidence)
      VALUES($1,$2,'sleeper','public-data-intake-v1')`, [registration.leagueId, DATABASE_SEASON]);
    const profiles = await database.database.query('SELECT id,rules_hash,rules FROM scoring_profiles WHERE id=ANY($1::uuid[]) ORDER BY id', [profileIds]);
    const pointers = () => database.database.query('SELECT * FROM current_all_player_score_sets WHERE season=$1 ORDER BY scoring_profile_id', [DATABASE_SEASON]);
    const before = await pointers();
    const ready = await ownerQuery(`SELECT public.all_player_score_set_is_publication_ready(
      pointer.all_player_score_set_id,$2::jsonb,pointer.all_player_stat_observation_id) AS ready
      FROM current_all_player_score_sets pointer WHERE season=$1 ORDER BY scoring_profile_id`, [DATABASE_SEASON, JSON.stringify([...profileIds].sort())]);
    expect(ready).toHaveLength(profileIds.length);
    expect(ready.every(row => row.ready === true)).toBe(true);
    // Readiness intentionally stays owner-only; no EXECUTE grant or SET ROLE.
    await expect(database.database.query('SELECT public.all_player_score_set_is_publication_ready($1::uuid,$2::jsonb,$3::uuid)',
      [before[0].all_player_score_set_id, JSON.stringify([...profileIds].sort()), before[0].all_player_stat_observation_id]))
      .rejects.toThrow(/permission denied/iu);
    const replay = await batch(observation(1, 'etag:integration-one', '2026-09-15T00:00:01.000Z'));
    const result = stored(await store.recordAllPlayerBatch(replay));
    expect(result.scoreSets.every(set => set.pointerOutcome === 'verified')).toBe(true);
    expect(await pointers()).toEqual(before);
    expect(await database.database.query('SELECT id,rules_hash,rules FROM scoring_profiles WHERE id=ANY($1::uuid[]) ORDER BY id', [profileIds])).toEqual(profiles);
    expect((await database.database.query('SELECT scoring_profile_id FROM league_seasons WHERE id=$1', [registration.leagueSeasonId]))[0])
      .toEqual({ scoring_profile_id: null });
    expect(await database.database.query('SELECT * FROM current_all_player_league_scores WHERE league_season_id=$1', [registration.leagueSeasonId])).toEqual([]);

    // Baseline 7d81 reproduced both exact P0001 failures. The same runtime
    // population now remains publication-ready with unadopted DATA profiles.
    const inventory = await readEnrollmentInventory(database.database, DATABASE_SEASON);
    expect(inventory.entries.map(entry => entry.intended.leagueKey).sort()).toEqual(['league1', 'league2']);
    expect(inventory.entries.every(entry => entry.status === 'ready')).toBe(true);
    const publicationSnapshot = async () => (await ownerQuery<{ state: Record<string, unknown> }>(`SELECT jsonb_build_object(
      'contents',(SELECT COALESCE(jsonb_agg(to_jsonb(row) ORDER BY id),'[]') FROM all_player_stat_contents row),
      'entries',(SELECT COALESCE(jsonb_agg(to_jsonb(row) ORDER BY all_player_stat_content_id,ordinal),'[]') FROM all_player_stat_entries row),
      'observations',(SELECT COALESCE(jsonb_agg(to_jsonb(row) ORDER BY id),'[]') FROM all_player_stat_observations row),
      'sets',(SELECT COALESCE(jsonb_agg(to_jsonb(row) ORDER BY id),'[]') FROM all_player_score_sets row),
      'scores',(SELECT COALESCE(jsonb_agg(to_jsonb(row) ORDER BY all_player_score_set_id,ordinal),'[]') FROM all_player_scores row),
      'verifications',(SELECT COALESCE(jsonb_agg(to_jsonb(row) ORDER BY all_player_stat_observation_id,all_player_score_set_id),'[]') FROM all_player_score_verifications row),
      'pointers',(SELECT COALESCE(jsonb_agg(to_jsonb(row) ORDER BY provider,season,season_type,week,scoring_profile_id,scorer_version),'[]') FROM current_all_player_score_sets row),
      'acceptances',(SELECT COALESCE(jsonb_agg(to_jsonb(row) ORDER BY id),'[]') FROM all_player_league_acceptances row),
      'leagueHeads',(SELECT COALESCE(jsonb_agg(to_jsonb(row) ORDER BY league_season_id,provider,season,season_type,week,scorer_version),'[]') FROM current_all_player_league_scores row),
      'job',(SELECT to_jsonb(row) FROM projection_jobs row WHERE job_key=$1)) AS state`, [fence.jobKey]))[0].state;
    const accounting = () => ownerQuery(`SELECT payload->'requestStarts' AS starts,payload->'requestGeneration' AS generation,
      payload->'period' AS period,payload->'lastWeeklyRequestAt' AS weekly FROM projection_jobs WHERE job_key=$1`, [fence.jobKey]);
    let adoptedLeagueId = '';
    for (const scenario of [{ name: 'shared', weight: 4 }, { name: 'distinct', weight: 8 }] as const) {
      const dataKey = `unadopted-data-nonnull-${scenario.name}`;
      const data = stored(await store.registerLeagueSeason({ leagueKey: dataKey, leagueName: dataKey,
        season: DATABASE_SEASON, sleeperLeagueId: dataKey, scoringRules: { pass_td: scenario.weight } }));
      expect(data.scoringProfileId).toBeTruthy();
      expect(profileIds.includes(data.scoringProfileId)).toBe(scenario.name === 'shared');
      // Owner seeds enrollment metadata only; actual publication uses a real
      // restricted LOGIN with its genuinely marked request and complete parity.
      await ownerQuery(`INSERT INTO league_administration_enrollments(league_id,provider,active,evidence)
        VALUES($1,'sleeper',false,'public-data-intake-v1')`, [data.leagueId]);
      await ownerQuery(`INSERT INTO league_administration_enrollment_seasons(league_id,season,provider,evidence)
        VALUES($1,$2,'sleeper','public-data-intake-v1')`, [data.leagueId, DATABASE_SEASON]);
      expect(await readEnrollmentInventory(database.database, DATABASE_SEASON)).toEqual(inventory);
      expect(await readEnrollmentInventory(database.database, DATABASE_SEASON, { leagueKey: dataKey })).toEqual({ entries: [] });
      expect((await database.database.query('SELECT session_user AS role,current_user AS effective_role'))[0])
        .toEqual({ role: 'league_one_runtime', effective_role: 'league_one_runtime' });
      // Preserve the exact fresh baseline workload as a successful runtime
      // statement; rollback keeps later fixture histories and pointers intact.
      const fresh = await batch(observation(1, dataKey,
        scenario.name === 'shared' ? '2026-09-15T00:00:04.000Z' : '2026-09-15T00:00:05.000Z'));
      const beforeFresh = await publicationSnapshot();
      const capture = await createPinnedIntegrationDatabase('runtime');
      try {
        await capture.database.query('BEGIN');
        expect((await capture.database.query('SELECT session_user AS role,current_user AS effective_role'))[0])
          .toEqual({ role: 'league_one_runtime', effective_role: 'league_one_runtime' });
        const published = stored(await createProjectionStore(capture.database).recordAllPlayerBatch(fresh));
        expect(published.scoreSets).toHaveLength(profileIds.length);
        expect(published.scoreSets.every(set => set.pointerOutcome === 'advanced' || set.pointerOutcome === 'verified')).toBe(true);
        expect(await capture.database.query('SELECT * FROM current_all_player_league_scores WHERE league_season_id=$1',
          [data.leagueSeasonId])).toEqual([]);
      } finally {
        try { await capture.database.query('ROLLBACK'); } finally { await capture.close(); }
      }
      expect(await publicationSnapshot()).toEqual(beforeFresh);
      const beforeReplay = await publicationSnapshot(); const beforeAccounting = await accounting();
      expect(stored(await store.recordAllPlayerBatch(replay)).scoreSets.every(set => set.pointerOutcome === 'verified')).toBe(true);
      // Successful replay may refresh job.lastPublication; material history and
      // consumed request accounting must remain byte-for-byte equivalent.
      expect({ ...await publicationSnapshot(), job: null }).toEqual({ ...beforeReplay, job: null });
      expect(await accounting()).toEqual(beforeAccounting);
      expect(await database.database.query('SELECT * FROM current_all_player_league_scores WHERE league_season_id=$1',
        [data.leagueSeasonId])).toEqual([]);
      if (scenario.name === 'distinct') adoptedLeagueId = data.leagueId;
    }

    const publisher = await createPinnedIntegrationDatabase('runtime');
    const adopter = await createPinnedIntegrationDatabase('owner');
    let adoption: Promise<unknown> | undefined;
    let publication: Promise<unknown> | undefined;
    try {
      await publisher.database.query('BEGIN');
      expect((await publisher.database.query('SELECT session_user AS role,current_user AS effective_role'))[0])
        .toEqual({ role: 'league_one_runtime', effective_role: 'league_one_runtime' });
      expect(stored(await createProjectionStore(publisher.database).recordAllPlayerBatch(replay)).scoreSets
        .every(set => set.pointerOutcome === 'verified')).toBe(true);
      const pid = (await adopter.database.query<{ pid: number }>('SELECT pg_backend_pid() AS pid'))[0].pid;
      adoption = adopter.database.query(`UPDATE league_administration_enrollments SET active=true,evidence='account-onboarding-v1',
        data_adopted_seasons=ARRAY[$2]::integer[] WHERE league_id=$1`, [adoptedLeagueId, DATABASE_SEASON]);
      const settled = Promise.allSettled([adoption]);
      let waiting = false;
      for (let attempt = 0; attempt < 60 && !waiting; attempt += 1) {
        waiting = (await publisher.database.query<{ waiting: boolean }>(`SELECT EXISTS(SELECT 1 FROM pg_locks
          WHERE pid=$1 AND relation='public.league_administration_enrollments'::regclass
            AND mode='RowExclusiveLock' AND NOT granted) AS waiting`, [pid]))[0].waiting;
        if (!waiting) await delay(25);
      }
      expect(waiting, 'Adoption must wait for the publication transaction parent SHARE lock.').toBe(true);
      await publisher.database.query('ROLLBACK');
      const outcome = (await settled)[0]; if (outcome.status === 'rejected') throw outcome.reason;
      adoption = undefined;
      // Reverse the race: publication reaches SHARE while adoption is still
      // uncommitted, then must read the newly included profile after its wait.
      await ownerQuery('UPDATE league_administration_enrollments SET active=false WHERE league_id=$1', [adoptedLeagueId]);
      const beforeRefusal = await publicationSnapshot();
      const publisherPid = (await publisher.database.query<{ pid: number }>('SELECT pg_backend_pid() AS pid'))[0].pid;
      await adopter.database.query('BEGIN');
      await adopter.database.query(`UPDATE league_administration_enrollments SET active=true,evidence='account-onboarding-v1',
        data_adopted_seasons=ARRAY[$2]::integer[] WHERE league_id=$1`, [adoptedLeagueId, DATABASE_SEASON]);
      publication = createProjectionStore(publisher.database).recordAllPlayerBatch(replay)
        .then(value => ({ value }), error => ({ error }));
      waiting = false;
      for (let attempt = 0; attempt < 60 && !waiting; attempt += 1) {
        waiting = (await adopter.database.query<{ waiting: boolean }>(`SELECT EXISTS(SELECT 1 FROM pg_locks
          WHERE pid=$1 AND relation='public.league_administration_enrollments'::regclass
            AND mode='ShareLock' AND NOT granted) AS waiting`, [publisherPid]))[0].waiting;
        if (!waiting) await delay(25);
      }
      expect(waiting, 'Publication must reach SHARE before the adopter commits.').toBe(true);
      await adopter.database.query('COMMIT');
      expect(await publication).toMatchObject({ error: { code: 'P0001',
        message: 'all-player score batch does not cover the canonical league scoring profiles' } });
      publication = undefined;
      expect((await readEnrollmentInventory(database.database, DATABASE_SEASON)).entries
        .some(entry => entry.intended.leagueId === adoptedLeagueId && entry.status === 'ready')).toBe(true);
      expect(await publicationSnapshot()).toEqual(beforeRefusal);
    } finally {
      // Release the blocker before awaiting either queued session.
      if (publication) { await adopter.database.query('ROLLBACK'); await publication; }
      await publisher.database.query('ROLLBACK');
      if (adoption) await adoption.catch(() => undefined);
      await adopter.database.query('ROLLBACK');
      await ownerQuery('UPDATE league_administration_enrollments SET active=false WHERE league_id=$1', [adoptedLeagueId]);
      await publisher.close(); await adopter.close();
    }
    expect(await readEnrollmentInventory(database.database, DATABASE_SEASON)).toEqual(inventory);
  });

  it('derives player total points and PPG from current pointers with profile isolation', async () => {
    const leagueOne = await store.readAllPlayerPlayerMetrics({
      leagueKey: 'league1', provider: 'sleeper', season: DATABASE_SEASON,
      seasonType: 'reg', throughWeek: 1, provisionalWeek: null,
      scorerVersion: 'sleeper-actual-v1',
    }, scoreSparseStatistics);
    const leagueTwo = await store.readAllPlayerPlayerMetrics({
      leagueKey: 'league2', provider: 'sleeper', season: DATABASE_SEASON,
      seasonType: 'reg', throughWeek: 1, provisionalWeek: null,
      scorerVersion: 'sleeper-actual-v1',
    }, scoreSparseStatistics);
    expect(leagueOne).toMatchObject({
      status: 'published', throughWeek: 1,
      metrics: [{
        scoringProfileId: profileIds[0],
        scoringEntityId: entityIds['integration-player-one'],
        providerExternalId: 'integration-player-one', entityKind: 'player', position: 'QB',
        totalFantasyPoints: 4, appearanceGameCount: 1, publishedWeekCount: 1,
        pointsPerGame: 4, positionRank: 1,
      }],
    });
    expect(leagueTwo).toMatchObject({
      status: 'published', throughWeek: 1,
      metrics: [{
        scoringProfileId: profileIds[1],
        providerExternalId: 'integration-player-one',
        totalFantasyPoints: 6, pointsPerGame: 6, positionRank: 1,
      }],
    });
  });

  it('combines published totals with only the newest compact partial-week correction', async () => {
    for (const [index, passTouchdowns] of [1, 2].entries()) {
      const observedAt = `2026-09-16T00:0${index}:01.000Z`;
      await ownerQuery(`WITH content AS (
        INSERT INTO all_player_stat_contents (
          id,provider,season,season_type,week,normalizer_version,semantic_hash,
          quality,coverage,warnings,entry_count
        ) VALUES (
          gen_random_uuid(),'sleeper',$1::smallint,'reg',2,'sleeper-weekly-stats-v4',
          repeat($2,64),'partial','{"complete":false}'::jsonb,'[]'::jsonb,1
        ) RETURNING id
      ), entry AS (
        INSERT INTO all_player_stat_entries (
          all_player_stat_content_id,entity_kind,provider_external_id,nfl_game_id,
          nfl_team,position,stats,eligibility_evidence,eligible_game_count,
          appearance_game_count,game_phase,ordinal
        ) SELECT id,'player','integration-player-one',$3::uuid,'NE','QB',
          jsonb_build_object('gms_active',1,'gp',1,'pass_td',$4::integer),
          '{"kind":"weekly-stat","source":"weekly-stat-provider","gmsActive":1,"appearances":1}'::jsonb,
          1,1,'final',0 FROM content
        RETURNING all_player_stat_content_id
      ) INSERT INTO all_player_stat_observations (
        id,all_player_stat_content_id,provider,season,season_type,week,normalizer_version,
        source_revision,request_started_at,request_completed_at,observed_at,quality
      ) SELECT gen_random_uuid(),id,'sleeper',$1::smallint,'reg',2,'sleeper-weekly-stats-v4',
        $5,$6::timestamptz - interval '1 second',$6::timestamptz,$6::timestamptz,'partial'
        FROM content
        JOIN entry ON entry.all_player_stat_content_id = content.id`, [DATABASE_SEASON, String(index + 1), wrongWeekGameId,
        passTouchdowns, `etag:partial-week2-${index + 1}`, observedAt]);
    }
    const leagueOne = await store.readAllPlayerPlayerMetrics({
      leagueKey: 'league1', provider: 'sleeper', season: DATABASE_SEASON,
      seasonType: 'reg', throughWeek: 2, provisionalWeek: 2,
      scorerVersion: 'sleeper-actual-v1',
    }, scoreSparseStatistics);
    expect(leagueOne).toMatchObject({
      status: 'provisional', throughWeek: 2, observedAt: '2026-09-16T00:01:01.000Z',
      rowsRead: 5,
      metrics: [expect.objectContaining({
        providerExternalId: 'integration-player-one', totalFantasyPoints: 12,
        appearanceGameCount: 2, pointsPerGame: 6, positionRank: 1,
      })],
    });
    await expect(store.readAllPlayerPlayerMetrics({
      leagueKey: 'league2', provider: 'sleeper', season: DATABASE_SEASON,
      seasonType: 'reg', throughWeek: 2, provisionalWeek: 2,
      scorerVersion: 'sleeper-actual-v1',
    }, scoreSparseStatistics)).resolves.toMatchObject({
      status: 'provisional', throughWeek: 2,
      metrics: [expect.objectContaining({
        providerExternalId: 'integration-player-one', totalFantasyPoints: 18,
        appearanceGameCount: 2, pointsPerGame: 9, positionRank: 1,
      })],
    });
    await expect(store.readAllPlayerPlayerMetrics({
      leagueKey: 'league1', provider: 'sleeper', season: DATABASE_SEASON,
      seasonType: 'reg', throughWeek: 1, provisionalWeek: null,
      scorerVersion: 'sleeper-actual-v1',
    }, scoreSparseStatistics)).resolves.toMatchObject({
      status: 'published', throughWeek: 1,
      metrics: [expect.objectContaining({ totalFantasyPoints: 4, pointsPerGame: 4 })],
    });
  });

  it('rejects a currently usable partial mapping that disagrees with its published canonical identity', async () => {
    const transaction = await createPinnedIntegrationDatabase('owner');
    try {
      await transaction.database.query('BEGIN');
      const reader = createProjectionStore(transaction.database);
      const snapshot = () => transaction.database.query(`SELECT
        (SELECT count(*)::integer FROM all_player_stat_contents) AS contents,
        (SELECT count(*)::integer FROM all_player_stat_entries) AS entries,
        (SELECT count(*)::integer FROM all_player_stat_observations) AS observations,
        (SELECT count(*)::integer FROM all_player_score_sets) AS score_sets,
        (SELECT count(*)::integer FROM all_player_scores) AS scores,
        (SELECT count(*)::integer FROM all_player_score_verifications) AS verifications,
        (SELECT md5(string_agg(to_jsonb(pointer)::text,'' ORDER BY scoring_profile_id,
          provider,season,season_type,week,scorer_version)) FROM current_all_player_score_sets pointer) AS pointers`);
      // The existing fixture has published Week 1 and partial Week 2. Change only
      // the isolated current alias; immutable published scores retain their ID.
      await transaction.database.query(`UPDATE external_scoring_entity_ids
        SET scoring_entity_id=$1::uuid,valid_from=CURRENT_TIMESTAMP-interval '1 minute',valid_to=NULL
        WHERE provider='sleeper' AND entity_kind='player' AND external_id='integration-player-one'`,
      [entityIds['integration-player-zero']]);
      const before = await snapshot();
      for (const leagueKey of ['league1', 'league2']) {
        await expect(reader.readAllPlayerPlayerMetrics({ leagueKey, provider: 'sleeper',
          season: DATABASE_SEASON, seasonType: 'reg', throughWeek: 2, provisionalWeek: 2,
          scorerVersion: 'sleeper-actual-v1',
        }, scoreSparseStatistics)).rejects.toThrow('All-player identities disagree across periods.');
      }
      expect(await snapshot()).toEqual(before);
    } finally {
      try { await transaction.database.query('ROLLBACK'); } finally { await transaction.close(); }
    }
  });

  it.each([
    { label: 'a zero-point partial appearance after published points', publishedTouchdowns: 1, partialTouchdowns: 0 },
    { label: 'a published zero-point appearance before partial points', publishedTouchdowns: 0, partialTouchdowns: 1 },
  ])('counts $label in cumulative PPG', async ({ publishedTouchdowns, partialTouchdowns }) => {
    const transaction = await createPinnedIntegrationDatabase('owner');
    const saved = { store, fence, leagueSeasonIds, profileIds, profileWeights, parityExternalGameId };
    const metricSeason = 2200;
    const period = { season: metricSeason, seasonType: 'reg' as const, week: 1 };
    try {
      await transaction.database.query('BEGIN');
      store = createProjectionStore(transaction.database);
      await transaction.database.query('DELETE FROM projection_jobs WHERE job_key = $1', [fence.jobKey]);
      const claim = await store.acquireAllPlayerJob({ mode: 'backfill', period,
        workerId: 'zero-point-ppg-regression', leaseSeconds: 60,
        deadlineAt: new Date(Date.now() + 55_000).toISOString(),
      });
      if (claim.kind !== 'acquired') throw new Error('The isolated PPG claim was not acquired.');
      fence = claim.fence;
      expect(await store.markAllPlayerRequest({ fence, period })).toBe(true);
      const registered = await Promise.all(['one', 'two'].map((suffix, index) =>
        registerEnrolledIntegrationSeason(transaction.database.query, { leagueKey: `league${index + 1}`,
          season: metricSeason, sleeperLeagueId: `zero-point-ppg-${suffix}`, scoringRules: { pass_td: 10 },
        })));

      leagueSeasonIds = registered.map((league) => league.leagueSeasonId);
      profileIds = registered.map((league) => league.scoringProfileId);
      profileWeights = [10, 10];
      await transaction.database.query(`UPDATE league_period_authorities SET
        default_season = $1, active_season = $1,
        source_revision = 'zero-point-ppg-authority',
        source_external_league_id = CASE league_key WHEN 'league1' THEN 'zero-point-ppg-one'
          ELSE 'zero-point-ppg-two' END
        WHERE league_key IN ('league1', 'league2')`, [metricSeason]);
      parityExternalGameId = 'zero-point-ppg-week1-game';
      const games = stored(await store.upsertNflGames([1, 2].map((week) => ({
        key: `zero-point-ppg-week${week}-game`, provider: 'tank01' as const,
        externalGameId: `zero-point-ppg-week${week}-game`, season: metricSeason,
        seasonType: 'reg' as const, week, homeTeam: 'NE', awayTeam: 'ATL',
        kickoffAt: week === 1 ? '2026-09-13T17:00:00.000Z' : '2026-09-20T17:00:00.000Z',
      }))));
      const source = observation(publishedTouchdowns, 'etag:zero-point-ppg-published', '2026-09-15T00:00:01.000Z');
      const published: AllPlayerStatObservation = {
        ...source, season: metricSeason,
        coverage: { ...source.coverage, periodInventoryEvidence: {
          ...(source.coverage.periodInventoryEvidence as Record<string, unknown>), effectivePeriod: period,
        } },
        entries: source.entries.map((entry) => ({
          ...entry, nflGameId: entry.nflGameId ? games[0].gameId : null,
          eligibilityEvidence: entry.eligibilityEvidence.kind === 'explicit-ineligible'
            ? { ...entry.eligibilityEvidence, effectivePeriod: period } : entry.eligibilityEvidence,
        })),
      };
      expect(stored(await store.recordAllPlayerBatch(await batch(published))).scoreSets)
        .toEqual([expect.objectContaining({ pointerOutcome: 'advanced' })]);
      await transaction.database.query(`WITH content AS (
        INSERT INTO all_player_stat_contents (
          id,provider,season,season_type,week,normalizer_version,semantic_hash,
          quality,coverage,warnings,entry_count
        ) VALUES (
          gen_random_uuid(),'sleeper',$1::smallint,'reg',2,'sleeper-weekly-stats-v4',
          repeat('e',64),'partial',$4::jsonb,'[]'::jsonb,1
        ) RETURNING id
      ), entry AS (
        INSERT INTO all_player_stat_entries (
          all_player_stat_content_id,entity_kind,provider_external_id,nfl_game_id,
          nfl_team,position,stats,eligibility_evidence,eligible_game_count,
          appearance_game_count,game_phase,ordinal
        ) SELECT id,'player','integration-player-one',$2::uuid,'NE','QB',
          jsonb_build_object('gms_active',1,'gp',1,'pass_td',$3::integer),
          '{"kind":"weekly-stat","source":"weekly-stat-provider","gmsActive":1,"appearances":1}'::jsonb,
          1,1,'final',0 FROM content RETURNING all_player_stat_content_id
      ) INSERT INTO all_player_stat_observations (
        id,all_player_stat_content_id,provider,season,season_type,week,normalizer_version,
        source_revision,request_started_at,request_completed_at,observed_at,quality
      ) SELECT gen_random_uuid(),id,'sleeper',$1::smallint,'reg',2,'sleeper-weekly-stats-v4',
        'etag:zero-point-ppg-partial','2026-09-16T00:00:00Z','2026-09-16T00:00:01Z',
        '2026-09-16T00:00:01Z','partial' FROM content
        JOIN entry ON entry.all_player_stat_content_id = content.id`,
      [metricSeason, games[1].gameId, partialTouchdowns, JSON.stringify({
        complete: false, rankUnavailablePositions: publishedTouchdowns === 0 ? ['QB'] : [],
      })]);
      for (const leagueKey of ['league1', 'league2']) {
        await expect(store.readAllPlayerPlayerMetrics({ leagueKey, provider: 'sleeper',
          season: metricSeason, seasonType: 'reg', throughWeek: 2, provisionalWeek: 2,
          scorerVersion: 'sleeper-actual-v1',
        }, scoreSparseStatistics)).resolves.toMatchObject({
          status: 'provisional', throughWeek: 2, observedAt: '2026-09-16T00:00:01.000Z',
          metrics: [expect.objectContaining({ providerExternalId: 'integration-player-one',
            totalFantasyPoints: 10, appearanceGameCount: 2, publishedWeekCount: 1,
            pointsPerGame: 5, positionRank: 1,
          })],
        });
      }
    } finally {
      store = saved.store; fence = saved.fence; leagueSeasonIds = saved.leagueSeasonIds;
      profileIds = saved.profileIds; profileWeights = saved.profileWeights;
      parityExternalGameId = saved.parityExternalGameId;
      try { await transaction.database.query('ROLLBACK'); } finally { await transaction.close(); }
    }
  });

  it('retains each partial week across rollover, applies per-week corrections, and detects missing history', async () => {
    const transaction = await createPinnedIntegrationDatabase('owner');
    try {
      await transaction.database.query('BEGIN');
      const reader = createProjectionStore(transaction.database);
      const insertPartialWeekOne = async (passTouchdowns: number, revision: number) => {
        await transaction.database.query(`WITH content AS (
          INSERT INTO all_player_stat_contents (
            id,provider,season,season_type,week,normalizer_version,semantic_hash,
            quality,coverage,warnings,entry_count
          ) VALUES (
            gen_random_uuid(),'sleeper',$1::smallint,'reg',1,'sleeper-weekly-stats-v4',
            repeat($2,64),'partial','{"complete":false}'::jsonb,'[]'::jsonb,1
          ) RETURNING id
        ), entry AS (
          INSERT INTO all_player_stat_entries (
            all_player_stat_content_id,entity_kind,provider_external_id,nfl_game_id,
            nfl_team,position,stats,eligibility_evidence,eligible_game_count,
            appearance_game_count,game_phase,ordinal
          ) SELECT id,'player','integration-player-one',$3::uuid,'NE','QB',
            jsonb_build_object('gms_active',1,'gp',1,'pass_td',$4::integer),
            '{"kind":"weekly-stat","source":"weekly-stat-provider","gmsActive":1,"appearances":1}'::jsonb,
            1,1,'final',0 FROM content RETURNING all_player_stat_content_id
        ) INSERT INTO all_player_stat_observations (
          id,all_player_stat_content_id,provider,season,season_type,week,normalizer_version,
          source_revision,request_started_at,request_completed_at,observed_at,quality
        ) SELECT gen_random_uuid(),id,'sleeper',$1::smallint,'reg',1,'sleeper-weekly-stats-v4',
          $5,$6::timestamptz - interval '1 second',$6::timestamptz,$6::timestamptz,'partial'
          FROM content JOIN entry ON entry.all_player_stat_content_id = content.id`,
        [DATABASE_SEASON, String(revision), gameId, passTouchdowns,
          `etag:carryforward-week1-${revision}`, `2026-09-17T00:0${revision}:01.000Z`]);
      };
      const readMetrics = (throughWeek: number, provisionalWeek: number | null) => reader.readAllPlayerPlayerMetrics({
        leagueKey: 'league1', provider: 'sleeper', season: DATABASE_SEASON,
        seasonType: 'reg', throughWeek, provisionalWeek, scorerVersion: 'sleeper-actual-v1',
      }, scoreSparseStatistics);

      // Preserve the existing pointer in the transaction until the same-week
      // exclusion is proven. A later raw partial must never replace it.
      await transaction.database.query('SAVEPOINT before_partial');
      await insertPartialWeekOne(9, 7);
      await expect(readMetrics(2, 2)).resolves.toMatchObject({
        status: 'provisional', throughWeek: 2, observedAt: '2026-09-16T00:01:01.000Z',
        metrics: [expect.objectContaining({ totalFantasyPoints: 12,
          appearanceGameCount: 2, pointsPerGame: 6, publishedWeekCount: 1 })],
      });
      await transaction.database.query('ROLLBACK TO SAVEPOINT before_partial');
      await transaction.database.query(`DELETE FROM current_all_player_score_sets
        WHERE scoring_profile_id = $1::uuid AND provider = 'sleeper'
          AND season = $2::smallint AND season_type = 'reg' AND week = 1`,
      [profileIds[0], DATABASE_SEASON]);

      await expect(readMetrics(2, 2)).resolves.toMatchObject({
        status: 'provisional', throughWeek: 2, observedAt: '2026-09-16T00:01:01.000Z',
        metrics: [expect.objectContaining({ totalFantasyPoints: 8,
          appearanceGameCount: 1, pointsPerGame: 8, positionRank: null, publishedWeekCount: 0 })],
      });

      // Week 1 was captured independently of Week 2, including a later correction.
      await insertPartialWeekOne(1, 7);
      await expect(readMetrics(2, 2)).resolves.toMatchObject({
        status: 'provisional', throughWeek: 2, observedAt: '2026-09-17T00:07:01.000Z',
        metrics: [expect.objectContaining({ totalFantasyPoints: 12,
          appearanceGameCount: 2, pointsPerGame: 6, positionRank: 1, publishedWeekCount: 0 })],
      });
      await insertPartialWeekOne(3, 8);
      await expect(readMetrics(2, 2)).resolves.toMatchObject({
        status: 'provisional', throughWeek: 2, observedAt: '2026-09-17T00:08:01.000Z',
        rowsRead: 3,
        metrics: [expect.objectContaining({ totalFantasyPoints: 20,
          appearanceGameCount: 2, pointsPerGame: 10, positionRank: 1 })],
      });
      await expect(readMetrics(1, null)).resolves.toMatchObject({
        status: 'provisional', throughWeek: 1,
        metrics: [expect.objectContaining({ totalFantasyPoints: 12,
          appearanceGameCount: 1, pointsPerGame: 12, positionRank: 1 })],
      });

    } finally {
      try { await transaction.database.query('ROLLBACK'); } finally { await transaction.close(); }
    }
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
    await expect(store.readAllPlayerPlayerMetrics({
      leagueKey: 'league1', provider: 'sleeper', season: DATABASE_SEASON,
      seasonType: 'reg', throughWeek: 1, provisionalWeek: null,
      scorerVersion: 'sleeper-actual-v1',
    }, scoreSparseStatistics)).resolves.toMatchObject({
      status: 'published', throughWeek: 1,
      metrics: [expect.objectContaining({
        providerExternalId: 'integration-player-one', totalFantasyPoints: 8,
        appearanceGameCount: 1, publishedWeekCount: 1, pointsPerGame: 8,
        positionRank: 1,
      })],
    });
  });

  it('serializes concurrent replay and rolls back an equal-time conflicting correction', async () => {
    const concurrent = observation(3, 'etag:integration-three', '2026-09-15T00:02:01.000Z');
    const input = await batch(concurrent);
    const peer = createIndependentDatabase();
    const peerStore = createProjectionStore(peer.database);
    const blocker = await createPinnedIntegrationDatabase('owner');
    const historyCounts = async () => (await ownerQuery<{
      contents: number; entries: number; observations: number;
      score_sets: number; scores: number; verifications: number;
    }>(`SELECT
      (SELECT count(*)::integer FROM all_player_stat_contents) AS contents,
      (SELECT count(*)::integer FROM all_player_stat_entries) AS entries,
      (SELECT count(*)::integer FROM all_player_stat_observations) AS observations,
      (SELECT count(*)::integer FROM all_player_score_sets) AS score_sets,
      (SELECT count(*)::integer FROM all_player_scores) AS scores,
      (SELECT count(*)::integer FROM all_player_score_verifications) AS verifications
    `))[0];
    const beforeReplay = await historyCounts();
    let pending: Promise<Awaited<ReturnType<ProjectionStore['recordAllPlayerBatch']>>>[] = [];
    let outcomes: string[] = [];
    try {
      // Start both statements while the job row is locked so the regression
      // cannot pass merely because a cold peer connects after the first commit.
      const sessions = await Promise.all([database.database, peer.database].map(async (client) =>
        (await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid'))[0].pid));
      await blocker.database.query('BEGIN');
      await blocker.database.query(`SELECT job_key FROM projection_jobs
        WHERE job_key = 'all-player-ingestion:sleeper' FOR UPDATE`);
      pending = [
        store.recordAllPlayerBatch(input), peerStore.recordAllPlayerBatch(input),
      ];
      const pendingResults = Promise.allSettled(pending);
      let blocked = 0;
      for (let tries = 0; tries < 30 && blocked < 2; tries += 1) {
        await blocker.database.query('SELECT pg_stat_clear_snapshot(), pg_sleep(0.02)');
        blocked = Number((await blocker.database.query<{ count: number }>(`
          SELECT count(*)::integer AS count FROM pg_stat_activity
          WHERE pid = ANY($1::integer[]) AND wait_event_type = 'Lock'
        `, [sessions]))[0].count);
      }
      expect(blocked).toBe(2);
      await blocker.database.query('COMMIT');
      const results = await pendingResults;
      // Even a rejected competing statement must leave exactly one whole
      // immutable batch and the complete peer-profile pointer group.
      expect(await historyCounts()).toEqual({
        contents: beforeReplay.contents + 1,
        entries: beforeReplay.entries + input.observation.entries.length,
        observations: beforeReplay.observations + 1,
        score_sets: beforeReplay.score_sets + input.scoreSets.length,
        scores: beforeReplay.scores + input.scoreSets.reduce((count, set) => count + set.scores.length, 0),
        verifications: beforeReplay.verifications + input.scoreSets.length,
      });
      expect(await ownerQuery<{ count: number; profiles: number; observations: number }>(`
        SELECT count(*)::integer AS count,
          count(DISTINCT current.scoring_profile_id)::integer AS profiles,
          count(DISTINCT current.all_player_stat_observation_id)::integer AS observations
        FROM current_all_player_score_sets current
        JOIN all_player_stat_observations observation
          ON observation.id = current.all_player_stat_observation_id
        WHERE observation.source_revision = $1
      `, [concurrent.sourceRevision])).toEqual([{
        count: input.scoreSets.length, profiles: input.scoreSets.length, observations: 1,
      }]);
      expect(results.map((result) => result.status === 'fulfilled' ? 'stored'
        : String((result.reason as { code?: unknown }).code ?? 'rejected')))
        .toEqual(['stored', 'stored']);
      outcomes = results.flatMap((result) => {
        if (result.status !== 'fulfilled') throw result.reason;
        return stored(result.value).scoreSets.map((set) => set.pointerOutcome);
      });
    } finally {
      await blocker.database.query('ROLLBACK');
      await Promise.allSettled(pending);
      await blocker.close();
      await peer.close();
    }
    expect(outcomes.filter((outcome) => outcome === 'advanced')).toHaveLength(2);
    expect(outcomes.filter((outcome) => outcome === 'verified')).toHaveLength(2);

    const before = await historyCounts();
    const conflict = observation(4, 'etag:integration-conflict', concurrent.observedAt);
    await expect(store.recordAllPlayerBatch(await batch(conflict)))
      .rejects.toThrow(/equal observation time/iu);
    const after = await historyCounts();
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

  it.each(['deadline', 'takeover'] as const)('rechecks %s changes after waiting for the initial job lock', async (change) => {
    const input = await batch(observation(4, `etag:wait-${change}`, '2026-09-15T00:10:31.000Z'));
    const snapshot = () => ownerQuery(`SELECT
      (SELECT count(*)::integer FROM all_player_stat_contents) AS contents,
      (SELECT count(*)::integer FROM all_player_stat_entries) AS entries,
      (SELECT count(*)::integer FROM all_player_stat_observations) AS observations,
      (SELECT count(*)::integer FROM all_player_score_sets) AS score_sets,
      (SELECT count(*)::integer FROM all_player_scores) AS scores,
      (SELECT count(*)::integer FROM all_player_score_verifications) AS verifications,
      (SELECT jsonb_agg(to_jsonb(pointer) ORDER BY pointer.scoring_profile_id)
        FROM current_all_player_score_sets pointer) AS pointers`);
    const before = await snapshot();
    const pid = (await database.database.query<{ pid: number }>('SELECT pg_backend_pid() AS pid'))[0].pid;
    const blocker = await createPinnedIntegrationDatabase('owner');
    let pending: Promise<unknown> | null = null;
    try {
      await blocker.database.query('BEGIN');
      await blocker.database.query('SELECT job_key FROM projection_jobs WHERE job_key = $1 FOR UPDATE', [fence.jobKey]);
      pending = store.recordAllPlayerBatch(input);
      const settled = Promise.allSettled([pending]);
      let blocked = false;
      for (let tries = 0; tries < 30 && !blocked; tries += 1) {
        await blocker.database.query('SELECT pg_stat_clear_snapshot(), pg_sleep(0.02)');
        blocked = (await blocker.database.query<{ blocked: boolean }>(`SELECT EXISTS (
          SELECT 1 FROM pg_stat_activity WHERE pid = $1 AND wait_event_type = 'Lock'
        ) AS blocked`, [pid]))[0].blocked;
      }
      expect(blocked).toBe(true);
      if (change === 'deadline') {
        await blocker.database.query(`UPDATE projection_jobs SET payload = jsonb_set(payload,'{deadlineAt}',
          to_jsonb((clock_timestamp() - interval '1 second')::text)) WHERE job_key = $1`, [fence.jobKey]);
      } else {
        await blocker.database.query(`UPDATE projection_jobs SET lease_owner = 'wait-successor',
          attempt_count = attempt_count + 1 WHERE job_key = $1`, [fence.jobKey]);
      }
      await blocker.database.query('COMMIT');
      const result = (await settled)[0];
      expect(result.status).toBe('rejected');
      if (result.status === 'rejected') {
        expect((result.reason as Error).message).toMatch(/all-player lease, generation, period, request or deadline/iu);
      }
      expect(await store.finishAllPlayerJob({ fence, outcome: 'partial', diagnostic: {} })).toBe(false);
      expect(await snapshot()).toEqual(before);
    } finally {
      await blocker.database.query('ROLLBACK');
      if (pending) await Promise.allSettled([pending]);
      await blocker.close();
      await ownerQuery(`UPDATE projection_jobs SET lease_owner = $2, attempt_count = $3,
        payload = jsonb_set(payload,'{deadlineAt}',to_jsonb($4::text)) WHERE job_key = $1`,
      [fence.jobKey, fence.workerId, fence.generation, fence.deadlineAt]);
    }
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
          const setup = await createPinnedIntegrationDatabase('owner');
          let leagues: Awaited<ReturnType<typeof registerEnrolledIntegrationSeason>>[];
          try {
            await setup.database.query('BEGIN');
            leagues = await Promise.all(['one','two'].map((suffix,index) =>
              registerEnrolledIntegrationSeason(setup.database.query, {leagueKey:`league${index+1}`,season:2198,
                sleeperLeagueId:`synthetic-capacity-shared-${suffix}`,scoringRules:{pass_td:4}})));
            await setup.database.query('COMMIT');
          } catch (error) { await setup.database.query('ROLLBACK'); throw error; }
          finally { await setup.close(); }
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
  // This envelope covers 27 independent batches, below the fixture's 550-second
  // deadline; the production invocation deadline remains unchanged.
  },480_000);

  it('enrolls Dynasty between complete batches, requires all canonical parity and preserves history through compensation', async () => {
    const saved = { store, fence, leagueSeasonIds, profileIds, profileWeights };
    const priorJob = (await ownerQuery<{ job: Record<string, unknown> }>(
      'SELECT to_jsonb(job) AS job FROM projection_jobs job WHERE job_key=$1', [fence.jobKey]))[0].job;
    const peer = createIndependentDatabase();
    const peerStore = createProjectionStore(peer.database);
    const publishing = await createPinnedIntegrationDatabase('runtime');
    let registration: Promise<Awaited<ReturnType<ProjectionStore['registerLeagueSeason']>>> | undefined;
    const dynastyAuthoritySql = `INSERT INTO league_period_authorities (
      league_key,default_season,default_season_type,default_week,active_season,active_season_type,
      active_week,league_lifecycle,nfl_phase,source_provider,source_revision,source_observed_at,
      verified_at,source_external_league_id,expected_roster_count,expected_starter_slot_count,expected_roster_ids
    ) SELECT 'dynasty',default_season,default_season_type,default_week,active_season,active_season_type,
      active_week,league_lifecycle,nfl_phase,source_provider,'dynasty-integration-authority',source_observed_at,
      verified_at,'all-player-integration-dynasty',expected_roster_count,expected_starter_slot_count,expected_roster_ids
      FROM league_period_authorities WHERE league_key='league1'`;
    const snapshotSql = `SELECT
      (SELECT count(*)::integer FROM all_player_stat_contents) AS contents,
      (SELECT count(*)::integer FROM all_player_stat_entries) AS entries,
      (SELECT count(*)::integer FROM all_player_stat_observations) AS observations,
      (SELECT count(*)::integer FROM all_player_score_sets) AS score_sets,
      (SELECT count(*)::integer FROM all_player_scores) AS scores,
      (SELECT count(*)::integer FROM all_player_score_verifications) AS verifications,
      (SELECT jsonb_agg(to_jsonb(pointer) ORDER BY pointer.scoring_profile_id)
        FROM current_all_player_score_sets pointer WHERE season=$1) AS pointers`;
    const snapshot = () => ownerQuery(snapshotSql, [DATABASE_SEASON]);
    const newest = await ownerQuery<{ observed_at: string }>(`SELECT
      (COALESCE(max(observed_at),clock_timestamp()) + interval '1 second')::text AS observed_at
      FROM all_player_stat_observations WHERE season=$1`, [DATABASE_SEASON]);
    let sequence = 0;
    const nextObservation = (label: string) => observation(10 + sequence,
      `dynasty-integration-${label}-${sequence}`,
      new Date(Date.parse(newest[0].observed_at) + 1_000 * sequence++).toISOString());
    const expectRejectedUnchanged = async (input: Awaited<ReturnType<typeof batch>>, pattern: RegExp) => {
      const before = await snapshot();
      await expect(store.recordAllPlayerBatch(input)).rejects.toThrow(pattern);
      expect(await snapshot()).toEqual(before);
    };
    try {
      // Earlier budget/recovery cases deliberately finish the original job.
      // Claim fresh ownership so every assertion reaches the publication
      // invariant it intends to test, both alone and in the complete suite.
      await ownerQuery('DELETE FROM projection_jobs WHERE job_key=$1', [saved.fence.jobKey]);
      const claim = await store.acquireAllPlayerJob({ mode: 'backfill',
        period: { season: DATABASE_SEASON, seasonType: 'reg', week: 1 },
        workerId: 'dynasty-publication-integration', leaseSeconds: 600,
        deadlineAt: new Date(Date.now() + 550_000).toISOString(),
      });
      if (claim.kind !== 'acquired') throw new Error('The isolated Dynasty publication claim was not acquired.');
      fence = claim.fence;
      expect(await store.markAllPlayerRequest({ fence,
        period: { season: DATABASE_SEASON, seasonType: 'reg', week: 1 },
      })).toBe(true);
      // The shared-profile variant is a separate rolled-back configuration.
      // Never modify an existing season's immutable scoring-profile binding.
      const sharedTransaction = await createPinnedIntegrationDatabase('owner');
      try {
        await sharedTransaction.database.query('BEGIN');
        store = createProjectionStore(sharedTransaction.database);
        const beforeEnrollment = await batch(nextObservation('shared-old-application'));
        const sharedDynasty = stored(await store.registerLeagueSeason({
          leagueKey: 'dynasty', leagueName: 'Isolated Shared Dynasty', season: DATABASE_SEASON,
          sleeperLeagueId: 'all-player-integration-dynasty', scoringRules: { pass_td: 4 },
        }));
        await enrollIntegrationSeason(sharedTransaction.database.query, ['dynasty'], DATABASE_SEASON);
        await sharedTransaction.database.query(dynastyAuthoritySql);
        leagueSeasonIds = [...saved.leagueSeasonIds, sharedDynasty.leagueSeasonId];
        profileIds = [...saved.profileIds, sharedDynasty.scoringProfileId];
        profileWeights = [...saved.profileWeights, 4];
        const pointerSql = 'SELECT to_jsonb(pointer) AS pointer FROM current_all_player_score_sets pointer WHERE season=$1 ORDER BY scoring_profile_id';
        const before = await sharedTransaction.database.query(pointerSql, [DATABASE_SEASON]);
        await expect(store.recordAllPlayerBatch(beforeEnrollment))
          .rejects.toThrow(/missing a canonical scoring profile|parity observations are incomplete/iu);
        expect(await sharedTransaction.database.query(pointerSql, [DATABASE_SEASON])).toEqual(before);
        const sharedInput = await batch(nextObservation('shared'));
        expect(sharedInput.scoreSets).toHaveLength(2);
        expect(sharedInput.scoreSets.map((set) => (set.coverage.parity_observation_ids as unknown[]).length).sort())
          .toEqual([1, 2]);
        const shared = stored(await store.recordAllPlayerBatch(sharedInput));
        expect(shared.scoreSets.every((set) => set.pointerOutcome === 'advanced')).toBe(true);
      } finally {
        await sharedTransaction.database.query('ROLLBACK');
        await sharedTransaction.close();
        store = saved.store; leagueSeasonIds = saved.leagueSeasonIds;
        profileIds = saved.profileIds; profileWeights = saved.profileWeights;
      }
      // The unchanged two-league writer remains valid before the new season is
      // registered and explicitly owner-enrolled. Publication holds season
      // registration and membership stable until the transaction ends.
      const oldInput = await batch(nextObservation('old-application'));
      const registrationPid = (await peer.database.query<{ pid: number }>('SELECT pg_backend_pid() AS pid'))[0].pid;
      await publishing.database.query('BEGIN');
      const oldWriter = createProjectionStore(publishing.database);
      expect(stored(await oldWriter.recordAllPlayerBatch(oldInput)).scoreSets)
        .toEqual([expect.objectContaining({ pointerOutcome: 'advanced' }), expect.objectContaining({ pointerOutcome: 'advanced' })]);
      registration = peerStore.registerLeagueSeason({
        leagueKey: 'dynasty', leagueName: 'Isolated Dynasty', season: DATABASE_SEASON,
        sleeperLeagueId: 'all-player-integration-dynasty', scoringRules: { pass_td: 8 },
      });
      const registrationResult = Promise.allSettled([registration]);
      let blocked = false;
      for (let tries = 0; tries < 30 && !blocked; tries += 1) {
        await publishing.database.query('SELECT pg_stat_clear_snapshot(), pg_sleep(0.02)');
        blocked = (await ownerQuery<{ blocked: boolean }>(`SELECT EXISTS (
          SELECT 1 FROM pg_locks WHERE pid=$1 AND relation='public.league_seasons'::regclass
            AND mode='RowExclusiveLock' AND NOT granted
        ) AS blocked`, [registrationPid]))[0].blocked;
      }
      expect(blocked).toBe(true);
      await publishing.database.query('COMMIT');
      const result = (await registrationResult)[0];
      if (result.status !== 'fulfilled') throw result.reason;
      const dynasty = stored(result.value);
      await enrollIntegrationSeason(ownerQuery, ['dynasty'], DATABASE_SEASON);
      expect(profileIds).not.toContain(dynasty.scoringProfileId);
      leagueSeasonIds = [...leagueSeasonIds, dynasty.leagueSeasonId];
      profileIds = [...profileIds, dynasty.scoringProfileId];
      profileWeights = [...profileWeights, 8];
      await ownerQuery(dynastyAuthoritySql);

      // Even an exact two-league replay cannot bypass the newly required third
      // league's distinct profile after its enrollment commits.
      await expectRejectedUnchanged(oldInput, /canonical league scoring profiles/iu);

      // An enrolled league without the matching authoritative connection must
      // not be skipped merely because the other two leagues are valid.
      const authorityInput = await batch(nextObservation('wrong-authority'));
      await ownerQuery("UPDATE league_period_authorities SET source_external_league_id='wrong-dynasty' WHERE league_key='dynasty'");
      try {
        await expectRejectedUnchanged(authorityInput, /missing a canonical scoring profile|parity observations are incomplete/iu);
      } finally {
        await ownerQuery("UPDATE league_period_authorities SET source_external_league_id='all-player-integration-dynasty' WHERE league_key='dynasty'");
      }

      // A complete two-profile batch cannot publish after a third profile is
      // registered, regardless of its valid original-league observations.
      const completeLeagueSeasons = leagueSeasonIds;
      const completeProfileIds = profileIds;
      leagueSeasonIds = saved.leagueSeasonIds;
      profileIds = saved.profileIds;
      profileWeights = saved.profileWeights;
      const missingProfileInput = await batch(nextObservation('missing-dynasty-profile'));
      leagueSeasonIds = completeLeagueSeasons;
      profileIds = completeProfileIds;
      profileWeights = [4, 6, 8];
      await expectRejectedUnchanged(missingProfileInput, /canonical league scoring profiles/iu);

      const fullInput = await batch(nextObservation('distinct'));
      expect(fullInput.scoreSets).toHaveLength(3);
      const full = stored(await store.recordAllPlayerBatch(fullInput));
      expect(full.entryCount).toBe(fullInput.observation.entries.length);
      expect(full.scoreSets).toHaveLength(3);
      expect(full.scoreSets.every((set) => set.pointerOutcome === 'advanced')).toBe(true);
      expect(await ownerQuery<{ count: number; observations: number }>(`SELECT count(*)::integer AS count,
        count(DISTINCT all_player_stat_observation_id)::integer AS observations
        FROM current_all_player_score_sets WHERE provider='sleeper' AND season=$1 AND week=1`, [DATABASE_SEASON]))
        .toEqual([{ count: 3, observations: 1 }]);
      expect(stored(await store.recordAllPlayerBatch(fullInput)).scoreSets.every((set) => set.pointerOutcome === 'verified'))
        .toBe(true);

      // Stable league keys cannot be mutated. Prove missing originals with
      // legitimate new-season inventories with three intended memberships but
      // only Dynasty and one original registration. No subset may publish.
      for (const [index, retainedOriginal] of ['league1', 'league2'].entries()) {
        const transaction = await createPinnedIntegrationDatabase('owner');
        const complete = { store, fence, leagueSeasonIds, profileIds, profileWeights, parityExternalGameId };
        const period = { season: 2196 + index, seasonType: 'reg' as const, week: 1 };
        try {
          await transaction.database.query('BEGIN');
          store = createProjectionStore(transaction.database);
          await transaction.database.query('DELETE FROM projection_jobs WHERE job_key=$1', [fence.jobKey]);
          const missingClaim = await store.acquireAllPlayerJob({ mode: 'backfill', period,
            workerId: `dynasty-missing-original-${index}`, leaseSeconds: 60,
            deadlineAt: new Date(Date.now() + 55_000).toISOString(),
          });
          if (missingClaim.kind !== 'acquired') throw new Error('The isolated missing-original claim was not acquired.');
          fence = missingClaim.fence;
          expect(await store.markAllPlayerRequest({ fence, period })).toBe(true);
          const keys = [retainedOriginal, 'dynasty'];
          profileWeights = [index === 0 ? 4 : 6, 8];
          const registered = await Promise.all(keys.map((leagueKey, keyIndex) =>
            registerEnrolledIntegrationSeason(transaction.database.query, { leagueKey,
              season: period.season, sleeperLeagueId: `dynasty-missing-original-${index}-${leagueKey}`,
              scoringRules: { pass_td: profileWeights[keyIndex] },
            })));
          await enrollIntegrationSeason(transaction.database.query, ['league1', 'league2', 'dynasty'], period.season);
          leagueSeasonIds = registered.map((league) => league.leagueSeasonId);
          profileIds = registered.map((league) => league.scoringProfileId);
          for (const leagueKey of keys) {
            await transaction.database.query(`UPDATE league_period_authorities SET
              default_season=$1,active_season=$1,source_revision='dynasty-missing-original-authority',
              source_external_league_id=$2 WHERE league_key=$3`,
            [period.season, `dynasty-missing-original-${index}-${leagueKey}`, leagueKey]);
          }
          parityExternalGameId = `dynasty-missing-original-${index}-game`;
          const games = stored(await store.upsertNflGames([{
            key: parityExternalGameId, provider: 'tank01', externalGameId: parityExternalGameId,
            ...period, homeTeam: 'NE', awayTeam: 'ATL', kickoffAt: '2026-09-13T17:00:00.000Z',
          }]));
          const source = nextObservation(`missing-original-${index}`);
          const missingOriginalInput = await batch({
            ...source, season: period.season,
            coverage: { ...source.coverage, periodInventoryEvidence: {
              ...(source.coverage.periodInventoryEvidence as Record<string, unknown>), effectivePeriod: period,
            } },
            entries: source.entries.map((entry) => ({
              ...entry, nflGameId: entry.nflGameId ? games[0].gameId : null,
              eligibilityEvidence: entry.eligibilityEvidence.kind === 'explicit-ineligible'
                ? { ...entry.eligibilityEvidence, effectivePeriod: period } : entry.eligibilityEvidence,
            })),
          });
          expect(missingOriginalInput.scoreSets).toHaveLength(2);
          const before = await transaction.database.query(snapshotSql, [period.season]);
          await expect(store.recordAllPlayerBatch(missingOriginalInput))
            .rejects.toThrow(/canonical league scoring profiles/iu);
          expect(await transaction.database.query(snapshotSql, [period.season])).toEqual(before);
        } finally {
          store = complete.store; fence = complete.fence; leagueSeasonIds = complete.leagueSeasonIds;
          profileIds = complete.profileIds; profileWeights = complete.profileWeights;
          parityExternalGameId = complete.parityExternalGameId;
          try { await transaction.database.query('ROLLBACK'); } finally { await transaction.close(); }
        }
      }

      // A forward compensation restores the exact installed 011 bodies and
      // permits the old application to publish originals while retaining the
      // already verified Dynasty pointer/history. This transaction is rolled
      // back so the rest of the suite retains the current additive migrations.
      const rollback = await createPinnedIntegrationDatabase('owner');
      const installed = (await readFile(new URL('../migrations/011_all_player_foundation_guards.sql', import.meta.url), 'utf8'))
        .replace(/\r\n?/gu, '\n');
      const functionStart = installed.indexOf('CREATE OR REPLACE FUNCTION public.all_player_score_set_is_publication_ready(');
      const functionEnd = installed.indexOf('REVOKE ALL ON FUNCTION public.all_player_score_set_is_publication_ready(uuid,jsonb,uuid)', functionStart);
      expect(functionStart).toBeGreaterThan(0);
      expect(functionEnd).toBeGreaterThan(functionStart);
      try {
        await rollback.database.query('BEGIN');
        await rollback.database.query(installed.slice(functionStart, functionEnd));
        store = createProjectionStore(rollback.database);
        leagueSeasonIds = saved.leagueSeasonIds;
        profileIds = saved.profileIds;
        profileWeights = saved.profileWeights;
        const dynastyBefore = await rollback.database.query(`SELECT to_jsonb(pointer) AS pointer
          FROM current_all_player_score_sets pointer WHERE season=$1 AND scoring_profile_id=$2::uuid`,
        [DATABASE_SEASON, dynasty.scoringProfileId]);
        const compensation = stored(await store.recordAllPlayerBatch(await batch(nextObservation('compensation'))));
        expect(compensation.scoreSets).toHaveLength(2);
        expect(compensation.scoreSets.every((set) => set.pointerOutcome === 'advanced')).toBe(true);
        expect(await rollback.database.query(`SELECT to_jsonb(pointer) AS pointer
          FROM current_all_player_score_sets pointer WHERE season=$1 AND scoring_profile_id=$2::uuid`,
        [DATABASE_SEASON, dynasty.scoringProfileId])).toEqual(dynastyBefore);
      } finally {
        await rollback.database.query('ROLLBACK');
        await rollback.close();
      }
    } finally {
      await publishing.database.query('ROLLBACK');
      if (registration) await Promise.allSettled([registration]);
      await publishing.close();
      await peer.close();
      store = saved.store; fence = saved.fence; leagueSeasonIds = saved.leagueSeasonIds;
      profileIds = saved.profileIds; profileWeights = saved.profileWeights;
      await ownerQuery('DELETE FROM projection_jobs WHERE job_key=$1', [fence.jobKey]);
      await ownerQuery('INSERT INTO projection_jobs SELECT * FROM jsonb_populate_record(NULL::projection_jobs,$1::jsonb)',
        [JSON.stringify(priorJob)]);
    }
  }, 120_000);

  it('owner-only readiness refuses all-DATA/NULL copied negative prerequisites without publication', async () => {
    // R037 AUTHORED / UNEXECUTED, OWNER-ONLY NEGATIVE PREREQUISITES.
    // Copy a previously genuine complete candidate into an empty synthetic
    // season with consistent games/raw rows/scores/verification. This transaction
    // is rolled back; no accepted head, result, lease or request credit is made.
    // Runtime zero-population refusal is proved separately by the initial 2199
    // writer case, never by this owner-only readiness boolean.
    const period = { season: 2191, seasonType: 'reg' as const, week: 1 };
    const owner = await createPinnedIntegrationDatabase('owner');
    const candidate = { content: randomUUID(), observation: randomUUID(), scoreSet: randomUUID() };
    let ownerOpen = false;
    const configuredPointers = await ownerQuery('SELECT * FROM current_all_player_score_sets WHERE season=$1 ORDER BY scoring_profile_id', [DATABASE_SEASON]);
    try {
      expect(await owner.database.query('SELECT * FROM league_administration_enrollment_seasons WHERE season=$1', [period.season])).toEqual([]);
      const [template] = await owner.database.query(`SELECT pointer.all_player_stat_observation_id AS observation_id,
        pointer.all_player_score_set_id AS score_set_id,score_set.all_player_stat_content_id AS content_id,
        score_set.scoring_profile_id,verification.coverage
        FROM current_all_player_score_sets pointer JOIN all_player_score_sets score_set ON score_set.id=pointer.all_player_score_set_id
        JOIN all_player_score_verifications verification ON verification.all_player_score_set_id=score_set.id
          AND verification.all_player_stat_observation_id=pointer.all_player_stat_observation_id
        WHERE pointer.season=$1 ORDER BY pointer.scoring_profile_id LIMIT 1`, [DATABASE_SEASON]);
      if (!template) throw new Error('The all-NULL negative case requires a previously genuine complete fixture candidate.');
      const expected = (template.coverage as Record<string, unknown>).expected_scoring_profile_ids;
      // Establish that the copied source satisfies current readiness first;
      // owner copies below change period/IDs only for the zero-member negative.
      expect(await owner.database.query(`SELECT public.all_player_score_set_is_publication_ready($1,$2::jsonb,$3) AS ready`,
        [template.score_set_id, JSON.stringify(expected), template.observation_id])).toEqual([{ ready: true }]);
      await owner.database.query('BEGIN'); ownerOpen = true;
      await owner.database.query(`INSERT INTO all_player_stat_contents SELECT (jsonb_populate_record(NULL::all_player_stat_contents,
        to_jsonb(original)||jsonb_build_object('id',$2::uuid,'season',$3::smallint,
          'coverage',jsonb_set(original.coverage,'{periodInventoryEvidence,effectivePeriod}',$4::jsonb)))).*
        FROM all_player_stat_contents original WHERE id=$1`, [template.content_id, candidate.content, period.season, JSON.stringify(period)]);
      const games = await owner.database.query(`SELECT DISTINCT game.* FROM nfl_games game
        JOIN all_player_stat_entries entry ON entry.nfl_game_id=game.id WHERE entry.all_player_stat_content_id=$1`, [template.content_id]);
      const gameIds: Record<string, string> = {};
      for (const game of games) {
        const id = randomUUID(); gameIds[String(game.id)] = id;
        await owner.database.query(`INSERT INTO nfl_games SELECT (jsonb_populate_record(NULL::nfl_games,
          $1::jsonb||jsonb_build_object('id',$2::uuid,'season',$3::smallint))).*`, [JSON.stringify(game), id, period.season]);
      }
      await owner.database.query(`INSERT INTO all_player_stat_entries SELECT (jsonb_populate_record(NULL::all_player_stat_entries,
        to_jsonb(original)||jsonb_build_object('all_player_stat_content_id',$2::uuid,
          'nfl_game_id',CASE WHEN original.nfl_game_id IS NULL THEN NULL ELSE ($3::jsonb->>original.nfl_game_id::text)::uuid END,
          'eligibility_evidence',CASE WHEN original.eligibility_evidence ? 'effectivePeriod'
            THEN jsonb_set(original.eligibility_evidence,'{effectivePeriod}',$4::jsonb) ELSE original.eligibility_evidence END))).*
        FROM all_player_stat_entries original WHERE all_player_stat_content_id=$1 ORDER BY ordinal`,
      [template.content_id, candidate.content, JSON.stringify(gameIds), JSON.stringify(period)]);
      await owner.database.query(`INSERT INTO all_player_stat_observations SELECT (jsonb_populate_record(NULL::all_player_stat_observations,
        to_jsonb(original)||jsonb_build_object('id',$2::uuid,'all_player_stat_content_id',$3::uuid,'season',$4::smallint))).*
        FROM all_player_stat_observations original WHERE id=$1`, [template.observation_id, candidate.observation, candidate.content, period.season]);
      await owner.database.query(`INSERT INTO all_player_score_sets SELECT (jsonb_populate_record(NULL::all_player_score_sets,
        to_jsonb(original)||jsonb_build_object('id',$2::uuid,'all_player_stat_content_id',$3::uuid,'season',$4::smallint))).*
        FROM all_player_score_sets original WHERE id=$1`, [template.score_set_id, candidate.scoreSet, candidate.content, period.season]);
      await owner.database.query(`INSERT INTO all_player_scores SELECT (jsonb_populate_record(NULL::all_player_scores,
        to_jsonb(original)||jsonb_build_object('all_player_score_set_id',$2::uuid,'all_player_stat_content_id',$3::uuid,
          'nfl_game_id',CASE WHEN original.nfl_game_id IS NULL THEN NULL ELSE ($4::jsonb->>original.nfl_game_id::text)::uuid END))).*
        FROM all_player_scores original WHERE all_player_score_set_id=$1 ORDER BY ordinal`,
      [template.score_set_id, candidate.scoreSet, candidate.content, JSON.stringify(gameIds)]);
      await owner.database.query(`INSERT INTO all_player_score_verifications SELECT (jsonb_populate_record(NULL::all_player_score_verifications,
        to_jsonb(original)||jsonb_build_object('all_player_stat_observation_id',$3::uuid,'all_player_score_set_id',$4::uuid))).*
        FROM all_player_score_verifications original WHERE all_player_stat_observation_id=$1 AND all_player_score_set_id=$2`,
      [template.observation_id, template.score_set_id, candidate.observation, candidate.scoreSet]);
      // No copied pointer exists, so historical publication cannot bypass the
      // current-alias guard. Assert EVERY preceding readiness condition directly
      // before interpreting false as the zero-population owner predicate.
      expect(await owner.database.query(`SELECT
        NOT EXISTS(SELECT 1 FROM all_player_scores score WHERE score.all_player_score_set_id=candidate.id
          AND NOT EXISTS(SELECT 1 FROM external_scoring_entity_ids mapping JOIN scoring_entities entity
            ON entity.id=mapping.scoring_entity_id AND entity.kind=score.entity_kind
            WHERE mapping.provider=candidate.provider AND mapping.entity_kind=score.entity_kind
              AND mapping.external_id=score.provider_external_id AND mapping.scoring_entity_id=score.scoring_entity_id
              AND mapping.mapping_status='verified' AND mapping.valid_from<=clock_timestamp()
              AND (mapping.valid_to IS NULL OR mapping.valid_to>clock_timestamp()))) AS aliases_complete,
        (candidate.quality='complete' AND candidate.scored_entity_count=content.entry_count
          AND candidate.parity_comparison_count>0 AND candidate.parity_mismatch_count=0
          AND verification.coverage @> '{"complete":true,"identity_complete":true,"scoring_rules_complete":true}'::jsonb
          AND verification.coverage->>'scoring_rules_hash'=profile.rules_hash
          AND verification.coverage->'expected_scoring_profile_ids'=$3::jsonb
          AND btrim(COALESCE(verification.coverage->>'all_player_source_revision',''))<>''
          AND COALESCE(verification.coverage->>'score_batch_fingerprint','') ~ '^sha256:[0-9a-f]{64}$'
          AND jsonb_typeof(verification.coverage->'parity_observation_ids')='array'
          AND jsonb_typeof(verification.coverage->'parity_observation_evidence')='object'
          AND jsonb_typeof(verification.coverage->'parity_expected_entity_count')='number'
          AND COALESCE(verification.coverage->>'parity_fingerprint','') ~ '^sha256:[0-9a-f]{64}$'
          AND public.all_player_scoring_contract_supported(candidate.provider,candidate.scorer_version,profile.rules)) AS shape_complete,
        (candidate.scored_entity_count=(SELECT count(*) FROM all_player_scores score WHERE score.all_player_score_set_id=candidate.id)
          AND candidate.eligible_game_count=COALESCE((SELECT sum(score.eligible_game_count) FROM all_player_scores score WHERE score.all_player_score_set_id=candidate.id),0)
          AND NOT EXISTS(SELECT 1 FROM all_player_scores score WHERE score.all_player_score_set_id=candidate.id
            AND score.eligible_game_count=1 AND score.nfl_game_id IS NULL)) AS physical_complete
        FROM all_player_score_sets candidate JOIN all_player_stat_contents content ON content.id=candidate.all_player_stat_content_id
        JOIN scoring_profiles profile ON profile.id=candidate.scoring_profile_id
        JOIN all_player_score_verifications verification ON verification.all_player_score_set_id=candidate.id
          AND verification.all_player_stat_observation_id=$2 WHERE candidate.id=$1`,
      [candidate.scoreSet, candidate.observation, JSON.stringify(expected)]))
        .toEqual([{ aliases_complete: true, shape_complete: true, physical_complete: true }]);
      const key = 'all-null-publication-prerequisite';
      const registration = stored(await createProjectionStore(owner.database).registerLeagueSeason({ mode: 'official-data',
        leagueKey: key, leagueName: key, sleeperLeagueId: key, season: period.season }));
      expect(registration.scoringProfileId).toBeNull();
      await owner.database.query(`INSERT INTO league_administration_enrollments(league_id,provider,active,evidence)
        VALUES($1,'sleeper',false,'public-data-intake-v1')`, [registration.leagueId]);
      await owner.database.query(`INSERT INTO league_administration_enrollment_seasons(league_id,season,provider,evidence)
        VALUES($1,$2,'sleeper','public-data-intake-v1')`, [registration.leagueId, period.season]);
      expect(await owner.database.query(`SELECT public.all_player_score_set_is_publication_ready($1,$2::jsonb,$3) AS ready`,
        [candidate.scoreSet, JSON.stringify(expected), candidate.observation])).toEqual([{ ready: false }]);
      const [membership] = await owner.database.query(`SELECT count(*)::integer AS total,
        count(*) FILTER (WHERE NOT EXISTS(SELECT 1 FROM league_seasons season JOIN league_source_connections connection
          ON connection.league_season_id=season.id AND connection.provider=enrollment.provider
          WHERE enrollment.evidence='public-data-intake-v1' AND season.league_id=enrollment.league_id
            AND season.season=enrollment.season AND season.scoring_profile_id IS NULL))::integer AS intended
        FROM league_administration_enrollment_seasons enrollment WHERE season=$1 AND provider='sleeper'`, [period.season]);
      expect(membership).toEqual({ total: 1, intended: 0 });
      expect(await owner.database.query('SELECT * FROM current_all_player_score_sets WHERE season=$1', [period.season])).toEqual([]);
      expect(await owner.database.query('SELECT * FROM current_all_player_league_scores WHERE season=$1', [period.season])).toEqual([]);
      expect(await owner.database.query('SELECT * FROM current_all_player_score_sets WHERE season=$1 ORDER BY scoring_profile_id', [DATABASE_SEASON])).toEqual(configuredPointers);
    } finally {
      if (ownerOpen) await owner.database.query('ROLLBACK');
      await owner.close();
    }
  });
});
