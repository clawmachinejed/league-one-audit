import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createProjectionStore, type ProjectionStore } from '../lib/projection-store';
import { json, rulesHash } from '../lib/projections/adapters/neon/database-values';
import { stored } from './lineup-lineage-fixture';
import { createIndependentDatabase, type IndependentDatabase } from './neon-integration-harness';

const at = '2026-09-03T12:00:00.000Z';
const baseCommit = 'ed7a60074254d3d73df6c59901648f61ff1ae9ea';
let database: IndependentDatabase;
let store: ProjectionStore;
let registrationSql: string;
let gameSql: string;
let runSql: string;

function only<Value>(rows: readonly Value[]): Value {
  expect(rows).toHaveLength(1);
  return rows[0];
}

beforeAll(async () => {
  // These are the entire original client.query templates, not reconstructed SQL fragments.
  const directory = new URL('./fixtures/b3-legacy-sql/', import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('provenance.json', directory), 'utf8')) as {
    baseCommit: string; statements: { fixture: string; querySha256: string }[];
  };
  expect(manifest.baseCommit).toBe(baseCommit);
  const read = async (name: string) => {
    const sql = await readFile(new URL(name, directory), 'utf8');
    expect(createHash('sha256').update(sql).digest('hex'))
      .toBe(manifest.statements.find((entry) => entry.fixture === name)?.querySha256);
    return sql;
  };
  [registrationSql, gameSql, runSql] = await Promise.all([
    read('register-league-season.sql'), read('record-game-states.sql'),
    read('record-projection-candidates.sql'),
  ]);
});

function useRuntimeFixture(transactional: boolean) {
  beforeEach(async () => {
    database = createIndependentDatabase();
    store = createProjectionStore(database.database);
    if (transactional) await database.database.query('BEGIN');
  });
  afterEach(async () => {
    try {
      if (transactional) await database.database.query('ROLLBACK');
    } finally { await database.close(); }
  });
}

async function legacyLeague() {
  const key = `b3-legacy-${randomUUID()}`;
  const rules = { pass_td: 4, pass_yd: Number.parseInt(randomUUID().slice(0, 8), 16) / 1e12 };
  const input = {
    leagueKey: key, leagueName: 'Synthetic legacy compatibility league', season: 2026,
    sleeperLeagueId: `${key}-source`, scoringRules: rules,
  };
  const parameters = [rulesHash(rules), json(rules), input.leagueKey,
    input.leagueName, input.season, input.sleeperLeagueId];
  const row = only(await database.database.query<{
    league_id: string; league_season_id: string; scoring_profile_id: string;
  }>(registrationSql, parameters));
  return { row, parameters, input };
}

async function gameFixture() {
  const externalGameId = `b3-legacy-game-${randomUUID()}`;
  // This identity path is unchanged from the pinned base; each natural key is synthetic and unique.
  const game = only(stored(await store.upsertNflGames([{
    key: externalGameId, provider: 'tank01', externalGameId,
    season: 2026, seasonType: 'reg', week: 14,
    homeTeam: externalGameId, awayTeam: 'B3-SYNTHETIC-AWAY',
    kickoffAt: '2026-12-13T17:00:00.000Z',
  }])));
  const state = {
    externalGameId, sourceRevision: randomUUID(), requestStartedAt: at, requestCompletedAt: at,
    observedAt: at, statusCode: 0 as const, period: null, gameClock: null,
    homeScore: null, awayScore: null, sourceData: { synthetic: 'legacy-game' },
  };
  const parameters = ['tank01', json([{
    external_game_id: state.externalGameId, source_revision: state.sourceRevision,
    request_started_at: state.requestStartedAt, request_completed_at: state.requestCompletedAt,
    observed_at: state.observedAt, status_code: state.statusCode, period: state.period,
    game_clock: state.gameClock, home_score: state.homeScore, away_score: state.awayScore,
    source_data: state.sourceData,
  }])];
  return { game, state, parameters };
}

