import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { createDatabase, type DatabaseClient, type DatabaseRow } from './database';
import { createProjectionStore } from './projection-store';
import type { MatchupsData } from './types';

type QueryCall = Readonly<{ statement: string; parameters: readonly unknown[] }>;

function fakeDatabase(
  respond: (call: QueryCall) => readonly DatabaseRow[] = () => [],
): Readonly<{ database: DatabaseClient; calls: QueryCall[] }> {
  const calls: QueryCall[] = [];
  return {
    calls,
    database: {
      enabled: true,
      async query<Row extends DatabaseRow>(statement: string, parameters: readonly unknown[] = []) {
        const call = { statement, parameters };
        calls.push(call);
        return respond(call) as readonly Row[];
      },
    },
  };
}

const snapshot: MatchupsData = {
  league: { season: '2026', rosterPositions: ['QB'], week: 1, maxWeek: 18 },
  teams: [],
  updatedAt: '2026-09-13T17:00:00.000Z',
  week: 1,
  matchups: [],
};

const scheduledSnapshot: MatchupsData = {
  ...snapshot,
  teams: [{
    id: 1, ownerName: 'Owner', name: 'Team', avatar: null,
    wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: null,
  }],
  matchups: [{
    id: '1', status: 'upcoming', sides: [{
      team: {
        id: 1, ownerName: 'Owner', name: 'Team', avatar: null,
        wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: null,
      },
      points: 0, projectedPoints: 20,
      starters: [{
        id: 'player', name: 'Player', position: 'QB', nflTeam: 'LAC', injuryStatus: null,
        game: {
          kind: 'scheduled', opponent: 'KC', location: 'home',
          date: 'Sun 1:00 PM', kickoffAt: '2026-09-13T17:00:00.000Z',
        },
        slot: 'QB', points: 0, projectedPoints: 20,
      }],
    }],
  }],
};

const activityWindows = [{
  startsAt: '2026-09-13T15:00:00.000Z',
  endsAt: '2026-09-14T00:00:00.000Z',
}] as const;

describe('optional database connection', () => {
  it('keeps reads and writes safe when DATABASE_URL is absent', async () => {
    expect(createDatabase(undefined)).toEqual({ enabled: false, reason: 'missing-database-url' });
    expect(createDatabase('https://example.com')).toEqual({
      enabled: false,
      reason: 'invalid-database-url',
    });

    const store = createProjectionStore({ enabled: false, reason: 'missing-database-url' });
    expect(store.enabled).toBe(false);
    await expect(store.readCurrentSnapshot('season-id', 1)).resolves.toBeNull();
    await expect(store.readCurrentSnapshotBySleeperLeagueId('league-id', 2026, 1))
      .resolves.toBeNull();
    await expect(store.readLatestCurrentSnapshotBySleeperLeagueId('league-id', 1))
      .resolves.toBeNull();
    await expect(store.readLatestCurrentSnapshotBySleeperLeagueId('league-id'))
      .resolves.toBeNull();
    await expect(store.readFrozenBaselinesBySleeperIds({
      leagueSeasonId: 'season-id', season: 2026, seasonType: 'reg', week: 1,
      provider: 'tank01', modelVersion: 'tank01-pregame-v1', sleeperPlayerIds: ['player-id'],
    })).resolves.toEqual([]);
    await expect(store.recordGameStates({ provider: 'tank01', states: [] }))
      .resolves.toEqual({ kind: 'disabled' });
    await expect(store.acquireJob({
      jobKey: 'week-1', jobType: 'projection-sync', scheduledFor: snapshot.updatedAt,
      payload: {}, workerId: 'worker', leaseSeconds: 90,
    })).resolves.toEqual({ kind: 'disabled' });
  });

  it('requires TLS for remote runtime database connections', () => {
    expect(createDatabase('postgresql://runtime:secret@example.neon.tech/database')).toEqual({
      enabled: false, reason: 'invalid-database-url',
    });
    expect(createDatabase(
      'postgresql://runtime:secret@example.neon.tech/database?sslmode=disable',
    )).toEqual({ enabled: false, reason: 'invalid-database-url' });
    expect(createDatabase(
      'postgresql://runtime:secret@example.neon.tech/database?sslmode=require',
    ).enabled).toBe(true);
    expect(createDatabase('postgresql://runtime:secret@localhost/database').enabled).toBe(true);
  });
});

