import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createProjectionStore,
  InvalidStoredProjectionSnapshotError,
  type LeagueSeasonReference,
  type PersistenceOutcome,
  type ProjectionStore,
  type PublishSnapshotInput,
} from '../lib/projection-store';
import {
  createIndependentDatabase,
  ownerQuery,
  runtimeQuery,
  type IndependentDatabase,
} from './neon-integration-harness';

type SnapshotPayload = PublishSnapshotInput['payload'];

function storedValue<Value>(outcome: PersistenceOutcome<Value>): Value {
  if (outcome.kind !== 'stored') throw new Error('The integration database was disabled.');
  return outcome.value;
}

function only<Value>(values: readonly Value[], label: string): Value {
  if (values.length !== 1) throw new Error(`${label} did not contain exactly one row.`);
  return values[0];
}

function time(minutes: number, seconds = 0): string {
  return new Date(Date.UTC(2026, 8, 3, 12, minutes, seconds)).toISOString();
}

function emptyPayload(week: number, updatedAt: string): SnapshotPayload {
  return {
    league: { season: '2026', rosterPositions: ['QB'], week, maxWeek: 18 },
    teams: [],
    updatedAt,
    week,
    matchups: [],
  };
}

function scheduledPayload(
  week: number,
  updatedAt: string,
  projectedPoints: number,
): SnapshotPayload {
  const team = {
    id: 1,
    managerName: 'Integration Manager',
    name: 'Integration Team',
    avatar: null,
    wins: 0,
    losses: 0,
    ties: 0,
    pointsFor: 0,
    pointsAgainst: 0,
  };
  return {
    league: { season: '2026', rosterPositions: ['QB'], week, maxWeek: 18 },
    teams: [team],
    updatedAt,
    week,
    matchups: [{
      id: String(week),
      status: 'live',
      sides: [{
        team,
        points: 8,
        projectedPoints,
        starters: [{
          id: 'integration-player',
          name: 'Integration Player',
          position: 'QB',
          nflTeam: 'IND',
          injuryStatus: null,
          game: {
            kind: 'scheduled',
            opponent: 'HOU',
            location: 'home',
            date: 'Sun 1:00 PM',
            kickoffAt: '2026-09-27T17:00:00.000Z',
          },
          slot: 'QB',
          points: 8,
          projectedPoints,
        }],
      }],
    }],
  };
}