async function runFixture() {
  const league = await legacyLeague();
  const { game } = await gameFixture();
  const entityKey = `b3-legacy-entity-${randomUUID()}`;
  const entity = only(stored(await store.upsertScoringEntities([{
    key: entityKey, kind: 'player', displayName: 'Synthetic legacy player', nflTeam: null,
    providerIds: [{ provider: 'tank01', externalId: entityKey }],
  }])));
  if (!entity.entityId) throw new Error('Synthetic legacy entity did not resolve.');
  const sourceRevision = randomUUID();
  const slateInput = {
    provider: 'tank01', season: 2026, seasonType: 'reg' as const, week: 14,
    normalizerVersion: `b3-legacy-${randomUUID()}`, sourceRevision,
    requestStartedAt: at, requestCompletedAt: at, observedAt: at,
    quality: 'complete' as const, coverage: { playerRows: 1 }, warnings: [],
    entries: [{ entityKind: 'player' as const, providerExternalId: entityKey,
      aliases: [], nflTeam: null, position: 'QB', stats: { passingYards: 250 },
      scoringStats: { kind: 'offense', passingYards: 250 }, missingFields: [] }],
  };
  // Slate ingestion is also unchanged from the pinned base, so the legacy group runs on migrations 001–007.
  const slate = stored(await store.recordProjectionSlate(slateInput));
  const input = {
    provider: 'tank01', season: 2026, seasonType: 'reg' as const, week: 14,
    modelVersion: 'b3-legacy-test-v1', sourceRevision,
    requestStartedAt: at, requestCompletedAt: at, fetchedAt: at, quality: 'complete' as const,
    candidates: [{ gameId: game.gameId, entityId: entity.entityId,
      scoringProfileId: league.row.scoring_profile_id, projectionPoints: 10,
      projectedStats: { passingYards: 250 }, quality: 'complete' as const }],
  };
  const parameters: unknown[] = [input.provider, input.season, input.seasonType, input.week,
    input.modelVersion, input.sourceRevision, input.requestStartedAt, input.requestCompletedAt,
    input.fetchedAt, input.quality, null, json(input.candidates.map((candidate) => ({
      game_id: candidate.gameId, entity_id: candidate.entityId,
      scoring_profile_id: candidate.scoringProfileId, projection_points: candidate.projectionPoints,
      projected_stats: candidate.projectedStats, quality: candidate.quality,
    })))];
  return { league, input, slateInput, slate, parameters };
}

async function historicalRun(id: string) {
  return only(await database.database.query<{ row: Record<string, unknown> }>(
    'SELECT to_jsonb(run) AS row FROM pregame_projection_runs run WHERE id = $1', [id],
  )).row;
}

async function denyMutation(statement: string, parameters: readonly unknown[]) {
  // Pool.query evicts a failed connection. Use committed synthetic fixtures and a
  // separate attack transaction so reconnecting cannot lose fixture setup/savepoints.
  const attempt = createIndependentDatabase();
  try {
    await attempt.database.query('BEGIN');
    await expect(attempt.database.query(statement, parameters))
      .rejects.toThrow(/immutable|lineage|permission|foreign key/iu);
  } finally {
    try { await attempt.database.query('ROLLBACK'); } finally { await attempt.close(); }
  }
}

// Root can select this group unchanged for old-app/old-schema and old-app/additive-schema evidence.
describe.sequential('legacy application SQL compatibility', () => {
  useRuntimeFixture(true);
  it('creates and replays profiles and league registrations using the exact pre-B3 query', async () => {
    const fixture = await legacyLeague();
    const before = only(await database.database.query<{ row: unknown }>(
      'SELECT to_jsonb(profile) AS row FROM scoring_profiles profile WHERE id = $1',
      [fixture.row.scoring_profile_id],
    )).row;
    expect(only(await database.database.query(registrationSql, fixture.parameters))).toEqual(fixture.row);
    expect(only(await database.database.query<{ row: unknown }>(
      'SELECT to_jsonb(profile) AS row FROM scoring_profiles profile WHERE id = $1',
      [fixture.row.scoring_profile_id],
    )).row).toEqual(before);
  });

  it('creates and exactly replays game observations using the exact pre-B3 query', async () => {
    const fixture = await gameFixture();
    const created = only(await database.database.query<{ observation_id: string }>(gameSql, fixture.parameters));
    expect(only(await database.database.query(gameSql, fixture.parameters))).toEqual(created);
    expect(only(await database.database.query<{ count: number }>(
      'SELECT count(*)::integer AS count FROM game_state_observations WHERE nfl_game_id = $1',
      [fixture.game.gameId],
    )).count).toBe(1);
  });

  it('creates, replays, and enriches NULL to the matching slate using the exact pre-B3 run query', async () => {
    const fixture = await runFixture();
    const created = only(await database.database.query<{ run_id: string; candidates_stored: number }>(
      runSql, fixture.parameters,
    ));
    expect(created.candidates_stored).toBe(1);
    const before = await historicalRun(created.run_id);
    expect(before.projection_slate_observation_id).toBeNull();
    expect(only(await database.database.query(runSql, fixture.parameters)))
      .toMatchObject({ run_id: created.run_id, candidates_stored: 0, candidate_count: 1 });
    const linkedParameters = [...fixture.parameters];
    linkedParameters[10] = fixture.slate.observationId;
    expect(only(await database.database.query(runSql, linkedParameters)))
      .toMatchObject({ run_id: created.run_id, candidates_stored: 0, candidate_count: 1 });
    expect(only(await database.database.query(runSql, linkedParameters)))
      .toMatchObject({ run_id: created.run_id, candidates_stored: 0 });
    expect(await historicalRun(created.run_id))
      .toEqual({ ...before, projection_slate_observation_id: fixture.slate.observationId });
  });

  it('replays an established link with different incoming times and quality while retaining stored history', async () => {
    const fixture = await runFixture();
    const linkedParameters = [...fixture.parameters];
    linkedParameters[10] = fixture.slate.observationId;
    const created = only(await database.database.query<{ run_id: string }>(runSql, linkedParameters));
    const before = await historicalRun(created.run_id);
    const replayParameters = [...linkedParameters];
    replayParameters[6] = '2026-09-03T11:59:59.000Z';
    replayParameters[7] = '2026-09-03T12:00:01.000Z';
    replayParameters[8] = '2026-09-03T12:00:02.000Z';
    replayParameters[9] = 'partial';
    expect(only(await database.database.query(runSql, replayParameters)))
      .toMatchObject({ run_id: created.run_id, candidates_stored: 0 });
    expect(await historicalRun(created.run_id)).toEqual(before);
  });

  it('enriches a NULL link against stored history despite different incoming replay times and quality', async () => {
    const fixture = await runFixture();
    const created = only(await database.database.query<{ run_id: string }>(runSql, fixture.parameters));
    const before = await historicalRun(created.run_id);
    expect(before.projection_slate_observation_id).toBeNull();
    const replayParameters = [...fixture.parameters];
    replayParameters[6] = '2026-09-03T11:59:59.000Z';
    replayParameters[7] = '2026-09-03T12:00:01.000Z';
    replayParameters[8] = '2026-09-03T12:00:02.000Z';
    replayParameters[9] = 'partial';
    replayParameters[10] = fixture.slate.observationId;
    expect(only(await database.database.query(runSql, replayParameters)))
      .toMatchObject({ run_id: created.run_id, candidates_stored: 0 });
    expect(await historicalRun(created.run_id))
      .toEqual({ ...before, projection_slate_observation_id: fixture.slate.observationId });
  });
});