describe('projection persistence', () => {
  it('registers runtime league IDs and hashes equivalent scoring rules identically', async () => {
    const fake = fakeDatabase(() => [{
      league_id: 'league-id', league_season_id: 'season-id', scoring_profile_id: 'profile-id',
    }]);
    const store = createProjectionStore(fake.database);

    await store.registerLeagueSeason({
      leagueKey: 'league1', leagueName: 'League One', season: 2026,
      sleeperLeagueId: 'runtime-value-a', scoringRules: { pass_td: 6, pass_yd: 0.04 },
    });
    await store.registerLeagueSeason({
      leagueKey: 'league1', leagueName: 'League One', season: 2026,
      sleeperLeagueId: 'runtime-value-b', scoringRules: { pass_yd: 0.04, pass_td: 6 },
    });

    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[0].statement).toContain('ON CONFLICT (rules_hash) DO UPDATE');
    expect(fake.calls[0].parameters[0]).toBe(fake.calls[1].parameters[0]);
    expect(fake.calls[0].statement).not.toContain('runtime-value-a');
    expect(fake.calls[0].parameters[5]).toBe('runtime-value-a');
  });

  it('keeps each league season bound to one immutable scoring profile', async () => {
    const fake = fakeDatabase(({ statement }) => {
      if (statement.includes('read-league-season-profile')) {
        return [{ league_season_id: 'season-id', rules_hash: 'existing-rules-hash' }];
      }
      return [];
    });
    const store = createProjectionStore(fake.database);

    await expect(store.registerLeagueSeason({
      leagueKey: 'league1', leagueName: 'League One', season: 2026,
      sleeperLeagueId: 'runtime-league-id', scoringRules: { pass_td: 6 },
    })).rejects.toThrow('Scoring rules are immutable for an existing league season');

    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[0].statement).toContain(
      'WHERE league_seasons.scoring_profile_id = EXCLUDED.scoring_profile_id',
    );
    expect(fake.calls[1].statement).toContain('read-league-season-profile');
  });

  it('re-reads provider mappings after a first-writer conflict and cleans unused proposed IDs', async () => {
    const fake = fakeDatabase(({ statement, parameters }) => {
      if (!statement.includes('resolve-scoring-entities')) return [];
      const input = JSON.parse(String(parameters[0])) as Array<{
        input_key: string; proposed_id: string;
      }>;
      return [
        {
          input_key: 'quarterback', entity_id: input[0].proposed_id,
          proposed_id: input[0].proposed_id, conflict: false,
        },
        {
          input_key: 'conflict', entity_id: null,
          proposed_id: input[1].proposed_id, conflict: true,
        },
      ];
    });
    const store = createProjectionStore(fake.database);
    const outcome = await store.upsertScoringEntities([
      {
        key: 'quarterback', kind: 'player', displayName: 'Example Player', nflTeam: 'LAC',
        providerIds: [
          { provider: 'Sleeper', externalId: 'sleeper-player' },
          { provider: 'Tank01', externalId: 'tank-player' },
        ],
      },
      {
        key: 'conflict', kind: 'player', displayName: 'Conflicting Player', nflTeam: null,
        providerIds: [{ provider: 'sleeper', externalId: 'conflict-player' }],
      },
    ]);

    expect(outcome.kind).toBe('stored');
    expect(outcome.kind === 'stored' && outcome.value).toMatchObject([
      { key: 'quarterback', conflict: false },
      { key: 'conflict', entityId: null, conflict: true },
    ]);
    expect(outcome.kind === 'stored' && outcome.value[0].entityId).toMatch(/^[0-9a-f-]{36}$/u);
    expect(fake.calls).toHaveLength(3);
    expect(fake.calls[0].statement).toContain('ON CONFLICT (id) DO UPDATE');
    expect(fake.calls[1].statement).toContain('resolve-scoring-entities');
    expect(fake.calls[2].statement).toContain('clean-orphan-scoring-entities');
    const input = JSON.parse(String(fake.calls[0].parameters[0])) as Array<{
      provider_ids: Array<{ provider: string }>;
    }>;
    expect(input[0].provider_ids.map(({ provider }) => provider)).toEqual(['sleeper', 'tank01']);
  });

  it('stores an idempotent candidate batch in one query', async () => {
    const fake = fakeDatabase(() => [{
      run_id: 'run-id', candidates_stored: 2, candidate_count: 2,
    }]);
    const store = createProjectionStore(fake.database);
    const outcome = await store.recordProjectionCandidates({
      provider: 'Tank01', season: 2026, seasonType: 'reg', week: 1,
      modelVersion: 'tank01-pregame-v1', sourceRevision: 'week-1-fetch-1',
      requestStartedAt: '2026-09-09T12:00:00.000Z',
      requestCompletedAt: '2026-09-09T12:00:01.000Z',
      fetchedAt: '2026-09-09T12:00:01.000Z', quality: 'complete',
      candidates: [
        {
          gameId: 'game-1', entityId: 'player-1', scoringProfileId: 'profile-1',
          projectionPoints: 22.29, projectedStats: { passingYards: 256 }, quality: 'complete',
        },
        {
          gameId: 'game-1', entityId: 'player-2', scoringProfileId: 'profile-1',
          projectionPoints: 0, projectedStats: {}, quality: 'missing',
        },
      ],
    });

    expect(outcome).toEqual({
      kind: 'stored', value: { runId: 'run-id', candidatesStored: 2, candidateCount: 2 },
    });
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].statement).toContain(
      'DO UPDATE SET source_revision = pregame_projection_runs.source_revision',
    );
    expect(fake.calls[0].statement).toMatch(/count\(\*\) FROM input/u);
    expect(fake.calls[0].parameters[0]).toBe('tank01');
    const candidates = JSON.parse(String(fake.calls[0].parameters[10])) as Array<{
      projection_points: number; quality: string;
    }>;
    expect(candidates).toMatchObject([
      { projection_points: 22.29, quality: 'complete' },
      { projection_points: 0, quality: 'missing' },
    ]);
  });

  it('records game states through the atomic regression gate', async () => {
    const fake = fakeDatabase(() => [{
      external_game_id: 'tank-game', source_revision: 'state-1', observation_id: 'observation-id',
    }]);
    const store = createProjectionStore(fake.database);
    await expect(store.recordGameStates({
      provider: 'Tank01',
      states: [{
        externalGameId: 'tank-game', sourceRevision: 'state-1',
        requestStartedAt: '2026-09-13T17:30:00.000Z',
        requestCompletedAt: '2026-09-13T17:30:01.000Z',
        observedAt: '2026-09-13T17:30:01.000Z', statusCode: 1,
        period: 'Q1', gameClock: '10:00', homeScore: 7, awayScore: 0,
        sourceData: { phase: 'q1', clockSeconds: 600 },
      }],
    })).resolves.toEqual({ kind: 'stored', value: [{
      externalGameId: 'tank-game', sourceRevision: 'state-1', observationId: 'observation-id',
    }] });
    expect(fake.calls[0].statement).toContain('ORDER BY nfl_game_id');
    expect(fake.calls[0].statement).toContain(
      'ON CONFLICT (provider, nfl_game_id, source_revision) DO UPDATE',
    );
    expect(fake.calls[0].statement).toContain(
      'game_state_observations.source_data = EXCLUDED.source_data',
    );
  });

  it('publishes immutable history and the current pointer atomically', async () => {
    const fake = fakeDatabase(({ statement }) => statement.includes('publish-snapshot') ? [{
      snapshot_id: 'snapshot-id', league_season_id: 'season-id', week: 1,
      model_version: 'clock-v1', revision_key: 'revision-1',
      calculated_at: '2026-09-13T17:00:00.000Z', result_kind: 'published',
      published_at: '2026-09-13T17:00:01.000Z',
      verified_at: '2026-09-13T17:00:00.000Z', activity_windows: activityWindows,
      is_current: true, payload: snapshot,
    }] : []);
    const store = createProjectionStore(fake.database);
    const result = await store.publishSnapshot({
      leagueSeasonId: 'season-id', week: 1, modelVersion: 'clock-v1',
      revisionKey: 'revision-1', leagueWeekObservationId: 'league-observation-id',
      gameStateObservationIds: ['game-observation-1', 'game-observation-1', 'game-observation-2'],
      calculatedAt: '2026-09-13T17:00:00.000Z', payload: snapshot, activityWindows,
    });

    expect(result.kind).toBe('published');
    expect(result.kind === 'published' && result.snapshot.isCurrent).toBe(true);
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].statement).toContain('projection_snapshots');
    expect(fake.calls[0].statement).toContain('current_projection_snapshots');
    expect(fake.calls[0].statement).toContain('selected.source_verified_at');
    expect(fake.calls[0].statement).not.toContain('SET verified_at = now()');
    expect(fake.calls[0].statement).toContain("observation.provider = 'sleeper'");
    expect(fake.calls[0].statement).toContain('calculation_time_aligned');
    expect(fake.calls[0].statement).toContain("observation.provider = 'tank01'");
    expect(fake.calls[0].statement).toContain('exact_game_set');
    expect(fake.calls[0].statement).toContain('source_times_aligned');
    expect(fake.calls[0].statement).toContain('game_state_observation_ids = $4::uuid[]');
    expect(fake.calls[0].statement).not.toContain('projection_snapshot_game_sources');
    expect(fake.calls[0].parameters[3]).toEqual(['game-observation-1', 'game-observation-2']);
    expect(JSON.parse(String(fake.calls[0].parameters[7]))).toEqual(snapshot);
    expect(fake.calls[0].parameters[9]).toBe(90);
    expect(fake.calls[0].parameters[10]).toBe(2026);
    expect(JSON.parse(String(fake.calls[0].parameters[11]))).toEqual(activityWindows);
  });

  it('does not publish a scheduled-player snapshot without its game observations', async () => {
    const fake = fakeDatabase(() => { throw new Error('Database should not be called.'); });
    const store = createProjectionStore(fake.database);
    await expect(store.publishSnapshot({
      leagueSeasonId: 'season-id', week: 1, modelVersion: 'clock-v1',
      revisionKey: 'revision-1', leagueWeekObservationId: 'league-observation-id',
      gameStateObservationIds: [], calculatedAt: scheduledSnapshot.updatedAt,
      payload: scheduledSnapshot, activityWindows,
    })).resolves.toEqual({ kind: 'rejected', reason: 'incomplete-or-mismatched-sources' });
    expect(fake.calls).toHaveLength(0);
  });

  it('deduplicates unchanged material content while ignoring only updatedAt', async () => {
    const contentHashes: unknown[] = [];
    let callCount = 0;
    const fake = fakeDatabase(({ parameters }) => {
      contentHashes.push(parameters[8]);
      callCount += 1;
      return [{
        snapshot_id: 'snapshot-id', league_season_id: 'season-id', week: 1,
        model_version: 'clock-v1', revision_key: 'revision-1',
        calculated_at: '2026-09-13T17:00:00.000Z',
        published_at: '2026-09-13T17:00:01.000Z', is_current: true,
        activity_windows: [],
        verified_at: callCount === 1
          ? '2026-09-13T17:00:01.000Z'
          : '2026-09-13T17:01:01.000Z',
        result_kind: callCount === 1 ? 'published' : 'unchanged', payload: snapshot,
      }];
    });
    const store = createProjectionStore(fake.database);
    const base = {
      leagueSeasonId: 'season-id', week: 1, modelVersion: 'clock-v1',
      leagueWeekObservationId: 'league-observation-id', gameStateObservationIds: [],
      calculatedAt: snapshot.updatedAt, activityWindows: [],
    } as const;
    const first = await store.publishSnapshot({
      ...base, revisionKey: 'revision-1', payload: snapshot,
    });
    const second = await store.publishSnapshot({
      ...base,
      revisionKey: 'revision-2',
      payload: { ...snapshot, updatedAt: '2026-09-13T17:01:00.000Z' },
    });
    expect(first).toMatchObject({
      kind: 'published', snapshot: { verifiedAt: '2026-09-13T17:00:01.000Z' },
    });
    expect(second).toMatchObject({
      kind: 'unchanged',
      snapshot: {
        publishedAt: '2026-09-13T17:00:01.000Z',
        verifiedAt: '2026-09-13T17:01:01.000Z',
      },
    });
    expect(contentHashes[0]).toBe(contentHashes[1]);
    expect(fake.calls[1].statement).toContain(
      'SET verified_at = GREATEST(current.verified_at, selected.source_verified_at)',
    );
  });

  it('rejects payload week mismatches before writing a current pointer', async () => {
    const fake = fakeDatabase(() => { throw new Error('Database should not be called.'); });
    const store = createProjectionStore(fake.database);
    await expect(store.publishSnapshot({
      leagueSeasonId: 'season-id', week: 2, modelVersion: 'clock-v1',
      revisionKey: 'revision-1', leagueWeekObservationId: 'league-observation-id',
      gameStateObservationIds: [], calculatedAt: snapshot.updatedAt,
      payload: snapshot, activityWindows: [],
    })).resolves.toEqual({ kind: 'rejected', reason: 'payload-context-mismatch' });
    expect(fake.calls).toHaveLength(0);
  });

  it('rejects malformed full-slate activity windows before database work', async () => {
    const fake = fakeDatabase(() => { throw new Error('Database should not be called.'); });
    const store = createProjectionStore(fake.database);
    await expect(store.publishSnapshot({
      leagueSeasonId: 'season-id', week: 1, modelVersion: 'clock-v1',
      revisionKey: 'revision-1', leagueWeekObservationId: 'league-observation-id',
      gameStateObservationIds: [], calculatedAt: snapshot.updatedAt, payload: snapshot,
      activityWindows: [{
        startsAt: '2026-09-13T15:00:00.000Z', endsAt: '2026-09-13T23:00:00.000Z',
      }],
    })).rejects.toThrow('kickoff minus two hours through kickoff plus seven hours');
    expect(fake.calls).toHaveLength(0);
  });

  it('qualifies projection candidates and baselines by provider and freezes only pre-kickoff', async () => {
    const fake = fakeDatabase();
    const store = createProjectionStore(fake.database);

    await store.readLatestCandidatesBySleeperIds({
      leagueSeasonId: 'season-id', season: 2026, seasonType: 'reg', week: 1,
      provider: 'Tank01', modelVersion: 'pregame-v1', sleeperPlayerIds: ['player-id'],
    });
    await store.freezeLatestBaselines({
      leagueSeasonId: 'season-id', season: 2026, seasonType: 'reg', week: 1,
      projectionProvider: 'Tank01', gameProvider: 'Tank01', modelVersion: 'pregame-v1',
      externalGameIds: ['game-id'], frozenAt: '2026-09-13T17:00:00.000Z',
    });
    await store.readFrozenBaselinesBySleeperIds({
      leagueSeasonId: 'season-id', season: 2026, seasonType: 'reg', week: 1,
      provider: 'Tank01', modelVersion: 'pregame-v1', sleeperPlayerIds: ['player-id'],
    });

    expect(fake.calls).toHaveLength(3);
    expect(fake.calls[0].statement).toContain('run.provider = $7');
    expect(fake.calls[0].parameters[6]).toBe('tank01');
    expect(fake.calls[1].statement).toContain('run.provider = $8');
    expect(fake.calls[1].statement).toContain('game.kickoff_at IS NOT NULL');
    expect(fake.calls[1].statement).toContain('run.fetched_at <= game.kickoff_at');
    expect(fake.calls[1].parameters[7]).toBe('tank01');
    expect(fake.calls[2].statement).toContain('baseline.projection_provider = $7');
    expect(fake.calls[2].parameters[6]).toBe('tank01');
  });

  it('detects an existing provider game ID mapped to a different natural game', async () => {
    const fake = fakeDatabase(({ statement, parameters }) => {
      if (!statement.includes('resolve-nfl-games')) return [];
      const [input] = JSON.parse(String(parameters[0])) as Array<{
        input_key: string; proposed_id: string;
      }>;
      return [{
        input_key: input.input_key, proposed_id: input.proposed_id,
        mapped_game_id: input.proposed_id, natural_game_id: input.proposed_id,
        game_id: input.proposed_id, conflict: true,
      }];
    });
    const store = createProjectionStore(fake.database);

    await expect(store.upsertNflGames([{
      key: '2026-reg-1-lac-kc', provider: 'tank01', externalGameId: 'tank-game',
      season: 2026, seasonType: 'reg', week: 1,
      homeTeam: 'LAC', awayTeam: 'KC', kickoffAt: '2026-09-13T17:00:00.000Z',
    }])).rejects.toThrow('conflicts with its scheduled game identity');

    expect(fake.calls).toHaveLength(2);
    const resolution = fake.calls[1].statement;
    expect(resolution).toContain('mapped_game.season IS DISTINCT FROM input.season');
    expect(resolution).toContain('mapped_game.season_type IS DISTINCT FROM input.season_type');
    expect(resolution).toContain('mapped_game.week IS DISTINCT FROM input.week');
    expect(resolution).toContain('mapped_game.home_team IS DISTINCT FROM input.home_team');
    expect(resolution).toContain('mapped_game.away_team IS DISTINCT FROM input.away_team');
  });

  it('keeps corrected provider game IDs as aliases of one canonical game', async () => {
    const canonicalGameId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const fake = fakeDatabase(({ statement, parameters }) => {
      if (!statement.includes('resolve-nfl-games')) return [];
      const [input] = JSON.parse(String(parameters[0])) as Array<{
        input_key: string; proposed_id: string;
      }>;
      return [{
        input_key: input.input_key,
        proposed_id: input.proposed_id,
        mapped_game_id: canonicalGameId,
        natural_game_id: canonicalGameId,
        game_id: canonicalGameId,
        conflict: false,
      }];
    });
    const store = createProjectionStore(fake.database);

    await expect(store.upsertNflGames([{
      key: '2026-reg-1-lac-kc', provider: 'tank01', externalGameId: 'corrected-tank-game-id',
      season: 2026, seasonType: 'reg', week: 1,
      homeTeam: 'LAC', awayTeam: 'KC', kickoffAt: '2026-09-13T17:00:00.000Z',
    }])).resolves.toEqual({
      kind: 'stored', value: [{ key: '2026-reg-1-lac-kc', gameId: canonicalGameId }],
    });

    expect(fake.calls).toHaveLength(3);
    expect(fake.calls[0].statement).toContain(
      'ON CONFLICT (season, season_type, week, home_team, away_team) DO UPDATE',
    );
    expect(fake.calls[0].statement).toContain(
      'INSERT INTO external_game_ids (provider, external_game_id, nfl_game_id)',
    );
    expect(fake.calls[2].statement).toContain('clean-orphan-nfl-games');
  });

  it('requires expected Tank01 games for scheduled source data', async () => {
    const fake = fakeDatabase(() => []);
    const store = createProjectionStore(fake.database);
    await expect(store.recordLeagueWeekObservation({
      leagueSeasonId: 'season-id', week: 1, sourceRevision: 'sleeper-1',
      requestStartedAt: snapshot.updatedAt, requestCompletedAt: snapshot.updatedAt,
      observedAt: snapshot.updatedAt, quality: 'complete',
      sourceData: { player: { game: { kind: 'scheduled' } } },
      expectedTank01GameIds: [], playerPoints: [], rosterPoints: [],
    })).rejects.toThrow('Scheduled games require expected Tank01 game identifiers.');
    expect(fake.calls).toHaveLength(0);
  });

  it('uses a stable job row and reacquires completed work only for a newer slot', async () => {
    const fake = fakeDatabase(() => [{
      attempt_count: 2, lease_until: '2026-09-13T17:02:30.000Z',
    }]);
    const store = createProjectionStore(fake.database);
    await expect(store.acquireJob({
      jobKey: 'live-projection-sync', jobType: 'projection-sync',
      scheduledFor: '2026-09-13T17:01:00.000Z', payload: { force: false },
      workerId: 'worker-1', leaseSeconds: 90,
    })).resolves.toMatchObject({ kind: 'acquired', attempt: 2 });
    expect(fake.calls[0].statement).toContain('EXCLUDED.scheduled_for > projection_jobs.scheduled_for');
    expect(fake.calls[0].statement).toContain('scheduled_for = EXCLUDED.scheduled_for');
    expect(fake.calls[0].statement).toContain('completed_at = NULL');
  });

  it('prunes only unreferenced history while retaining current and recent snapshots', async () => {
    const fake = fakeDatabase(({ statement }) => {
      if (statement.includes('prune-snapshots')) return [{ id: 'old-1' }, { id: 'old-2' }];
      if (statement.includes('prune-league-observations')) return [{ id: 'league-source' }];
      if (statement.includes('prune-game-observations')) return [{ id: 'game-source' }];
      if (statement.includes('prune-projection-runs')) return [];
      if (statement.includes('prune-jobs')) return [{ job_key: 'job' }];
      return [];
    });
    const store = createProjectionStore(fake.database);
    await expect(store.pruneHistory({
      before: '2026-08-01T00:00:00.000Z', keepRecentSnapshotsPerLeagueWeek: 3,
    })).resolves.toEqual({ kind: 'stored', value: {
      snapshotsDeleted: 2, leagueObservationsDeleted: 1,
      gameObservationsDeleted: 1, projectionRunsDeleted: 0, jobsDeleted: 1,
    } });
    expect(fake.calls).toHaveLength(5);
    expect(fake.calls[0].statement).toContain('current_projection_snapshots');
    expect(fake.calls[0].parameters[1]).toBe(3);
  });

  it('rejects a snapshot when the database cannot validate all sources', async () => {
    const fake = fakeDatabase();
    const store = createProjectionStore(fake.database);
    await expect(store.publishSnapshot({
      leagueSeasonId: 'season-id', week: 1, modelVersion: 'clock-v1',
      revisionKey: 'revision-1', leagueWeekObservationId: 'partial-observation',
      gameStateObservationIds: [], calculatedAt: snapshot.updatedAt,
      payload: snapshot, activityWindows: [],
    })).resolves.toEqual({ kind: 'rejected', reason: 'incomplete-or-mismatched-sources' });
  });
});

