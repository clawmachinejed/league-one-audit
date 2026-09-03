import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  createProjectionStore,
  InvalidStoredProjectionSnapshotError,
  type PublishSnapshotInput,
} from './projection-store';
import {
  createFakeProjectionDatabase,
  extractProjectionStoreSql,
  projectionStoreActivityWindows,
  projectionStorePlayerProjection,
  projectionStorePlayerProjectionRow,
  projectionStoreProductionSnapshot,
  projectionStoreSnapshot,
  projectionStoreSnapshotRow,
  projectionStoreSqlMarkers,
} from './projection-store-test-support';

const publishInput: PublishSnapshotInput = {
  leagueSeasonId: 'season-id',
  week: 1,
  modelVersion: 'clock-v1',
  revisionKey: 'revision-1',
  leagueWeekObservationId: 'league-observation-id',
  gameStateObservationIds: [],
  calculatedAt: projectionStoreSnapshot.updatedAt,
  payload: projectionStoreSnapshot,
  activityWindows: [],
};

function marker(statement: string): string | null {
  return statement.match(/\/\* projection-store:([a-z0-9-]+) \*\//u)?.[1] ?? null;
}

describe('projection-store public behavior characterization', () => {
  it('preserves every disabled result without reaching validation or a database query', async () => {
    const store = createProjectionStore({ enabled: false, reason: 'missing-database-url' });

    expect(store.enabled).toBe(false);
    await expect(store.registerLeagueSeason({
      leagueKey: '', leagueName: '', season: 2026, sleeperLeagueId: '', scoringRules: {},
    })).resolves.toEqual({ kind: 'disabled' });
    await expect(store.upsertLeaguePeriodAuthority({
      leagueKey: '', defaultSeason: 2026, defaultSeasonType: 'reg', defaultWeek: 1,
      activeSeason: 2026, activeSeasonType: 'reg', activeWeek: 1,
      leagueLifecycle: 'active', nflPhase: 'regular', sourceProvider: '',
      sourceRevision: '', sourceObservedAt: '', verifiedAt: '',
    })).resolves.toEqual({ kind: 'disabled' });
    await expect(store.readMatchupSnapshotByLeagueKey('', 0, {
      projectionProvider: '', normalizerVersion: '', modelVersion: '',
    })).resolves.toBeNull();
    await expect(store.upsertScoringEntities([{
      key: '', kind: 'player', displayName: '', nflTeam: null, providerIds: [],
    }])).resolves.toEqual({ kind: 'disabled' });
    await expect(store.upsertNflGames([{
      key: '', provider: '', externalGameId: '', season: 2026, seasonType: 'reg', week: 1,
      homeTeam: '', awayTeam: '', kickoffAt: null,
    }])).resolves.toEqual({ kind: 'disabled' });
    await expect(store.recordProjectionSlate(undefined as never)).resolves.toEqual({ kind: 'disabled' });
    await expect(store.readCurrentProjectionSlate(undefined as never)).resolves.toBeNull();
    await expect(store.ensureFutureRefreshStates(undefined as never))
      .resolves.toEqual({ kind: 'disabled' });
    await expect(store.readFutureRefreshPlan(undefined as never)).resolves.toEqual([]);
    await expect(store.beginFutureProjectionRefresh(undefined as never))
      .resolves.toEqual({ kind: 'disabled' });
    await expect(store.completeFutureProjectionRefresh(undefined as never))
      .resolves.toEqual({ kind: 'disabled' });
    await expect(store.failFutureProjectionRefresh(undefined as never))
      .resolves.toEqual({ kind: 'disabled' });
    await expect(store.beginFutureMaterializationRefresh(undefined as never))
      .resolves.toEqual({ kind: 'disabled' });
    await expect(store.completeFutureMaterializationRefresh(undefined as never))
      .resolves.toEqual({ kind: 'disabled' });
    await expect(store.failFutureMaterializationRefresh(undefined as never))
      .resolves.toEqual({ kind: 'disabled' });
    await expect(store.recordProjectionCandidates({
      provider: '', season: 2026, seasonType: 'reg', week: 1, modelVersion: '',
      sourceRevision: '', requestStartedAt: '', requestCompletedAt: '', fetchedAt: '',
      quality: 'complete', candidates: [],
    })).resolves.toEqual({ kind: 'disabled' });
    await expect(store.readLatestCandidatesBySleeperIds({
      leagueSeasonId: '', season: 2026, seasonType: 'reg', week: 1, provider: '',
      modelVersion: '', sleeperPlayerIds: [''],
    })).resolves.toEqual([]);
    await expect(store.freezeLatestBaselines({
      leagueSeasonId: '', season: 2026, seasonType: 'reg', week: 1, modelVersion: '',
      projectionProvider: '', gameProvider: '', externalGameIds: [''], frozenAt: '',
    })).resolves.toEqual({ kind: 'disabled' });
    await expect(store.readFrozenBaselinesBySleeperIds({
      leagueSeasonId: '', season: 2026, seasonType: 'reg', week: 1, provider: '',
      modelVersion: '', sleeperPlayerIds: [''],
    })).resolves.toEqual([]);
    await expect(store.recordGameStates({
      provider: '',
      states: [{
        externalGameId: '', sourceRevision: '', requestStartedAt: '', requestCompletedAt: '',
        observedAt: '', statusCode: 0, period: null, gameClock: null,
        homeScore: null, awayScore: null, sourceData: {},
      }],
    })).resolves.toEqual({ kind: 'disabled' });
    await expect(store.recordLeagueWeekObservation({
      leagueSeasonId: '', week: 1, sourceRevision: '', requestStartedAt: '',
      requestCompletedAt: '', observedAt: '', quality: 'complete', sourceData: {},
      expectedTank01GameIds: [], playerPoints: [], rosterPoints: [],
    })).resolves.toEqual({ kind: 'disabled' });
    await expect(store.acquireJob({
      jobKey: '', jobType: '', scheduledFor: '', payload: {}, workerId: '', leaseSeconds: 0,
    })).resolves.toEqual({ kind: 'disabled' });
    await expect(store.completeJob('', '')).resolves.toBe(false);
    await expect(store.failJob('', '', '')).resolves.toBe(false);
    await expect(store.publishSnapshot({
      ...publishInput,
      week: 99,
      payload: { invalid: true } as never,
    })).resolves.toEqual({ kind: 'disabled' });
    await expect(store.pruneHistory({
      before: '', keepRecentSnapshotsPerLeagueWeek: 0,
    })).resolves.toEqual({ kind: 'disabled' });
    await expect(store.readCurrentSnapshot('', 0)).resolves.toBeNull();
    await expect(store.readSnapshotSelectionBySleeperLeagueId('', 0)).resolves.toEqual({
      selected: null,
      latest: null,
    });
  });

  it('keeps additive lineup and compact methods inert when Neon is disabled', async () => {
    const store = createProjectionStore({ enabled: false, reason: 'missing-database-url' });
    const poisoned = new Proxy({}, { get() { throw new Error('Disabled input was inspected'); } });
    const operations = {
      readLeagueLineupAuthorities: [], readMatchupSnapshotRevisionByLeagueKey: null,
      synchronizeLineupWatchStates: { kind: 'disabled' }, claimDueLineupObservations: [],
      completeLineupObservation: { kind: 'disabled' }, recordLineupObservationNotReady: { kind: 'disabled' },
      failLineupObservation: { kind: 'disabled' }, supersedeLineupClaimWithFullObservation: { kind: 'disabled' },
      readPendingCurrentLineups: [], readPendingFutureLineups: [], readLineupWatchStates: [],
      wakeFutureProjectionAndMaterialization: { kind: 'disabled' },
      acknowledgeCurrentLineup: { kind: 'disabled' }, completeFutureMaterializationAndAcknowledgeLineup: { kind: 'disabled' },
    } as const;
    for (const [name, result] of Object.entries(operations)) {
      const method = store[name as keyof typeof operations] as (...args: unknown[]) => Promise<unknown>;
      await expect(method(poisoned, poisoned, poisoned)).resolves.toEqual(result);
    }
  });

  it('keeps all 51 store-owned SQL operations marked and unique across adapter modules', async () => {
    const extraction = await extractProjectionStoreSql();

    // A non-template or unmarked database call must fail this audit instead of escaping the baseline.
    expect(extraction.operations).toHaveLength(extraction.queryCallCount);
    expect(extraction.operations).toHaveLength(51);
    expect(extraction.operations.every(({ markerCount }) => markerCount === 1)).toBe(true);

    const markers = extraction.operations.map(({ marker }) => marker);
    expect(markers.every((value): value is string => value !== null)).toBe(true);
    expect(new Set(markers).size).toBe(51);
    expect(markers.toSorted()).toEqual([...projectionStoreSqlMarkers]);
  });

  it('keeps canonical scoring-rule serialization and its persisted SHA-256 hash stable', async () => {
    const fake = createFakeProjectionDatabase(() => [{
      league_id: 'league-id', league_season_id: 'season-id', scoring_profile_id: 'profile-id',
    }]);
    const store = createProjectionStore(fake.database);

    await store.registerLeagueSeason({
      leagueKey: 'league1', leagueName: 'League One', season: 2026,
      sleeperLeagueId: 'sleeper-id', scoringRules: { pass_yd: 0.04, pass_td: 6 },
    });

    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].parameters).toEqual([
      'c1c9c42b1fbb7c97d6f1c9eae8379d82fb1d07e00c60011202a688afe250aa57',
      '{"pass_td":6,"pass_yd":0.04}',
      'league1',
      'League One',
      2026,
      'sleeper-id',
    ]);
  });

  it('keeps deterministic scoring-entity and NFL-game UUID namespaces stable', async () => {
    const entityFake = createFakeProjectionDatabase(({ statement, parameters }) => {
      if (!statement.includes('resolve-scoring-entities')) return [];
      const [input] = JSON.parse(String(parameters[0])) as Array<{
        input_key: string;
        proposed_id: string;
      }>;
      return [{
        input_key: input.input_key,
        proposed_id: input.proposed_id,
        entity_id: input.proposed_id,
        conflict: false,
      }];
    });
    await createProjectionStore(entityFake.database).upsertScoringEntities([{
      key: 'quarterback', kind: 'player', displayName: 'Example Player', nflTeam: 'LAC',
      providerIds: [{ provider: 'Sleeper', externalId: 'player-id' }],
    }]);
    const [entityInput] = JSON.parse(String(entityFake.calls[0].parameters[0])) as Array<{
      proposed_id: string;
    }>;
    expect(entityInput.proposed_id).toBe('a0efc205-2131-5f2b-9a18-9370495df5c0');
    expect(entityFake.calls.map(({ statement }) => marker(statement))).toEqual([
      'upsert-scoring-entities',
      'resolve-scoring-entities',
    ]);

    const gameFake = createFakeProjectionDatabase(({ statement, parameters }) => {
      if (!statement.includes('resolve-nfl-games')) return [];
      const [input] = JSON.parse(String(parameters[0])) as Array<{
        input_key: string;
        proposed_id: string;
      }>;
      return [{
        input_key: input.input_key,
        proposed_id: input.proposed_id,
        mapped_game_id: input.proposed_id,
        natural_game_id: input.proposed_id,
        game_id: input.proposed_id,
        conflict: false,
      }];
    });
    await createProjectionStore(gameFake.database).upsertNflGames([{
      key: 'week-one-game', provider: 'Tank01', externalGameId: 'tank-game',
      season: 2026, seasonType: 'reg', week: 1, homeTeam: 'lac', awayTeam: 'kc',
      kickoffAt: '2026-09-13T17:00:00.000Z',
    }]);
    const [gameInput] = JSON.parse(String(gameFake.calls[0].parameters[0])) as Array<{
      proposed_id: string;
    }>;
    expect(gameInput.proposed_id).toBe('231b005c-1f96-5c48-99f4-0f5246e672fc');
    expect(gameFake.calls.map(({ statement }) => marker(statement))).toEqual([
      'upsert-nfl-games',
      'resolve-nfl-games',
    ]);
  });

  it('keeps snapshot hashing, source normalization, parameters, and pointer publication atomic', async () => {
    const fake = createFakeProjectionDatabase(({ statement }) => (
      statement.includes('publish-snapshot')
        ? [projectionStoreSnapshotRow({ result_kind: 'published' })]
        : []
    ));
    const store = createProjectionStore(fake.database);

    await expect(store.publishSnapshot({
      ...publishInput,
      gameStateObservationIds: ['game-observation-b', 'game-observation-a', 'game-observation-b'],
    })).resolves.toMatchObject({ kind: 'published', snapshot: { snapshotId: 'snapshot-id' } });

    expect(fake.calls).toHaveLength(1);
    const [call] = fake.calls;
    expect(marker(call.statement)).toBe('publish-snapshot');
    expect(call.parameters).toEqual([
      'league-observation-id',
      'season-id',
      1,
      ['game-observation-a', 'game-observation-b'],
      'clock-v1',
      'revision-1',
      '2026-09-13T17:00:00.000Z',
      '{"league":{"maxWeek":18,"rosterPositions":["QB"],"season":"2026","week":1},"matchups":[],"teams":[],"updatedAt":"2026-09-13T17:00:00.000Z","week":1}',
      'be0b40cf8ecaa098b51f3ba2ce719719294b1f8981135eaa45a6b4e8101729e9',
      90,
      2026,
      '[]',
      null,
    ]);
    expect(call.statement).toContain('INSERT INTO projection_snapshots');
    expect(call.statement).toContain('INSERT INTO current_projection_snapshots');
    expect(call.statement).toContain("selected.result_kind = 'published'");
    expect(call.statement).toContain(
      'WHERE EXCLUDED.calculated_at >= current_projection_snapshots.calculated_at',
    );
  });

  it('canonicalizes, deduplicates, and orders activity windows before publication', async () => {
    const expectedWindows = [
      projectionStoreActivityWindows[0],
      { startsAt: '2026-09-14T16:00:00.000Z', endsAt: '2026-09-15T01:00:00.000Z' },
    ];
    const fake = createFakeProjectionDatabase(({ statement, parameters }) => (
      statement.includes('publish-snapshot')
        ? [projectionStoreSnapshotRow({
          result_kind: 'published',
          activity_windows: JSON.parse(String(parameters[11])),
        })]
        : []
    ));
    const store = createProjectionStore(fake.database);

    const result = await store.publishSnapshot({
      ...publishInput,
      activityWindows: [
        expectedWindows[1],
        {
          startsAt: '2026-09-13T11:00:00-04:00',
          endsAt: '2026-09-13T20:00:00-04:00',
        },
        projectionStoreActivityWindows[0],
      ],
    });

    expect(result).toMatchObject({
      kind: 'published',
      snapshot: { activityWindows: expectedWindows },
    });
    expect(JSON.parse(String(fake.calls[0].parameters[11]))).toEqual(expectedWindows);
  });

  it('retains the 32-window ceiling before issuing database work', async () => {
    const fake = createFakeProjectionDatabase();
    const activityWindows = Array.from({ length: 33 }, (_, day) => {
      const startsAt = new Date(Date.UTC(2026, 8, 1 + day, 15));
      const endsAt = new Date(startsAt.getTime() + 9 * 60 * 60 * 1_000);
      return { startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() };
    });

    await expect(createProjectionStore(fake.database).publishSnapshot({
      ...publishInput,
      activityWindows,
    })).rejects.toThrow('cannot contain more than 32 activity windows');
    expect(fake.calls).toHaveLength(0);
  });

  it('reads the current snapshot in one query with stable parameter order', async () => {
    const fake = createFakeProjectionDatabase(() => [projectionStoreSnapshotRow()]);
    const store = createProjectionStore(fake.database);

    await expect(store.readCurrentSnapshot('season-id', 1)).resolves.toMatchObject({
      snapshotId: 'snapshot-id', leagueSeasonId: 'season-id', week: 1,
      modelVersion: 'clock-v1', isCurrent: true, payload: projectionStoreSnapshot,
    });
    expect(fake.calls).toHaveLength(1);
    expect(marker(fake.calls[0].statement)).toBe('read-current-snapshot');
    expect(fake.calls[0].parameters).toEqual(['season-id', 1]);
  });

  it('reads a production-shaped JSON snapshot without losing manager or matchup data', async () => {
    const fake = createFakeProjectionDatabase(() => [projectionStoreSnapshotRow({
      week: '1',
      calculated_at: projectionStoreProductionSnapshot.updatedAt,
      published_at: '2026-09-13T19:30:01.000Z',
      verified_at: '2026-09-13T19:30:01.000Z',
      activity_windows: JSON.stringify(projectionStoreActivityWindows),
      is_current: 'true',
      payload: JSON.stringify(projectionStoreProductionSnapshot),
    })]);

    await expect(createProjectionStore(fake.database).readCurrentSnapshot('season-id', 1))
      .resolves.toEqual({
        snapshotId: 'snapshot-id',
        leagueSeasonId: 'season-id',
        week: 1,
        modelVersion: 'clock-v1',
        revisionKey: 'revision-1',
        calculatedAt: projectionStoreProductionSnapshot.updatedAt,
        publishedAt: '2026-09-13T19:30:01.000Z',
        verifiedAt: '2026-09-13T19:30:01.000Z',
        activityWindows: projectionStoreActivityWindows,
        isCurrent: true,
        payload: projectionStoreProductionSnapshot,
      });
  });

  it('preserves the exported malformed-snapshot error identity for both snapshot readers', async () => {
    const fake = createFakeProjectionDatabase(() => [projectionStoreSnapshotRow({ payload: {} })]);
    const store = createProjectionStore(fake.database);

    const currentError: unknown = await store.readCurrentSnapshot('season-id', 1)
      .then(() => null, (error: unknown) => error);
    const selectionError: unknown = await store.readSnapshotSelectionBySleeperLeagueId('league-id', 1)
      .then(() => null, (error: unknown) => error);

    for (const error of [currentError, selectionError]) {
      expect(error).toBeInstanceOf(InvalidStoredProjectionSnapshotError);
      expect((error as Error).constructor).toBe(InvalidStoredProjectionSnapshotError);
      expect((error as Error).name).toBe('InvalidStoredProjectionSnapshotError');
      expect((error as Error).cause).toBeInstanceOf(Error);
    }
    expect(fake.calls.map(({ statement }) => marker(statement))).toEqual([
      'read-current-snapshot',
      'read-snapshot-selection-by-sleeper-id',
    ]);
  });

  it('records a complete league observation with its original 12 parameters and additive lineage', async () => {
    const fake = createFakeProjectionDatabase(() => [{
      observation_id: 'league-observation-id',
      player_points_stored: '2',
      roster_points_stored: '1',
      unmapped_ids: ['missing-player'],
      expected_games_stored: '2',
      unmapped_game_ids: ['missing-game'],
      inserted_player_count: '2',
      inserted_roster_count: '1',
    }]);
    const store = createProjectionStore(fake.database);

    await expect(store.recordLeagueWeekObservation({
      leagueSeasonId: 'season-id',
      week: 1,
      sourceRevision: ' sleeper-revision ',
      requestStartedAt: '2026-09-13T17:00:00.000Z',
      requestCompletedAt: '2026-09-13T17:00:01.000Z',
      observedAt: '2026-09-13T17:00:01.000Z',
      quality: 'complete',
      sourceData: { z: 'last', nested: { two: 2, one: 1 } },
      expectedTank01GameIds: [' game-b ', 'game-a', 'game-b'],
      playerPoints: [{
        sleeperPlayerId: ' 4046 ',
        entityKind: 'player',
        externalRosterId: ' roster-1 ',
        points: 18.2,
        isStarter: true,
        lineupSlot: 'WR',
      }, {
        sleeperPlayerId: 'PHI',
        entityKind: 'team_defense',
        externalRosterId: 'roster-1',
        points: 6,
        isStarter: true,
        lineupSlot: 'DEF',
      }],
      rosterPoints: [{ externalRosterId: ' roster-1 ', points: 24.2 }],
    })).resolves.toEqual({
      kind: 'stored',
      value: {
        observationId: 'league-observation-id',
        playerPointsStored: 2,
        rosterPointsStored: 1,
        unmappedSleeperPlayerIds: ['missing-player'],
        expectedGamesStored: 2,
        unmappedTank01GameIds: ['missing-game'],
      },
    });

    expect(fake.calls).toHaveLength(1);
    expect(marker(fake.calls[0].statement)).toBe('record-league-week-observation');
    expect(fake.calls[0].parameters).toEqual([
      'season-id',
      1,
      'sleeper-revision',
      '2026-09-13T17:00:00.000Z',
      '2026-09-13T17:00:01.000Z',
      '2026-09-13T17:00:01.000Z',
      'complete',
      '{"nested":{"one":1,"two":2},"z":"last"}',
      '[{"entity_kind":"player","external_roster_id":"roster-1","is_starter":true,"lineup_slot":"WR","points":18.2,"sleeper_player_id":"4046"},{"entity_kind":"team_defense","external_roster_id":"roster-1","is_starter":true,"lineup_slot":"DEF","points":6,"sleeper_player_id":"PHI"}]',
      '[{"external_roster_id":"roster-1","points":24.2}]',
      2,
      ['game-a', 'game-b'],
      null,
      null,
    ]);
  });

  it('maps nonempty candidates and frozen baselines without changing query parameters', async () => {
    const frozenAt = '2026-09-13T16:59:59.000Z';
    const frozenProjection = { ...projectionStorePlayerProjection, frozenAt };
    const fake = createFakeProjectionDatabase(({ statement }) => {
      if (statement.includes('read-latest-candidates')) {
        return [projectionStorePlayerProjectionRow()];
      }
      return [projectionStorePlayerProjectionRow({ frozen_at: frozenAt })];
    });
    const store = createProjectionStore(fake.database);
    const readInput = {
      leagueSeasonId: 'season-id',
      season: 2026,
      seasonType: 'reg',
      week: 1,
      provider: ' Tank01 ',
      modelVersion: 'tank01-pregame-v1',
      sleeperPlayerIds: [' 9999 ', '4046', '4046', ''],
    } as const;

    await expect(store.readLatestCandidatesBySleeperIds(readInput))
      .resolves.toEqual([projectionStorePlayerProjection]);
    await expect(store.freezeLatestBaselines({
      leagueSeasonId: 'season-id',
      season: 2026,
      seasonType: 'reg',
      week: 1,
      modelVersion: 'tank01-pregame-v1',
      projectionProvider: ' Tank01 ',
      gameProvider: ' TANK01 ',
      externalGameIds: ['game-b', ' game-a ', 'game-b', ''],
      frozenAt,
    })).resolves.toEqual({ kind: 'stored', value: [frozenProjection] });
    await expect(store.readFrozenBaselinesBySleeperIds(readInput))
      .resolves.toEqual([frozenProjection]);

    expect(fake.calls.map(({ statement }) => marker(statement))).toEqual([
      'read-latest-candidates',
      'freeze-latest-baselines',
      'read-frozen-baselines',
    ]);
    expect(fake.calls.map(({ parameters }) => parameters)).toEqual([
      ['season-id', ['4046', '9999'], 2026, 'reg', 1, 'tank01-pregame-v1', 'tank01'],
      [
        'tank01', ['game-a', 'game-b'], 'season-id', 2026, 'reg', 1,
        'tank01-pregame-v1', 'tank01', frozenAt,
      ],
      ['season-id', ['4046', '9999'], 2026, 'reg', 1, 'tank01-pregame-v1', 'tank01'],
    ]);
  });

  it('serializes a game-state batch into the two stable database parameters', async () => {
    const fake = createFakeProjectionDatabase(() => [{
      external_game_id: 'game-a',
      source_revision: 'state-a',
      observation_id: 'observation-a',
    }, {
      external_game_id: 'game-b',
      source_revision: 'state-b',
      observation_id: 'observation-b',
    }]);
    const store = createProjectionStore(fake.database);

    await expect(store.recordGameStates({
      provider: ' Tank01 ',
      states: [{
        externalGameId: 'game-a',
        sourceRevision: 'state-a',
        requestStartedAt: '2026-09-13T17:00:00.000Z',
        requestCompletedAt: '2026-09-13T17:00:01.000Z',
        observedAt: '2026-09-13T17:00:01.000Z',
        statusCode: 1,
        period: '2',
        gameClock: '04:12',
        homeScore: 14,
        awayScore: 10,
        sourceData: { z: 2, a: 1 },
      }, {
        externalGameId: 'game-b',
        sourceRevision: 'state-b',
        requestStartedAt: '2026-09-13T17:00:00.000Z',
        requestCompletedAt: '2026-09-13T17:00:01.000Z',
        observedAt: '2026-09-13T17:00:01.000Z',
        statusCode: 0,
        period: null,
        gameClock: null,
        homeScore: null,
        awayScore: null,
        sourceData: {},
      }],
    })).resolves.toEqual({
      kind: 'stored',
      value: [{
        externalGameId: 'game-a',
        sourceRevision: 'state-a',
        observationId: 'observation-a',
      }, {
        externalGameId: 'game-b',
        sourceRevision: 'state-b',
        observationId: 'observation-b',
      }],
    });

    expect(fake.calls).toHaveLength(1);
    expect(marker(fake.calls[0].statement)).toBe('record-game-states');
    expect(fake.calls[0].parameters).toEqual([
      'tank01',
      '[{"away_score":10,"external_game_id":"game-a","game_clock":"04:12","home_score":14,"observed_at":"2026-09-13T17:00:01.000Z","period":"2","request_completed_at":"2026-09-13T17:00:01.000Z","request_started_at":"2026-09-13T17:00:00.000Z","source_data":{"a":1,"z":2},"source_revision":"state-a","status_code":1},{"away_score":null,"external_game_id":"game-b","game_clock":null,"home_score":null,"observed_at":"2026-09-13T17:00:01.000Z","period":null,"request_completed_at":"2026-09-13T17:00:01.000Z","request_started_at":"2026-09-13T17:00:00.000Z","source_data":{},"source_revision":"state-b","status_code":0}]',
    ]);
  });

  it('preserves job acquisition, completion, and failure query and parameter contracts', async () => {
    const acquireFake = createFakeProjectionDatabase(({ statement }) => (
      statement.includes('read-job-state') ? [{ state: 'completed' }] : []
    ));
    const acquireStore = createProjectionStore(acquireFake.database);
    await expect(acquireStore.acquireJob({
      jobKey: 'projection-job', jobType: 'projection-sync',
      scheduledFor: '2026-09-13T17:01:00.000Z', payload: { z: 1, force: false },
      workerId: 'worker-1', leaseSeconds: 90,
    })).resolves.toEqual({ kind: 'completed' });
    expect(acquireFake.calls.map(({ statement }) => marker(statement))).toEqual([
      'acquire-job',
      'read-job-state',
    ]);
    expect(acquireFake.calls[0].parameters).toEqual([
      'projection-job', 'projection-sync', '2026-09-13T17:01:00.000Z',
      '{"force":false,"z":1}', 'worker-1', 90,
    ]);
    expect(acquireFake.calls[1].parameters).toEqual(['projection-job']);

    const finishFake = createFakeProjectionDatabase(() => [{ job_key: 'projection-job' }]);
    const finishStore = createProjectionStore(finishFake.database);
    await expect(finishStore.completeJob('projection-job', 'worker-1')).resolves.toBe(true);
    await expect(finishStore.failJob('projection-job', 'worker-2', 'provider failed'))
      .resolves.toBe(true);
    expect(finishFake.calls.map(({ statement }) => marker(statement))).toEqual([
      'complete-job',
      'fail-job',
    ]);
    expect(finishFake.calls[0].parameters).toEqual(['projection-job', 'worker-1']);
    expect(finishFake.calls[1].parameters).toEqual([
      'projection-job', 'worker-2', 'provider failed',
    ]);
    for (const call of finishFake.calls) {
      expect(call.statement).toContain(
        "WHERE job_key = $1 AND state = 'running' AND lease_owner = $2",
      );
    }

    const unownedFake = createFakeProjectionDatabase();
    const unownedStore = createProjectionStore(unownedFake.database);
    await expect(unownedStore.completeJob('projection-job', 'wrong-worker')).resolves.toBe(false);
    await expect(unownedStore.failJob('projection-job', 'wrong-worker', 'failed')).resolves.toBe(false);
  });

  it('reports an unexpired running lease as busy and preserves expired-lease safeguards', async () => {
    const fake = createFakeProjectionDatabase(({ statement }) => (
      statement.includes('read-job-state') ? [{ state: 'running' }] : []
    ));
    const store = createProjectionStore(fake.database);

    await expect(store.acquireJob({
      jobKey: 'projection-job',
      jobType: 'projection-sync',
      scheduledFor: '2026-09-13T17:01:00.000Z',
      payload: { force: false },
      workerId: 'worker-2',
      leaseSeconds: 90,
    })).resolves.toEqual({ kind: 'busy' });

    expect(fake.calls.map(({ statement }) => marker(statement))).toEqual([
      'acquire-job',
      'read-job-state',
    ]);
    expect(fake.calls[1].parameters).toEqual(['projection-job']);
    expect(fake.calls[0].statement).toContain(
      "projection_jobs.state = 'running' AND projection_jobs.lease_until < now()",
    );
    expect(fake.calls[0].statement).toContain(
      'AND EXCLUDED.scheduled_for >= projection_jobs.scheduled_for',
    );
    expect(fake.calls[0].statement).toContain(
      "projection_jobs.state = 'completed'",
    );
    expect(fake.calls[0].statement).toContain(
      'AND EXCLUDED.scheduled_for > projection_jobs.scheduled_for',
    );
  });

  it('rejects invalid job leases before querying Neon', async () => {
    const fake = createFakeProjectionDatabase();
    const store = createProjectionStore(fake.database);
    const input = {
      jobKey: 'projection-job', jobType: 'projection-sync',
      scheduledFor: '2026-09-13T17:01:00.000Z', payload: {}, workerId: 'worker-1',
    } as const;

    await expect(store.acquireJob({ ...input, leaseSeconds: 0 }))
      .rejects.toThrow('positive number of whole seconds');
    await expect(store.acquireJob({ ...input, leaseSeconds: 1.5 }))
      .rejects.toThrow('positive number of whole seconds');
    expect(fake.calls).toHaveLength(0);
  });

  it('preserves retention query order, defaults, and parameter boundaries', async () => {
    const before = '2026-08-01T00:00:00.000Z';
    const fake = createFakeProjectionDatabase();
    const store = createProjectionStore(fake.database);

    await expect(store.pruneHistory({ before })).resolves.toEqual({
      kind: 'stored',
      value: {
        snapshotsDeleted: 0,
        leagueObservationsDeleted: 0,
        gameObservationsDeleted: 0,
        projectionRunsDeleted: 0,
        projectionSlateObservationsDeleted: 0,
        projectionSlateContentsDeleted: 0,
        jobsDeleted: 0,
      },
    });
    expect(fake.calls.map(({ statement }) => marker(statement))).toEqual([
      'prune-snapshots',
      'prune-league-observations',
      'prune-game-observations',
      'prune-projection-runs',
      'prune-projection-slate-observations',
      'prune-projection-slate-contents',
      'prune-jobs',
    ]);
    expect(fake.calls.map(({ parameters }) => parameters)).toEqual([
      [before, 3], [before], [before], [before], [before], [before], [before],
    ]);

    for (const keepRecentSnapshotsPerLeagueWeek of [0, 1.5, 101]) {
      const invalidFake = createFakeProjectionDatabase();
      await expect(createProjectionStore(invalidFake.database).pruneHistory({
        before,
        keepRecentSnapshotsPerLeagueWeek,
      })).rejects.toThrow('between 1 and 100');
      expect(invalidFake.calls).toHaveLength(0);
    }
  });
});