describe.sequential('immediate legacy caller rollback with additive guards retained', () => {
  useRuntimeFixture(true);
  it('restores all three exact old queries after new callers write, including direct legacy enrichment', async () => {
    const fixture = await runFixture();
    const registered = stored(await store.registerLeagueSeason(fixture.league.input));
    expect(only(await database.database.query(registrationSql, fixture.league.parameters)))
      .toMatchObject({ league_season_id: registered.leagueSeasonId });
    const game = await gameFixture();
    const observed = only(stored(await store.recordGameStates({ provider: 'tank01', states: [game.state] })));
    expect(only(await database.database.query(gameSql, game.parameters)))
      .toMatchObject({ observation_id: observed.observationId });
    const created = stored(await store.recordProjectionCandidates(fixture.input));
    const before = await historicalRun(created.runId);
    expect(before.projection_slate_observation_id).toBeNull();
    const linkedParameters = [...fixture.parameters];
    linkedParameters[10] = fixture.slate.observationId;
    expect(only(await database.database.query(runSql, linkedParameters)))
      .toMatchObject({ run_id: created.runId, candidates_stored: 0 });
    expect(await historicalRun(created.runId))
      .toEqual({ ...before, projection_slate_observation_id: fixture.slate.observationId });
  });
});

describe.sequential('overlapping legacy and new caller compatibility', () => {
  useRuntimeFixture(false);
  it('serializes concurrent legacy and new NULL-link enrichment to the same immutable run', async () => {
    const fixture = await runFixture();
    const created = only(await database.database.query<{ run_id: string }>(runSql, fixture.parameters));
    const before = await historicalRun(created.run_id);
    expect(before.projection_slate_observation_id).toBeNull();
    const linkedParameters = [...fixture.parameters];
    linkedParameters[10] = fixture.slate.observationId;
    const connections = Array.from({ length: 4 }, () => createIndependentDatabase());
    try {
      const runIds = await Promise.all(connections.map(async (connection, index) => {
        if (index % 2 === 0) {
          return only(await connection.database.query<{ run_id: string }>(runSql, linkedParameters)).run_id;
        }
        return stored(await createProjectionStore(connection.database).recordProjectionCandidates({
          ...fixture.input, projectionSlateObservationId: fixture.slate.observationId,
        })).runId;
      }));
      expect(runIds).toEqual(Array(4).fill(created.run_id));
      expect(await historicalRun(created.run_id))
        .toEqual({ ...before, projection_slate_observation_id: fixture.slate.observationId });
      expect(only(await database.database.query<{ count: number }>(`
        SELECT count(*)::integer AS count FROM pregame_projection_runs
        WHERE provider = $1 AND season = $2 AND season_type = $3 AND week = $4
          AND model_version = $5 AND source_revision = $6`, fixture.parameters.slice(0, 6))).count).toBe(1);
    } finally {
      await Promise.all(connections.map((connection) => connection.close()));
    }
  });
});