describe('projection migration', () => {
  it('enforces immutable baselines and snapshots without embedding provider league IDs', async () => {
    const migration = await readFile(
      new URL('../migrations/001_projection_foundation.sql', import.meta.url),
      'utf8',
    );
    expect(migration).toContain('pregame_projection_baselines_immutable');
    expect(migration).toContain('projection_snapshots_immutable');
    expect(migration).toContain('league_week_expected_games');
    expect(migration).toContain('content_hash text NOT NULL');
    expect(migration).toContain("activity_windows jsonb NOT NULL DEFAULT '[]'::jsonb");
    expect(migration).toContain('verified_at timestamptz NOT NULL DEFAULT now()');
    expect(migration).toMatch(/source_projection_run_id uuid NOT NULL/u);
    expect(migration).toContain(
      'FOREIGN KEY (source_projection_run_id, projection_provider, model_version)',
    );
    expect(migration).toContain(
      'FOREIGN KEY (league_week_observation_id, league_season_id, week)',
    );
    expect(migration).toContain('FOREIGN KEY (snapshot_id, league_season_id, week)');
    expect(migration).toContain('pregame_projection_baselines_lookup_idx');
    expect(migration).toContain('pregame_projection_runs_retention_idx');
    expect(migration).toContain('game_state_observations_retention_idx');
    expect(migration).toContain('league_week_observations_retention_idx');
    expect(migration).toContain('league_seasons_scoring_profile_immutable');
    expect(migration).toContain('scoring_profiles_immutable');
    expect(migration).toContain('UNIQUE (provider, external_league_id)');
    expect(migration).toContain(
      'DROP CONSTRAINT IF EXISTS external_game_ids_provider_nfl_game_id_key',
    );
    expect(migration).toContain('external_game_ids_game_idx');
    expect(migration).not.toContain('UNIQUE (provider, nfl_game_id)');
    expect(migration).not.toMatch(/\b\d{16,}\b/u);
  });

  it('requires a separate privileged migration credential and provisions a restricted runtime role', async () => {
    const migrationRunner = await readFile(
      new URL('../scripts/migrate.mjs', import.meta.url),
      'utf8',
    );
    expect(migrationRunner).toContain('process.env.MIGRATION_DATABASE_URL?.trim()');
    expect(migrationRunner).not.toContain('process.env.DATABASE_URL');
    expect(migrationRunner).toContain("['require', 'verify-ca', 'verify-full']");

    const grants = await readFile(
      new URL('../scripts/provision-runtime-role.sql', import.meta.url),
      'utf8',
    );
    expect(grants).toContain('GRANT USAGE ON SCHEMA public TO league_one_runtime');
    expect(grants).toContain('REVOKE CREATE ON SCHEMA public FROM league_one_runtime');
    expect(grants).toContain('CREATE ROLE league_one_runtime');
    expect(grants).toContain("pg_has_role('league_one_runtime', 'neon_superuser', 'MEMBER')");
    expect(grants).toContain('league_one_runtime still has object-creation privileges');
    expect(grants).toContain('MIGRATION_DATABASE_URL');
    expect(grants).not.toMatch(/PASSWORD\s+['"]/iu);
  });

  it('serializes and rejects regressive provider game states', async () => {
    const migration = await readFile(
      new URL('../migrations/001_projection_foundation.sql', import.meta.url),
      'utf8',
    );
    expect(migration).toContain('pg_advisory_xact_lock');
    expect(migration).toContain('final game became non-final');
    expect(migration).toContain('started game became pregame');
    expect(migration).toContain('live game became postponed');
    expect(migration).toContain('period moved backward');
    expect(migration).toContain('regulation clock increased');
    expect(migration).toContain('game_state_observations_no_regression');
  });
});