describe.sequential('projection store against an isolated Neon database', () => {
  let primaryDatabase: IndependentDatabase;
  let store: ProjectionStore;
  let league: LeagueSeasonReference;
  let playerEntityId = '';
  let projectionGameId = '';
  let stateGameId = '';
  let snapshotGameId = '';
  let snapshotExtraGameId = '';
  let firstSnapshotId = '';
  let currentSnapshotId = '';
  let weekFiveSnapshotId = '';

  beforeAll(async () => {
    primaryDatabase = createIndependentDatabase();
    store = createProjectionStore(primaryDatabase.database);
    league = storedValue(await store.registerLeagueSeason({
      leagueKey: 'integration-league',
      leagueName: 'Integration League',
      season: 2026,
      sleeperLeagueId: 'integration-sleeper-league',
      scoringRules: { pass_td: 4, pass_yd: 0.04, pass_int: -2 },
    }));
  });

  afterAll(async () => {
    await primaryDatabase.close();
  });

  it('proves the suite migrated an empty schema and applied every migration once', async () => {
    const proof = JSON.parse(process.env.PROJECTION_INTEGRATION_SETUP_PROOF ?? 'null') as unknown;
    expect(proof).toMatchObject({
      emptyBeforeMigration: true,
      migrationNames: [
        '001_projection_foundation.sql',
        '002_manager_snapshot_payloads.sql',
        '003_league_period_authority.sql',
        '004_durable_projection_slates.sql',
        '006_flexed_kickoff_candidate_index.sql',
      ],
    });
    const rows = await ownerQuery<{ name: string; checksum_length: number }>(`
      SELECT name, length(checksum)::integer AS checksum_length
      FROM app_schema_migrations ORDER BY name
    `);
    expect(rows).toEqual([
      { name: '001_projection_foundation.sql', checksum_length: 64 },
      { name: '002_manager_snapshot_payloads.sql', checksum_length: 64 },
      { name: '003_league_period_authority.sql', checksum_length: 64 },
      { name: '004_durable_projection_slates.sql', checksum_length: 64 },
      { name: '006_flexed_kickoff_candidate_index.sql', checksum_length: 64 },
    ]);
  });

  it('registers both leagues, stores canonical scoring rules and hash, and keeps season profiles immutable', async () => {
    const repeated = storedValue(await store.registerLeagueSeason({
      leagueKey: 'integration-league',
      leagueName: 'Integration League',
      season: 2026,
      sleeperLeagueId: 'integration-sleeper-league',
      scoringRules: { pass_int: -2, pass_yd: 0.04, pass_td: 4 },
    }));
    expect(repeated).toEqual(league);

    const secondLeague = storedValue(await store.registerLeagueSeason({
      leagueKey: 'integration-league-two',
      leagueName: 'Integration League Two',
      season: 2026,
      sleeperLeagueId: 'integration-sleeper-league-two',
      scoringRules: { pass_int: -2, pass_yd: 0.04, pass_td: 4 },
    }));
    expect(secondLeague.leagueSeasonId).not.toBe(league.leagueSeasonId);
    expect(secondLeague.scoringProfileId).toBe(league.scoringProfileId);
    const registrations = await ownerQuery<{
      league_count: number;
      season_count: number;
      connection_count: number;
      scoring_profile_count: number;
    }>(`
      SELECT
        (SELECT count(*)::integer FROM leagues
          WHERE league_key IN ('integration-league', 'integration-league-two')) AS league_count,
        (SELECT count(*)::integer FROM league_seasons season
          JOIN leagues league ON league.id = season.league_id
          WHERE league.league_key IN ('integration-league', 'integration-league-two')
            AND season.season = 2026) AS season_count,
        (SELECT count(*)::integer FROM league_source_connections
          WHERE provider = 'sleeper'
            AND external_league_id IN (
              'integration-sleeper-league', 'integration-sleeper-league-two'
            )) AS connection_count,
        (SELECT count(DISTINCT season.scoring_profile_id)::integer
          FROM league_seasons season
          JOIN leagues league ON league.id = season.league_id
          WHERE league.league_key IN ('integration-league', 'integration-league-two')
            AND season.season = 2026) AS scoring_profile_count
    `);
    expect(only(registrations, 'League registration counts')).toEqual({
      league_count: 2,
      season_count: 2,
      connection_count: 2,
      scoring_profile_count: 1,
    });

    const rows = await ownerQuery<{
      id: string;
      rules: Record<string, number>;
      rules_hash: string;
    }>(`
      SELECT id::text, rules, rules_hash
      FROM scoring_profiles WHERE id = $1
    `, [league.scoringProfileId]);
    const row = only(rows, 'Scoring profile');
    expect(row.rules).toEqual({ pass_int: -2, pass_td: 4, pass_yd: 0.04 });
    expect(row.rules_hash).toBe(
      createHash('sha256').update('{"pass_int":-2,"pass_td":4,"pass_yd":0.04}').digest('hex'),
    );

    await expect(ownerQuery(
      "UPDATE scoring_profiles SET rules = '{\"pass_td\":6}'::jsonb WHERE id = $1",
      [league.scoringProfileId],
    )).rejects.toThrow(/immutable/iu);
    await expect(store.registerLeagueSeason({
      leagueKey: 'integration-league',
      leagueName: 'Integration League',
      season: 2026,
      sleeperLeagueId: 'integration-sleeper-league',
      scoringRules: { pass_td: 6, pass_yd: 0.04, pass_int: -2 },
    })).rejects.toThrow(/immutable/iu);
  });

  it('resolves concurrent provider identity upserts to one entity without an orphan', async () => {
    const leftDatabase = createIndependentDatabase();
    const rightDatabase = createIndependentDatabase();
    try {
      const [left, right] = await Promise.all([
        createProjectionStore(leftDatabase.database).upsertScoringEntities([{
          key: 'concurrent-left',
          kind: 'player',
          displayName: 'Concurrent Player Left',
          nflTeam: 'IND',
          providerIds: [
            { provider: 'sleeper', externalId: 'integration-player' },
            { provider: 'tank01', externalId: 'integration-tank-player' },
          ],
        }]),
        createProjectionStore(rightDatabase.database).upsertScoringEntities([{
          key: 'concurrent-right',
          kind: 'player',
          displayName: 'Concurrent Player Right',
          nflTeam: 'IND',
          providerIds: [
            { provider: 'sleeper', externalId: 'integration-player' },
            { provider: 'tank01', externalId: 'integration-tank-player' },
          ],
        }]),
      ]);
      const leftEntity = only(storedValue(left), 'Left identity result');
      const rightEntity = only(storedValue(right), 'Right identity result');
      expect(leftEntity.conflict).toBe(false);
      expect(rightEntity.conflict).toBe(false);
      expect(leftEntity.entityId).toBeTruthy();
      expect(rightEntity.entityId).toBe(leftEntity.entityId);
      playerEntityId = leftEntity.entityId ?? '';

      const rows = await ownerQuery<{
        entity_count: number;
        mapping_count: number;
        orphan_count: number;
      }>(`
        SELECT
          count(DISTINCT mapping.scoring_entity_id)::integer AS entity_count,
          count(*)::integer AS mapping_count,
          (SELECT count(*)::integer FROM scoring_entities entity
            WHERE entity.display_name LIKE 'Concurrent Player%'
              AND NOT EXISTS (
                SELECT 1 FROM external_scoring_entity_ids candidate
                WHERE candidate.scoring_entity_id = entity.id
              )) AS orphan_count
        FROM external_scoring_entity_ids mapping
        WHERE (mapping.provider, mapping.entity_kind, mapping.external_id) IN (
          ('sleeper', 'player', 'integration-player'),
          ('tank01', 'player', 'integration-tank-player')
        )
      `);
      expect(only(rows, 'Identity database result')).toEqual({
        entity_count: 1,
        mapping_count: 2,
        orphan_count: 0,
      });
    } finally {
      await Promise.allSettled([leftDatabase.close(), rightDatabase.close()]);
    }
  });

  it('keeps corrected game aliases together and rejects a conflicting reused external ID', async () => {
    const games = storedValue(await store.upsertNflGames([{
      key: 'projection-game',
      provider: 'tank01',
      externalGameId: 'projection-game-original',
      season: 2026,
      seasonType: 'reg',
      week: 1,
      homeTeam: 'IND',
      awayTeam: 'HOU',
      kickoffAt: '2026-09-13T17:00:00.000Z',
    }, {
      key: 'state-game',
      provider: 'tank01',
      externalGameId: 'state-game',
      season: 2026,
      seasonType: 'reg',
      week: 2,
      homeTeam: 'BUF',
      awayTeam: 'MIA',
      kickoffAt: '2026-09-20T17:00:00.000Z',
    }, {
      key: 'snapshot-game',
      provider: 'tank01',
      externalGameId: 'snapshot-game',
      season: 2026,
      seasonType: 'reg',
      week: 4,
      homeTeam: 'PHI',
      awayTeam: 'DAL',
      kickoffAt: '2026-09-27T17:00:00.000Z',
    }, {
      key: 'snapshot-extra-game',
      provider: 'tank01',
      externalGameId: 'snapshot-extra-game',
      season: 2026,
      seasonType: 'reg',
      week: 4,
      homeTeam: 'KC',
      awayTeam: 'LAC',
      kickoffAt: '2026-09-27T20:25:00.000Z',
    }]));
    projectionGameId = games.find(({ key }) => key === 'projection-game')?.gameId ?? '';
    stateGameId = games.find(({ key }) => key === 'state-game')?.gameId ?? '';
    snapshotGameId = games.find(({ key }) => key === 'snapshot-game')?.gameId ?? '';
    snapshotExtraGameId = games.find(({ key }) => key === 'snapshot-extra-game')?.gameId ?? '';
    expect([projectionGameId, stateGameId, snapshotGameId, snapshotExtraGameId])
      .not.toContain('');

    const corrected = only(storedValue(await store.upsertNflGames([{
      key: 'projection-game-corrected',
      provider: 'tank01',
      externalGameId: 'projection-game-corrected',
      season: 2026,
      seasonType: 'reg',
      week: 1,
      homeTeam: 'IND',
      awayTeam: 'HOU',
      kickoffAt: '2026-09-13T17:00:00.000Z',
    }])), 'Corrected game');
    expect(corrected.gameId).toBe(projectionGameId);

    const aliases = await ownerQuery<{ game_count: number; alias_count: number }>(`
      SELECT count(DISTINCT nfl_game_id)::integer AS game_count,
        count(*)::integer AS alias_count
      FROM external_game_ids
      WHERE provider = 'tank01'
        AND external_game_id IN ('projection-game-original', 'projection-game-corrected')
    `);
    expect(only(aliases, 'Game aliases')).toEqual({ game_count: 1, alias_count: 2 });

    const gameCountBeforeConflict = only(await ownerQuery<{ value: number }>(`
      SELECT count(*)::integer AS value FROM nfl_games
    `), 'Game count before conflict').value;
    await expect(store.upsertNflGames([{
      key: 'conflicting-game',
      provider: 'tank01',
      externalGameId: 'projection-game-original',
      season: 2026,
      seasonType: 'reg',
      week: 1,
      homeTeam: 'NYJ',
      awayTeam: 'NE',
      kickoffAt: '2026-09-13T17:00:00.000Z',
    }])).rejects.toThrow(/conflicts/iu);
    const conflictState = only(await ownerQuery<{ game_count: number; conflicting_games: number }>(`
      SELECT count(*)::integer AS game_count,
        count(*) FILTER (WHERE home_team = 'NYJ' AND away_team = 'NE')::integer
          AS conflicting_games
      FROM nfl_games
    `), 'Game state after conflict');
    expect(conflictState).toEqual({
      game_count: gameCountBeforeConflict,
      conflicting_games: 0,
    });
  });

  it('keeps projection runs idempotent, filters ineligible rows, and freezes a baseline once', async () => {
    const run = {
      provider: 'tank01',
      season: 2026,
      seasonType: 'reg' as const,
      week: 1,
      modelVersion: 'integration-pregame-v1',
      sourceRevision: 'projection-valid-1',
      requestStartedAt: time(0),
      requestCompletedAt: time(0, 1),
      fetchedAt: time(0, 1),
      quality: 'complete' as const,
      candidates: [{
        gameId: projectionGameId,
        entityId: playerEntityId,
        scoringProfileId: league.scoringProfileId,
        projectionPoints: 17.25,
        projectedStats: { passingYards: 250, passingTouchdowns: 1.5 },
        quality: 'complete' as const,
      }],
    };
    const first = storedValue(await store.recordProjectionCandidates(run));
    const replay = storedValue(await store.recordProjectionCandidates(run));
    expect(replay).toEqual({
      runId: first.runId,
      candidatesStored: 0,
      candidateCount: 1,
    });

    await store.recordProjectionCandidates({
      ...run,
      sourceRevision: 'projection-partial',
      fetchedAt: time(5),
      quality: 'partial',
      candidates: [{ ...run.candidates[0], projectionPoints: 88 }],
    });
    await store.recordProjectionCandidates({
      ...run,
      sourceRevision: 'projection-invalid-candidate',
      fetchedAt: time(10),
      candidates: [{ ...run.candidates[0], projectionPoints: 77, quality: 'invalid' }],
    });

    const readInput = {
      leagueSeasonId: league.leagueSeasonId,
      season: 2026,
      seasonType: 'reg' as const,
      week: 1,
      provider: 'tank01',
      modelVersion: 'integration-pregame-v1',
      sleeperPlayerIds: ['integration-player'],
    };
    expect(only(await store.readLatestCandidatesBySleeperIds(readInput), 'Eligible projection'))
      .toMatchObject({ projectionPoints: 17.25, sourceProjectionRunId: first.runId });

    const frozenAt = '2026-09-13T17:00:01.000Z';
    const firstFreeze = only(storedValue(await store.freezeLatestBaselines({
      leagueSeasonId: league.leagueSeasonId,
      season: 2026,
      seasonType: 'reg',
      week: 1,
      modelVersion: 'integration-pregame-v1',
      projectionProvider: 'tank01',
      gameProvider: 'tank01',
      externalGameIds: ['projection-game-original'],
      frozenAt,
    })), 'First frozen baseline');
    expect(firstFreeze).toMatchObject({ projectionPoints: 17.25 });
    expect(firstFreeze.frozenAt).toBe('2026-09-13 17:00:01+00');
    expect(Date.parse(firstFreeze.frozenAt ?? '')).toBe(Date.parse(frozenAt));

    await store.recordProjectionCandidates({
      ...run,
      sourceRevision: 'projection-newer-complete',
      fetchedAt: time(15),
      candidates: [{ ...run.candidates[0], projectionPoints: 25.5 }],
    });
    expect(only(await store.readLatestCandidatesBySleeperIds(readInput), 'Latest projection'))
      .toMatchObject({ projectionPoints: 25.5 });
    const secondFreeze = only(storedValue(await store.freezeLatestBaselines({
      leagueSeasonId: league.leagueSeasonId,
      season: 2026,
      seasonType: 'reg',
      week: 1,
      modelVersion: 'integration-pregame-v1',
      projectionProvider: 'tank01',
      gameProvider: 'tank01',
      externalGameIds: ['projection-game-corrected'],
      frozenAt: '2026-09-13T17:05:00.000Z',
    })), 'Repeated frozen baseline');
    expect(secondFreeze).toMatchObject({
      projectionPoints: 17.25,
      sourceProjectionRunId: first.runId,
    });
    expect(secondFreeze.frozenAt).toBe(firstFreeze.frozenAt);

    expect(await store.readFrozenBaselinesBySleeperIds({
      ...readInput,
      sleeperPlayerIds: ['missing-integration-player'],
    })).toEqual([]);
    const baselineRows = await ownerQuery<{ baseline_count: number }>(`
      SELECT count(*)::integer AS baseline_count FROM pregame_projection_baselines
    `);
    expect(only(baselineRows, 'Baseline count').baseline_count).toBe(1);
    await expect(ownerQuery(`
      UPDATE pregame_projection_baselines SET projection_points = 999
      WHERE nfl_game_id = $1 AND scoring_entity_id = $2
    `, [projectionGameId, playerEntityId])).rejects.toThrow(/immutable/iu);
  });

  it('rebuilds candidate pointers across earlier and later kickoff flexes and protects history', async () => {
    const flexGame = only(storedValue(await store.upsertNflGames([{
      key: 'flex-game', provider: 'tank01', externalGameId: 'flex-game',
      season: 2026, seasonType: 'reg', week: 3,
      homeTeam: 'LAC', awayTeam: 'KC', kickoffAt: '2026-09-30T18:00:00.000Z',
    }])), 'Flex game');
    const candidate = {
      gameId: flexGame.gameId,
      entityId: playerEntityId,
      scoringProfileId: league.scoringProfileId,
      projectedStats: { passingYards: 250 },
      quality: 'complete' as const,
    };
    const run = {
      provider: 'tank01', season: 2026, seasonType: 'reg' as const, week: 3,
      modelVersion: 'integration-flex-v1', requestStartedAt: '2026-09-30T15:59:59.000Z',
      requestCompletedAt: '2026-09-30T16:00:00.000Z', quality: 'complete' as const,
    };
    const early = storedValue(await store.recordProjectionCandidates({
      ...run, sourceRevision: 'flex-early', fetchedAt: '2026-09-30T16:00:00.000Z',
      candidates: [{ ...candidate, projectionPoints: 10 }],
    }));
    const later = storedValue(await store.recordProjectionCandidates({
      ...run, sourceRevision: 'flex-later', fetchedAt: '2026-09-30T17:30:00.000Z',
      candidates: [{ ...candidate, projectionPoints: 20 }],
    }));
    const invalid = storedValue(await store.recordProjectionCandidates({
      ...run, sourceRevision: 'flex-invalid', fetchedAt: '2026-09-30T16:30:00.000Z',
      candidates: [{ ...candidate, projectionPoints: 99, quality: 'invalid' }],
    }));
    const nullKickoffGame = only(storedValue(await store.upsertNflGames([{
      key: 'null-kickoff-game', provider: 'tank01', externalGameId: 'null-kickoff-game',
      season: 2026, seasonType: 'reg', week: 3,
      homeTeam: 'BAL', awayTeam: 'PIT', kickoffAt: null,
    }])), 'Null-kickoff game');
    const recentGame = only(storedValue(await store.upsertNflGames([{
      key: 'recent-game', provider: 'tank01', externalGameId: 'recent-game',
      season: 2026, seasonType: 'reg', week: 3,
      homeTeam: 'DET', awayTeam: 'GB', kickoffAt: '2026-09-02T17:00:00.000Z',
    }])), 'Recent game');
    const nullKickoff = storedValue(await store.recordProjectionCandidates({
      ...run,
      sourceRevision: 'null-kickoff-candidate',
      requestStartedAt: '2026-08-30T15:59:59.000Z',
      requestCompletedAt: '2026-08-30T16:00:00.000Z',
      fetchedAt: '2026-08-30T16:00:00.000Z',
      candidates: [{
        ...candidate, gameId: nullKickoffGame.gameId, projectionPoints: 30,
      }],
    }));
    const recent = storedValue(await store.recordProjectionCandidates({
      ...run,
      sourceRevision: 'recent-game-candidate',
      requestStartedAt: '2026-08-30T15:59:59.000Z',
      requestCompletedAt: '2026-08-30T16:00:00.000Z',
      fetchedAt: '2026-08-30T16:00:00.000Z',
      candidates: [{ ...candidate, gameId: recentGame.gameId, projectionPoints: 40 }],
    }));
    const readInput = {
      leagueSeasonId: league.leagueSeasonId, season: 2026, seasonType: 'reg' as const,
      week: 3, provider: 'tank01', modelVersion: 'integration-flex-v1',
      sleeperPlayerIds: ['integration-player'],
    };
    expect(only(await store.readLatestCandidatesBySleeperIds(readInput), 'Initial flex pointer'))
      .toMatchObject({ projectionPoints: 20, sourceProjectionRunId: later.runId });

    // Inject an invalid pointer to prove the identity-safe rebuild repairs rather
    // than trusts mutable pointer state.
    await ownerQuery(`
      UPDATE current_pregame_projection_candidates current
      SET projection_run_id = $1,
        source_fetched_at = '2026-09-30T16:30:00.000Z',
        source_run_created_at = run.created_at
      FROM pregame_projection_runs run
      WHERE run.id = $1 AND current.nfl_game_id = $2
        AND current.scoring_entity_id = $3
        AND current.scoring_profile_id = $4
        AND current.projection_provider = 'tank01'
        AND current.model_version = 'integration-flex-v1'
    `, [invalid.runId, flexGame.gameId, playerEntityId, league.scoringProfileId]);

    await store.upsertNflGames([{
      key: 'flex-game-earlier', provider: 'tank01', externalGameId: 'flex-game',
      season: 2026, seasonType: 'reg', week: 3,
      homeTeam: 'LAC', awayTeam: 'KC', kickoffAt: '2026-09-30T17:00:00.000Z',
    }]);
    expect(only(await store.readLatestCandidatesBySleeperIds(readInput), 'Earlier flex pointer'))
      .toMatchObject({ projectionPoints: 10, sourceProjectionRunId: early.runId });
    expect(only(await ownerQuery<{ kickoff_at: string }>(`
      SELECT kickoff_at::text FROM nfl_games WHERE id = $1
    `, [flexGame.gameId]), 'Earlier flex kickoff').kickoff_at)
      .toBe('2026-09-30 17:00:00+00');

    // Reproduce the only unsafe-looking state a concurrent candidate write can
    // leave behind: the mutable pointer references a complete run observed
    // after the newly earlier kickoff. The authoritative read predicate must
    // fail closed until the next ordinary game upsert repairs the pointer.
    await ownerQuery(`
      UPDATE current_pregame_projection_candidates current
      SET projection_run_id = $1,
        source_fetched_at = '2026-09-30T17:30:00.000Z',
        source_run_created_at = run.created_at
      FROM pregame_projection_runs run
      WHERE run.id = $1 AND current.nfl_game_id = $2
        AND current.scoring_entity_id = $3
        AND current.scoring_profile_id = $4
        AND current.projection_provider = 'tank01'
        AND current.model_version = 'integration-flex-v1'
    `, [later.runId, flexGame.gameId, playerEntityId, league.scoringProfileId]);
    expect(await store.readLatestCandidatesBySleeperIds(readInput)).toEqual([]);
    await store.upsertNflGames([{
      key: 'flex-game-repair', provider: 'tank01', externalGameId: 'flex-game',
      season: 2026, seasonType: 'reg', week: 3,
      homeTeam: 'LAC', awayTeam: 'KC', kickoffAt: '2026-09-30T17:00:00.000Z',
    }]);
    expect(only(await store.readLatestCandidatesBySleeperIds(readInput), 'Repaired flex pointer'))
      .toMatchObject({ projectionPoints: 10, sourceProjectionRunId: early.runId });

    await ownerQuery(`
      UPDATE pregame_projection_runs SET created_at = '2000-01-01T00:00:00.000Z'
      WHERE id = ANY($1::uuid[])
    `, [[early.runId, later.runId, invalid.runId, nullKickoff.runId, recent.runId]]);
    await store.pruneHistory({
      before: '2026-09-01T00:00:00.000Z', keepRecentSnapshotsPerLeagueWeek: 3,
    });
    const retained = only(await ownerQuery<{ value: number }>(`
      SELECT count(*)::integer AS value FROM pregame_projection_runs
      WHERE id = ANY($1::uuid[])
    `, [[
      early.runId, later.runId, invalid.runId, nullKickoff.runId, recent.runId,
    ]]), 'Retained flex runs');
    expect(retained.value).toBe(5);

    await store.upsertNflGames([{
      key: 'flex-game-later', provider: 'tank01', externalGameId: 'flex-game',
      season: 2026, seasonType: 'reg', week: 3,
      homeTeam: 'LAC', awayTeam: 'KC', kickoffAt: '2026-09-30T19:00:00.000Z',
    }]);
    expect(only(await store.readLatestCandidatesBySleeperIds(readInput), 'Later flex pointer'))
      .toMatchObject({ projectionPoints: 20, sourceProjectionRunId: later.runId });
  });

  it('accepts forward game progress and rejects clock, period, and final-state regression', async () => {
    const state = (
      sourceRevision: string,
      at: string,
      statusCode: 0 | 1 | 2 | 3 | 4,
      period: string | null,
      gameClock: string | null,
    ) => ({
      externalGameId: 'state-game',
      sourceRevision,
      requestStartedAt: at,
      requestCompletedAt: at,
      observedAt: at,
      statusCode,
      period,
      gameClock,
      homeScore: statusCode === 0 ? null : 7,
      awayScore: statusCode === 0 ? null : 3,
      sourceData: { sourceRevision },
    });
    await store.recordGameStates({ provider: 'tank01', states: [
      state('state-pregame', time(20), 0, null, null),
    ] });
    await store.recordGameStates({ provider: 'tank01', states: [
      state('state-live-10', time(21), 1, 'Q1', '10:00'),
    ] });
    await store.recordGameStates({ provider: 'tank01', states: [
      state('state-live-5', time(22), 1, 'Q1', '05:00'),
    ] });
    await expect(store.recordGameStates({ provider: 'tank01', states: [
      state('state-clock-regression', time(23), 1, 'Q1', '07:00'),
    ] })).rejects.toThrow(/clock increased/iu);
    await store.recordGameStates({ provider: 'tank01', states: [
      state('state-halftime', time(24), 1, 'HALFTIME', null),
    ] });
    await expect(store.recordGameStates({ provider: 'tank01', states: [
      state('state-period-regression', time(25), 1, 'Q1', '01:00'),
    ] })).rejects.toThrow(/period moved backward/iu);
    const final = only(storedValue(await store.recordGameStates({ provider: 'tank01', states: [
      state('state-final', time(26), 2, 'FINAL', null),
    ] })), 'Final game state');
    const replay = only(storedValue(await store.recordGameStates({ provider: 'tank01', states: [
      state('state-final', time(26), 2, 'FINAL', null),
    ] })), 'Replayed final state');
    expect(replay.observationId).toBe(final.observationId);
    await expect(store.recordGameStates({ provider: 'tank01', states: [
      state('state-after-final', time(27), 1, 'Q4', '00:30'),
    ] })).rejects.toThrow(/final game became non-final/iu);

    const rows = await ownerQuery<{ states: number; final_states: number }>(`
      SELECT count(*)::integer AS states,
        count(*) FILTER (WHERE status_code = 2)::integer AS final_states
      FROM game_state_observations WHERE nfl_game_id = $1
    `, [stateGameId]);
    expect(only(rows, 'Game state history')).toEqual({ states: 5, final_states: 1 });
  });

  it('replays official observations without duplication and reports unmapped inputs', async () => {
    const input = {
      leagueSeasonId: league.leagueSeasonId,
      week: 1,
      sourceRevision: 'official-observation-replay',
      requestStartedAt: time(30),
      requestCompletedAt: time(30, 1),
      observedAt: time(30, 1),
      quality: 'complete' as const,
      sourceData: { source: 'integration-replay' },
      expectedTank01GameIds: ['projection-game-original', 'unmapped-game'],
      playerPoints: [{
        sleeperPlayerId: 'integration-player',
        entityKind: 'player' as const,
        externalRosterId: 'roster-1',
        points: 12.5,
        isStarter: true,
        lineupSlot: 'QB',
      }, {
        sleeperPlayerId: 'unmapped-player',
        entityKind: 'player' as const,
        externalRosterId: 'roster-1',
        points: 1,
        isStarter: false,
        lineupSlot: 'BN',
      }, {
        sleeperPlayerId: 'unmapped-defense',
        entityKind: 'team_defense' as const,
        externalRosterId: 'roster-1',
        points: 5,
        isStarter: true,
        lineupSlot: 'DEF',
      }],
      rosterPoints: [{ externalRosterId: 'roster-1', points: 12.5 }],
    };
    const first = storedValue(await store.recordLeagueWeekObservation(input));
    const replay = storedValue(await store.recordLeagueWeekObservation(input));
    expect(replay).toEqual(first);
    expect(first).toMatchObject({
      playerPointsStored: 1,
      rosterPointsStored: 1,
      unmappedSleeperPlayerIds: ['unmapped-defense', 'unmapped-player'],
      expectedGamesStored: 1,
      unmappedTank01GameIds: ['unmapped-game'],
    });

    const rows = await ownerQuery<{
      observations: number;
      players: number;
      rosters: number;
      expected_games: number;
    }>(`
      SELECT
        count(*)::integer AS observations,
        (SELECT count(*)::integer FROM official_player_point_observations
          WHERE league_week_observation_id = $1) AS players,
        (SELECT count(*)::integer FROM official_roster_point_observations
          WHERE league_week_observation_id = $1) AS rosters,
        (SELECT count(*)::integer FROM league_week_expected_games
          WHERE league_week_observation_id = $1) AS expected_games
      FROM league_week_observations WHERE id = $1
    `, [first.observationId]);
    expect(only(rows, 'Official observation rows')).toEqual({
      observations: 1,
      players: 1,
      rosters: 1,
      expected_games: 1,
    });
  });

  it('allows only one competing job claim and enforces lease ownership', async () => {
    const leftDatabase = createIndependentDatabase();
    const rightDatabase = createIndependentDatabase();
    const jobKey = `integration-job-${randomUUID()}`;
    const scheduledFor = time(35);
    try {
      const left = createProjectionStore(leftDatabase.database);
      const right = createProjectionStore(rightDatabase.database);
      const [leftClaim, rightClaim] = await Promise.all([
        left.acquireJob({
          jobKey,
          jobType: 'projection-sync',
          scheduledFor,
          payload: { league: 'integration' },
          workerId: 'worker-left',
          leaseSeconds: 120,
        }),
        right.acquireJob({
          jobKey,
          jobType: 'projection-sync',
          scheduledFor,
          payload: { league: 'integration' },
          workerId: 'worker-right',
          leaseSeconds: 120,
        }),
      ]);
      expect([leftClaim.kind, rightClaim.kind].toSorted()).toEqual(['acquired', 'busy']);
      const winner = leftClaim.kind === 'acquired'
        ? { store: left, workerId: 'worker-left' }
        : { store: right, workerId: 'worker-right' };
      const loser = winner.workerId === 'worker-left'
        ? { store: right, workerId: 'worker-right' }
        : { store: left, workerId: 'worker-left' };
      expect(await loser.store.completeJob(jobKey, loser.workerId)).toBe(false);
      expect(await loser.store.failJob(jobKey, loser.workerId, 'not the lease owner')).toBe(false);
      expect(await winner.store.completeJob(jobKey, winner.workerId)).toBe(true);
      expect(await loser.store.acquireJob({
        jobKey,
        jobType: 'projection-sync',
        scheduledFor,
        payload: { league: 'integration' },
        workerId: loser.workerId,
        leaseSeconds: 120,
      })).toEqual({ kind: 'completed' });
      const next = await loser.store.acquireJob({
        jobKey,
        jobType: 'projection-sync',
        scheduledFor: time(36),
        payload: { league: 'integration' },
        workerId: loser.workerId,
        leaseSeconds: 120,
      });
      expect(next.kind).toBe('acquired');
      expect(await loser.store.failJob(jobKey, loser.workerId, 'controlled integration failure'))
        .toBe(true);

      const expiredJobKey = `integration-expired-job-${randomUUID()}`;
      const expiring = await left.acquireJob({
        jobKey: expiredJobKey,
        jobType: 'projection-sync',
        scheduledFor: time(37),
        payload: { league: 'integration-expired' },
        workerId: 'worker-expired',
        leaseSeconds: 120,
      });
      expect(expiring.kind).toBe('acquired');
      await ownerQuery(`
        UPDATE projection_jobs SET lease_until = now() - interval '1 second'
        WHERE job_key = $1
      `, [expiredJobKey]);
      const reclaimed = await right.acquireJob({
        jobKey: expiredJobKey,
        jobType: 'projection-sync',
        scheduledFor: time(37),
        payload: { league: 'integration-reclaimed' },
        workerId: 'worker-reclaimed',
        leaseSeconds: 120,
      });
      expect(reclaimed).toMatchObject({ kind: 'acquired', attempt: 2 });
      expect(await right.completeJob(expiredJobKey, 'worker-reclaimed')).toBe(true);
    } finally {
      await Promise.allSettled([leftDatabase.close(), rightDatabase.close()]);
    }
  });

  it('publishes only synchronized exact source sets and preserves immutable snapshot history', async () => {
    const activityWindows = [{
      startsAt: '2026-09-27T15:00:00.000Z',
      endsAt: '2026-09-28T00:00:00.000Z',
    }] as const;
    const recordLeagueSource = async (sourceRevision: string, at: string) => storedValue(
      await store.recordLeagueWeekObservation({
        leagueSeasonId: league.leagueSeasonId,
        week: 4,
        sourceRevision,
        requestStartedAt: at,
        requestCompletedAt: at,
        observedAt: at,
        quality: 'complete',
        sourceData: { games: [{ kind: 'scheduled' }] },
        expectedTank01GameIds: ['snapshot-game'],
        playerPoints: [{
          sleeperPlayerId: 'integration-player',
          entityKind: 'player',
          externalRosterId: 'roster-1',
          points: 8,
          isStarter: true,
          lineupSlot: 'QB',
        }],
        rosterPoints: [{ externalRosterId: 'roster-1', points: 8 }],
      }),
    );
    const recordGameSource = async (
      externalGameId: string,
      sourceRevision: string,
      at: string,
    ) => only(storedValue(await store.recordGameStates({
      provider: 'tank01',
      states: [{
        externalGameId,
        sourceRevision,
        requestStartedAt: at,
        requestCompletedAt: at,
        observedAt: at,
        statusCode: 0,
        period: null,
        gameClock: null,
        homeScore: null,
        awayScore: null,
        sourceData: { sourceRevision },
      }],
    })), 'Snapshot game source');
    const publish = (
      revisionKey: string,
      calculatedAt: string,
      payload: SnapshotPayload,
      leagueWeekObservationId: string,
      gameStateObservationIds: readonly string[],
    ) => store.publishSnapshot({
      leagueSeasonId: league.leagueSeasonId,
      week: 4,
      modelVersion: 'clock-v1',
      revisionKey,
      leagueWeekObservationId,
      gameStateObservationIds,
      calculatedAt,
      payload,
      activityWindows,
      maxSourceSkewSeconds: 90,
    });

    const setTime = time(40);
    const exactLeague = await recordLeagueSource('snapshot-source-set', setTime);
    const exactGame = await recordGameSource('snapshot-game', 'snapshot-game-set', setTime);
    const extraGame = await recordGameSource(
      'snapshot-extra-game',
      'snapshot-extra-game-set',
      setTime,
    );
    await expect(publish(
      'snapshot-missing-source-set',
      setTime,
      scheduledPayload(4, setTime, 20),
      exactLeague.observationId,
      [],
    )).resolves.toEqual({ kind: 'rejected', reason: 'incomplete-or-mismatched-sources' });
    await expect(publish(
      'snapshot-wrong-source-set',
      setTime,
      scheduledPayload(4, setTime, 20),
      exactLeague.observationId,
      [exactGame.observationId, extraGame.observationId],
    )).resolves.toEqual({ kind: 'rejected', reason: 'incomplete-or-mismatched-sources' });

    const secondExactGame = await recordGameSource(
      'snapshot-game',
      'snapshot-game-set-second-observation',
      setTime,
    );
    expect(secondExactGame.observationId).not.toBe(exactGame.observationId);
    await expect(publish(
      'snapshot-duplicate-game-observations',
      setTime,
      scheduledPayload(4, setTime, 20),
      exactLeague.observationId,
      [exactGame.observationId, secondExactGame.observationId],
    )).resolves.toEqual({ kind: 'rejected', reason: 'incomplete-or-mismatched-sources' });

    const skewLeagueTime = time(41);
    const skewGameTime = time(44);
    const skewLeague = await recordLeagueSource('snapshot-skew-league', skewLeagueTime);
    const skewGame = await recordGameSource('snapshot-game', 'snapshot-skew-game', skewGameTime);
    await expect(publish(
      'snapshot-skewed',
      skewLeagueTime,
      scheduledPayload(4, skewLeagueTime, 20),
      skewLeague.observationId,
      [skewGame.observationId],
    )).resolves.toEqual({ kind: 'rejected', reason: 'incomplete-or-mismatched-sources' });

    const firstTime = time(45);
    const firstLeague = await recordLeagueSource('snapshot-valid-first', firstTime);
    const firstGame = await recordGameSource('snapshot-game', 'snapshot-valid-game-first', firstTime);
    const first = await publish(
      'snapshot-valid-first',
      firstTime,
      scheduledPayload(4, firstTime, 20),
      firstLeague.observationId,
      [firstGame.observationId, firstGame.observationId, firstGame.observationId],
    );
    expect(first.kind).toBe('published');
    if (first.kind !== 'published') throw new Error('The first snapshot was not published.');
    firstSnapshotId = first.snapshot.snapshotId;
    const firstRows = await ownerQuery<{
      revision_key: string;
      content_hash: string;
      source_count: number;
      source_id: string;
    }>(`
      SELECT revision_key, content_hash,
        cardinality(game_state_observation_ids)::integer AS source_count,
        game_state_observation_ids[1]::text AS source_id
      FROM projection_snapshots WHERE id = $1
    `, [firstSnapshotId]);
    expect(only(firstRows, 'First snapshot hash and normalized sources')).toEqual({
      revision_key: 'snapshot-valid-first',
      content_hash: 'feb06d8bb810fd4d315948e2a3e32f3cef284d898a057d7da10a509e9a60d756',
      source_count: 1,
      source_id: firstGame.observationId,
    });

    const verificationTime = time(46);
    const verificationLeague = await recordLeagueSource(
      'snapshot-valid-unchanged',
      verificationTime,
    );
    const verificationGame = await recordGameSource(
      'snapshot-game',
      'snapshot-valid-game-unchanged',
      verificationTime,
    );
    const unchanged = await publish(
      'snapshot-valid-unchanged',
      verificationTime,
      scheduledPayload(4, verificationTime, 20),
      verificationLeague.observationId,
      [verificationGame.observationId],
    );
    expect(unchanged.kind).toBe('unchanged');
    if (unchanged.kind !== 'unchanged') throw new Error('The snapshot was not unchanged.');
    expect(unchanged.snapshot.snapshotId).toBe(firstSnapshotId);
    expect(unchanged.snapshot.publishedAt).toBe(first.snapshot.publishedAt);
    expect(Date.parse(unchanged.snapshot.verifiedAt)).toBeGreaterThan(
      Date.parse(first.snapshot.verifiedAt),
    );

    const changedTime = time(47);
    const changedLeague = await recordLeagueSource('snapshot-valid-changed', changedTime);
    const changedGame = await recordGameSource(
      'snapshot-game',
      'snapshot-valid-game-changed',
      changedTime,
    );
    const changed = await publish(
      'snapshot-valid-changed',
      changedTime,
      scheduledPayload(4, changedTime, 21),
      changedLeague.observationId,
      [changedGame.observationId],
    );
    expect(changed.kind).toBe('published');
    if (changed.kind !== 'published') throw new Error('The changed snapshot was not published.');
    currentSnapshotId = changed.snapshot.snapshotId;
    expect(currentSnapshotId).not.toBe(firstSnapshotId);

    const older = await publish(
      'snapshot-older-than-current',
      time(45, 30),
      scheduledPayload(4, time(45, 30), 99),
      firstLeague.observationId,
      [firstGame.observationId],
    );
    expect(older).toEqual({ kind: 'rejected', reason: 'incomplete-or-mismatched-sources' });
    expect(await store.readCurrentSnapshot(league.leagueSeasonId, 4)).toMatchObject({
      snapshotId: currentSnapshotId,
      payload: { matchups: [{ sides: [{ projectedPoints: 21 }] }] },
    });

    const history = await ownerQuery<{ snapshot_count: number; current_snapshot_id: string }>(`
      SELECT count(snapshot.id)::integer AS snapshot_count,
        max(current.snapshot_id::text) AS current_snapshot_id
      FROM projection_snapshots snapshot
      LEFT JOIN current_projection_snapshots current
        ON current.league_season_id = snapshot.league_season_id
        AND current.week = snapshot.week
      WHERE snapshot.league_season_id = $1 AND snapshot.week = 4
    `, [league.leagueSeasonId]);
    expect(only(history, 'Snapshot history')).toEqual({
      snapshot_count: 2,
      current_snapshot_id: currentSnapshotId,
    });
    await expect(ownerQuery(`
      UPDATE projection_snapshots SET content_hash = 'changed' WHERE id = $1
    `, [firstSnapshotId])).rejects.toThrow(/immutable/iu);
  });

  it('returns a requested historical week and the latest week in one database query', async () => {
    const at = time(50);
    const observation = storedValue(await store.recordLeagueWeekObservation({
      leagueSeasonId: league.leagueSeasonId,
      week: 5,
      sourceRevision: 'week-five-official',
      requestStartedAt: at,
      requestCompletedAt: at,
      observedAt: at,
      quality: 'complete',
      sourceData: { source: 'integration' },
      expectedTank01GameIds: [],
      playerPoints: [],
      rosterPoints: [],
    }));
    const result = await store.publishSnapshot({
      leagueSeasonId: league.leagueSeasonId,
      week: 5,
      modelVersion: 'clock-v1',
      revisionKey: 'week-five-snapshot',
      leagueWeekObservationId: observation.observationId,
      gameStateObservationIds: [],
      calculatedAt: at,
      payload: emptyPayload(5, at),
      activityWindows: [],
      maxSourceSkewSeconds: 90,
    });
    expect(result.kind).toBe('published');
    if (result.kind !== 'published') throw new Error('The Week 5 snapshot was not published.');
    weekFiveSnapshotId = result.snapshot.snapshotId;

    const counted = createIndependentDatabase();
    let queryCount = 0;
    try {
      const countedStore = createProjectionStore({
        enabled: true,
        async query<Row extends Readonly<Record<string, unknown>>>(
          statement: string,
          parameters: readonly unknown[] = [],
        ) {
          queryCount += 1;
          return counted.database.query<Row>(statement, parameters);
        },
      });
      const selection = await countedStore.readSnapshotSelectionBySleeperLeagueId(
        'integration-sleeper-league',
        4,
      );
      expect(queryCount).toBe(1);
      expect(selection.selected).toMatchObject({ snapshotId: currentSnapshotId, week: 4 });
      expect(selection.latest).toMatchObject({ snapshotId: weekFiveSnapshotId, week: 5 });
    } finally {
      await counted.close();
    }
  });

  it('rejects a structurally valid JSON row whose stored matchup payload is malformed', async () => {
    const at = time(55);
    const observation = storedValue(await store.recordLeagueWeekObservation({
      leagueSeasonId: league.leagueSeasonId,
      week: 18,
      sourceRevision: 'malformed-owner-source',
      requestStartedAt: at,
      requestCompletedAt: at,
      observedAt: at,
      quality: 'complete',
      sourceData: { source: 'owner-malformed-test' },
      expectedTank01GameIds: [],
      playerPoints: [],
      rosterPoints: [],
    }));
    const rows = await ownerQuery<{ snapshot_id: string }>(`
      WITH snapshot AS (
        INSERT INTO projection_snapshots (
          league_season_id, week, model_version, revision_key, content_hash,
          league_week_observation_id, game_state_observation_ids,
          calculated_at, quality, payload, activity_windows
        ) VALUES ($1, 18, 'clock-v1', 'malformed-owner-snapshot', 'malformed',
          $2, '{}'::uuid[], $3, 'complete', '{}'::jsonb, '[]'::jsonb)
        RETURNING id
      ), pointer AS (
        INSERT INTO current_projection_snapshots (
          league_season_id, week, snapshot_id, calculated_at, published_at, verified_at
        ) SELECT $1, 18, snapshot.id, $3, $3, $3 FROM snapshot
        RETURNING snapshot_id
      )
      SELECT snapshot_id::text FROM pointer
    `, [league.leagueSeasonId, observation.observationId, at]);
    const malformedSnapshotId = only(rows, 'Malformed snapshot').snapshot_id;
    try {
      const currentError = await store.readCurrentSnapshot(league.leagueSeasonId, 18)
        .then(() => null, (error: unknown) => error);
      const selectionError = await store.readSnapshotSelectionBySleeperLeagueId(
        'integration-sleeper-league',
        18,
      ).then(() => null, (error: unknown) => error);
      for (const error of [currentError, selectionError]) {
        expect(error).toBeInstanceOf(InvalidStoredProjectionSnapshotError);
        expect((error as Error).constructor).toBe(InvalidStoredProjectionSnapshotError);
      }
    } finally {
      await ownerQuery(
        'DELETE FROM current_projection_snapshots WHERE league_season_id = $1 AND week = 18',
        [league.leagueSeasonId],
      );
      await ownerQuery('DELETE FROM projection_snapshots WHERE id = $1', [malformedSnapshotId]);
    }
  });

  it('keeps the runtime role restricted while allowing the store facade to operate', async () => {
    const identity = only(await runtimeQuery<{
      database_user: string;
      can_create_schema_objects: boolean;
      can_create_database_objects: boolean;
      can_read_migrations: boolean;
      can_insert_snapshots: boolean;
      can_update_snapshots: boolean;
      can_delete_candidate_pointers: boolean;
    }>(`
      SELECT current_user AS database_user,
        has_schema_privilege(current_user, 'public', 'CREATE') AS can_create_schema_objects,
        has_database_privilege(current_user, current_database(), 'CREATE')
          AS can_create_database_objects,
        has_table_privilege(current_user, 'public.app_schema_migrations', 'SELECT')
          AS can_read_migrations,
        has_table_privilege(current_user, 'public.projection_snapshots', 'INSERT')
          AS can_insert_snapshots,
        has_table_privilege(current_user, 'public.projection_snapshots', 'UPDATE')
          AS can_update_snapshots,
        has_table_privilege(
          current_user, 'public.current_pregame_projection_candidates', 'DELETE'
        ) AS can_delete_candidate_pointers
    `), 'Runtime privileges');
    expect(identity).toEqual({
      database_user: 'league_one_runtime',
      can_create_schema_objects: false,
      can_create_database_objects: false,
      can_read_migrations: false,
      can_insert_snapshots: true,
      can_update_snapshots: false,
      can_delete_candidate_pointers: true,
    });
    await expect(runtimeQuery('SELECT * FROM app_schema_migrations')).rejects.toThrow(/permission/iu);
    await expect(runtimeQuery('CREATE TABLE integration_forbidden (id integer)'))
      .rejects.toThrow(/permission/iu);

    const role = only(await ownerQuery<{
      rolcanlogin: boolean;
      rolsuper: boolean;
      rolcreatedb: boolean;
      rolcreaterole: boolean;
      rolreplication: boolean;
      inherits_neon_superuser: boolean;
    }>(`
      SELECT role.rolcanlogin, role.rolsuper, role.rolcreatedb, role.rolcreaterole,
        role.rolreplication,
        CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'neon_superuser')
          THEN pg_has_role(role.rolname, 'neon_superuser', 'MEMBER')
          ELSE false END AS inherits_neon_superuser
      FROM pg_roles role WHERE role.rolname = 'league_one_runtime'
    `), 'Runtime role');
    expect(role).toEqual({
      rolcanlogin: true,
      rolsuper: false,
      rolcreatedb: false,
      rolcreaterole: false,
      rolreplication: false,
      inherits_neon_superuser: false,
    });
  });

  it('prunes unreferenced history while retaining current snapshots and frozen baselines', async () => {
    const jobKey = `prune-job-${randomUUID()}`;
    const claim = await store.acquireJob({
      jobKey,
      jobType: 'projection-sync',
      scheduledFor: time(58),
      payload: { purpose: 'prune' },
      workerId: 'prune-worker',
      leaseSeconds: 60,
    });
    expect(claim.kind).toBe('acquired');
    expect(await store.completeJob(jobKey, 'prune-worker')).toBe(true);

    const outcome = storedValue(await store.pruneHistory({
      before: '2100-01-01T00:00:00.000Z',
      keepRecentSnapshotsPerLeagueWeek: 1,
    }));
    expect(outcome.snapshotsDeleted).toBeGreaterThanOrEqual(1);
    expect(outcome.leagueObservationsDeleted).toBeGreaterThanOrEqual(1);
    expect(outcome.gameObservationsDeleted).toBeGreaterThanOrEqual(1);
    expect(outcome.projectionRunsDeleted).toBeGreaterThanOrEqual(1);
    expect(outcome.jobsDeleted).toBeGreaterThanOrEqual(1);

    const rows = await ownerQuery<{
      week_four_snapshots: number;
      current_pointers: number;
      dangling_pointers: number;
      frozen_baselines: number;
      protected_projection_runs: number;
    }>(`
      SELECT
        (SELECT count(*)::integer FROM projection_snapshots
          WHERE league_season_id = $1 AND week = 4) AS week_four_snapshots,
        (SELECT count(*)::integer FROM current_projection_snapshots
          WHERE league_season_id = $1 AND week IN (4, 5)) AS current_pointers,
        (SELECT count(*)::integer FROM current_projection_snapshots current
          LEFT JOIN projection_snapshots snapshot ON snapshot.id = current.snapshot_id
          WHERE current.league_season_id = $1 AND snapshot.id IS NULL) AS dangling_pointers,
        (SELECT count(*)::integer FROM pregame_projection_baselines)
          AS frozen_baselines,
        (SELECT count(*)::integer FROM pregame_projection_runs run
          WHERE EXISTS (
            SELECT 1 FROM pregame_projection_baselines baseline
            WHERE baseline.source_projection_run_id = run.id
          )) AS protected_projection_runs
    `, [league.leagueSeasonId]);
    expect(only(rows, 'Pruned database state')).toEqual({
      week_four_snapshots: 1,
      current_pointers: 2,
      dangling_pointers: 0,
      frozen_baselines: 1,
      protected_projection_runs: 1,
    });
    expect(await store.readCurrentSnapshot(league.leagueSeasonId, 4)).toMatchObject({
      snapshotId: currentSnapshotId,
    });
    expect(await store.readCurrentSnapshot(league.leagueSeasonId, 5)).toMatchObject({
      snapshotId: weekFiveSnapshotId,
    });
  });
});