describe.sequential('legacy transition immutable boundaries', () => {
  // The original guarded harness resets these synthetic fixtures after the suite.
  useRuntimeFixture(false);
  it.each([
    ['provider', 0, 'b3-other-provider'],
    ['season', 1, 2027],
    ['season type', 2, 'post'],
    ['week', 3, 15],
    ['source revision', 5, 'b3-other-source'],
    ['request start', 6, '2026-09-03T11:59:59.000Z'],
    ['request completion', 7, '2026-09-03T12:00:01.000Z'],
    ['observation time', 8, '2026-09-03T12:00:01.000Z'],
  ] as const)('denies direct NULL-to-link enrichment for mismatched %s', async (_label, index, value) => {
    const fixture = await runFixture();
    const mismatchedParameters = [...fixture.parameters];
    mismatchedParameters[index] = value;
    mismatchedParameters[11] = json([]);
    const run = only(await database.database.query<{ run_id: string }>(runSql, mismatchedParameters));
    const before = await historicalRun(run.run_id);
    expect(before.projection_slate_observation_id).toBeNull();
    await denyMutation('UPDATE pregame_projection_runs SET projection_slate_observation_id = $2 WHERE id = $1',
      [run.run_id, fixture.slate.observationId]);
    expect(await historicalRun(run.run_id)).toEqual(before);
  });

  it('rejects a genuinely new invalid linked run atomically with no candidate or pointer side effects', async () => {
    const fixture = await runFixture();
    const invalidParameters = [...fixture.parameters];
    invalidParameters[8] = '2026-09-03T12:00:01.000Z';
    invalidParameters[10] = fixture.slate.observationId;
    expect(fixture.input.candidates).toHaveLength(1);
    await denyMutation(runSql, invalidParameters);
    const fresh = createIndependentDatabase();
    try {
      const candidate = fixture.input.candidates[0];
      expect(only(await fresh.database.query<{
        runs: number; candidates: number; pointers: number;
      }>(`SELECT
        (SELECT count(*)::integer FROM pregame_projection_runs
          WHERE provider = $1 AND source_revision = $2 AND model_version = $3) AS runs,
        (SELECT count(*)::integer FROM pregame_projection_candidates
          WHERE nfl_game_id = $4 AND scoring_entity_id = $5 AND scoring_profile_id = $6) AS candidates,
        (SELECT count(*)::integer FROM current_pregame_projection_candidates
          WHERE nfl_game_id = $4 AND scoring_entity_id = $5 AND scoring_profile_id = $6) AS pointers`,
      [fixture.input.provider, fixture.input.sourceRevision, fixture.input.modelVersion,
        candidate.gameId, candidate.entityId, candidate.scoringProfileId])))
        .toEqual({ runs: 0, candidates: 0, pointers: 0 });
    } finally { await fresh.close(); }
  });

  it('denies nonexistent linkage and linkage combined with another historical field change', async () => {
    const fixture = await runFixture();
    const run = only(await database.database.query<{ run_id: string }>(runSql, fixture.parameters));
    const before = await historicalRun(run.run_id);
    await denyMutation('UPDATE pregame_projection_runs SET projection_slate_observation_id = $2 WHERE id = $1',
      [run.run_id, randomUUID()]);
    await denyMutation(`UPDATE pregame_projection_runs SET projection_slate_observation_id = $2,
      quality = 'invalid' WHERE id = $1`, [run.run_id, fixture.slate.observationId]);
    await denyMutation(`UPDATE pregame_projection_runs SET projection_slate_observation_id = $2,
      fetched_at = fetched_at + interval '1 second' WHERE id = $1`, [run.run_id, fixture.slate.observationId]);
    expect(await historicalRun(run.run_id)).toEqual(before);
  });

  it('denies replacing or clearing established lineage and moving league ownership', async () => {
    const fixture = await runFixture();
    const linkedParameters = [...fixture.parameters];
    linkedParameters[10] = fixture.slate.observationId;
    const run = only(await database.database.query<{ run_id: string }>(runSql, linkedParameters));
    const before = await historicalRun(run.run_id);
    const other = await runFixture();
    await denyMutation('UPDATE pregame_projection_runs SET projection_slate_observation_id = $2 WHERE id = $1',
      [run.run_id, other.slate.observationId]);
    await denyMutation('UPDATE pregame_projection_runs SET projection_slate_observation_id = NULL WHERE id = $1',
      [run.run_id]);
    await denyMutation('UPDATE league_seasons SET league_id = $2 WHERE id = $1',
      [fixture.league.row.league_season_id, other.league.row.league_id]);
    expect(await historicalRun(run.run_id)).toEqual(before);
  });
});
