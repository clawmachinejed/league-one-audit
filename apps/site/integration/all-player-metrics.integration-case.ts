import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { registerEnrolledIntegrationSeason } from './administration-enrollment-fixture';
import type { DatabaseClient, DatabaseRow } from '../lib/database';
import { createProjectionStore } from '../lib/projection-store';
import { scoreSparseStatistics } from '../lib/projections/domain/scoring';
import production from '../test-support/fixtures/actual-player-ranks/production.json';
import { createIndependentDatabase, createPinnedIntegrationDatabase,
  type IndependentDatabase } from './neon-integration-harness';

type FixtureEntry = {
  stats: Record<string, number>;
  position: string;
  entity_kind: 'player' | 'team_defense';
  mapping_state: 'usable' | 'absent';
  scoring_entity_id: string | null;
  eligible_game_count: number | null;
  appearance_game_count: number | null;
  eligibility_evidence: Record<string, unknown>;
  provider_external_id: string;
};
const entries = production.entries as unknown as readonly FixtureEntry[];
const SEASON = 2197;
const ABSENT_PLAYER = '11280';

describe('actual all-player position ranks through the stored SQL reader', () => {
  let transaction: IndependentDatabase;
  let db: DatabaseClient;
  let addedEntityId: string;
  let baselineContentId: string;
  let baselineRead: Awaited<ReturnType<ReturnType<typeof createProjectionStore>['readAllPlayerPlayerMetrics']>>;

  async function seedPartial(sourceEntries: readonly FixtureEntry[], week = 1, options: {
    quality?: 'partial' | 'complete'; observedAt?: string; completedAt?: string; createdAt?: string;
  } = {}) {
    const contentId = randomUUID();
    const gameId = randomUUID();
    await db.query(`INSERT INTO nfl_games (id,season,season_type,week,home_team,away_team)
      VALUES ($1::uuid,$2::smallint,'reg',$3::smallint,'NE','ATL')
      ON CONFLICT (season,season_type,week,home_team,away_team) DO NOTHING`, [gameId, SEASON, week]);
    const rawEntries = sourceEntries.map((entry, ordinal) => {
      const evidence = structuredClone(entry.eligibility_evidence);
      if (evidence.effectivePeriod) evidence.effectivePeriod = { season: SEASON, seasonType: 'reg', week };
      return { ...entry, eligibility_evidence: evidence, ordinal };
    });
    await db.query(`INSERT INTO all_player_stat_contents (
      id,provider,season,season_type,week,normalizer_version,semantic_hash,quality,coverage,warnings,entry_count
    ) VALUES ($1::uuid,'sleeper',$2::smallint,'reg',$3::smallint,'sleeper-weekly-stats-v4',
      $4,$7,$5::jsonb,'[]'::jsonb,$6::integer)`, [contentId, SEASON, week,
      createHash('sha256').update(JSON.stringify(rawEntries)).digest('hex'), JSON.stringify({
        complete: options.quality === 'complete', rankUnavailablePositions: production.observation.projectionRankUnavailablePositions,
      }), rawEntries.length, options.quality ?? 'partial']);
    await db.query(`INSERT INTO all_player_stat_entries (
      all_player_stat_content_id,entity_kind,provider_external_id,nfl_game_id,nfl_team,position,stats,
      eligibility_evidence,eligible_game_count,appearance_game_count,game_phase,ordinal
    ) SELECT $1::uuid,entry.entity_kind,entry.provider_external_id,game.id,'NE',entry.position,entry.stats,
        entry.eligibility_evidence,entry.eligible_game_count,entry.appearance_game_count,'live',entry.ordinal
      FROM jsonb_to_recordset($2::jsonb) entry(entity_kind text,provider_external_id text,position text,
        stats jsonb,eligibility_evidence jsonb,eligible_game_count smallint,appearance_game_count smallint,
        ordinal integer)
      JOIN nfl_games game ON game.season=$3::smallint AND game.season_type='reg'
        AND game.week=$4::smallint AND game.home_team='NE' AND game.away_team='ATL'`,
    [contentId, JSON.stringify(rawEntries), SEASON, week]);
    await db.query(`INSERT INTO all_player_stat_observations (
      id,all_player_stat_content_id,provider,season,season_type,week,normalizer_version,
      source_revision,request_started_at,request_completed_at,observed_at,quality,created_at
    ) VALUES (gen_random_uuid(),$1::uuid,'sleeper',$2::smallint,'reg',$3::smallint,
      'sleeper-weekly-stats-v4','retained-actual-rank-fixture-'||$1::text,
      COALESCE($4::timestamptz,CURRENT_TIMESTAMP-interval '2 days')-interval '1 second',
      COALESCE($5::timestamptz,$4::timestamptz,CURRENT_TIMESTAMP-interval '2 days'),
      COALESCE($4::timestamptz,CURRENT_TIMESTAMP-interval '2 days'),$7,
      COALESCE($6::timestamptz,CURRENT_TIMESTAMP))`, [contentId, SEASON, week,
      options.observedAt ?? null, options.completedAt ?? null, options.createdAt ?? null,
      options.quality ?? 'partial']);
    return contentId;
  }

  async function historyFingerprint() {
    return db.query(`SELECT
      (SELECT md5(COALESCE(string_agg(to_jsonb(entry)::text,'' ORDER BY all_player_stat_content_id,
        entity_kind,provider_external_id),'')) FROM all_player_stat_entries entry) AS entries,
      (SELECT md5(COALESCE(string_agg(to_jsonb(content)::text,'' ORDER BY id),''))
        FROM all_player_stat_contents content) AS contents,
      (SELECT md5(COALESCE(string_agg(to_jsonb(observation)::text,'' ORDER BY id),''))
        FROM all_player_stat_observations observation) AS observations,
      (SELECT md5(COALESCE(string_agg(to_jsonb(mapping)::text,'' ORDER BY provider,entity_kind,external_id),''))
        FROM external_scoring_entity_ids mapping) AS mappings,
      (SELECT count(*)::integer FROM all_player_score_sets) AS score_sets,
      (SELECT count(*)::integer FROM all_player_scores) AS scores,
      (SELECT count(*)::integer FROM all_player_score_verifications) AS verifications,
      (SELECT md5(COALESCE(string_agg(to_jsonb(pointer)::text,'' ORDER BY scoring_profile_id,provider,
        season,season_type,week,scorer_version),'')) FROM current_all_player_score_sets pointer) AS pointers`);
  }

  async function read(leagueKey = 'league1', throughWeek = 1, asOf?: string) {
    const before = await historyFingerprint();
    const statements: string[] = [];
    const reader = createProjectionStore({
      enabled: true,
      async query<Row extends DatabaseRow>(statement: string, parameters: readonly unknown[] = []) {
        statements.push(statement);
        expect(statement).toContain('projection-store:read-all-player-player-metrics');
        expect(statement).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|MERGE|TRUNCATE|CALL)\b/iu);
        return db.query<Row>(statement, parameters);
      },
    });
    try {
      return await reader.readAllPlayerPlayerMetrics({ leagueKey, provider: 'sleeper', season: SEASON,
        seasonType: 'reg', throughWeek, provisionalWeek: throughWeek, scorerVersion: 'sleeper-actual-v1',
        ...(asOf === undefined ? {} : { asOf }),
      }, scoreSparseStatistics);
    } finally {
      expect(statements).toHaveLength(1);
      expect(await historyFingerprint()).toEqual(before);
    }
  }

  async function addMapping(options: {
    id?: string; kind?: 'player' | 'team_defense'; targetKind?: 'player' | 'team_defense';
    status?: 'verified' | 'unverified' | 'retired'; validFrom?: string; validTo?: string | null;
    canonicalId?: string;
  } = {}) {
    const canonicalId = options.canonicalId ?? addedEntityId;
    await db.query(`INSERT INTO scoring_entities (id,kind,display_name)
      VALUES ($1::uuid,$2,'Synthetic mapping guard') ON CONFLICT (id) DO NOTHING`,
    [canonicalId, options.targetKind ?? options.kind ?? 'player']);
    await db.query(`INSERT INTO external_scoring_entity_ids (
      provider,entity_kind,external_id,scoring_entity_id,mapping_status,valid_from,valid_to
    ) VALUES ('sleeper',$1,$2,$3::uuid,$4,
      CURRENT_TIMESTAMP + $5::interval,
      CASE WHEN $6::text IS NULL THEN NULL ELSE CURRENT_TIMESTAMP+$6::interval END)`,
    [options.kind ?? 'player', options.id ?? ABSENT_PLAYER, canonicalId,
      options.status ?? 'verified', options.validFrom ?? '-1 day', options.validTo ?? null]);
  }

  beforeAll(async () => {
    transaction = await createPinnedIntegrationDatabase('owner');
    db = transaction.database;
    await db.query('BEGIN');
    for (const [index, scoringRules] of [production.profiles[0].rules,
      { ...production.profiles[0].rules, rec: 1 }].entries()) {
      await registerEnrolledIntegrationSeason(db.query, { leagueKey: `league${index + 1}`, season: SEASON,
        sleeperLeagueId: `actual-rank-sql-${index + 1}`, scoringRules });
    }
    // Preserve production's observed mapping presence. Any other test's aliases
    // are removed only inside this transaction and restored by the final rollback.
    await db.query(`DELETE FROM external_scoring_entity_ids WHERE provider='sleeper'
      AND external_id=ANY($1::text[])`, [entries.map((entry) => entry.provider_external_id)]);
    const usable = entries.filter((entry) => entry.mapping_state === 'usable');
    await db.query(`INSERT INTO scoring_entities (id,kind,display_name)
      SELECT entry.scoring_entity_id,entry.entity_kind,'Retained identity '||entry.provider_external_id
      FROM jsonb_to_recordset($1::jsonb) entry(scoring_entity_id uuid,entity_kind text,provider_external_id text)
      ON CONFLICT (id) DO NOTHING`, [JSON.stringify(usable)]);
    await db.query(`INSERT INTO external_scoring_entity_ids (
      provider,entity_kind,external_id,scoring_entity_id,mapping_status,valid_from
    ) SELECT 'sleeper',entry.entity_kind,entry.provider_external_id,entry.scoring_entity_id,
      'verified',CURRENT_TIMESTAMP-interval '3 days'
      FROM jsonb_to_recordset($1::jsonb) entry(scoring_entity_id uuid,entity_kind text,provider_external_id text)`,
    [JSON.stringify(usable)]);
    addedEntityId = randomUUID();
    baselineContentId = await seedPartial(entries);
    baselineRead = await read();
  });
  beforeEach(async () => { await db.query('SAVEPOINT actual_rank_case'); });
  afterEach(async () => { await db.query('ROLLBACK TO SAVEPOINT actual_rank_case'); });
  afterAll(async () => {
    if (transaction) {
      try { await db.query('ROLLBACK'); } finally { await transaction.close(); }
    }
  });

  it('executes the identical query with actual restricted runtime credentials without role escalation', async () => {
    const runtime = createIndependentDatabase();
    const before = await historyFingerprint();
    try {
      // The synthetic fixture remains uncommitted in the owner transaction, so
      // this runtime session sees no target profile. PostgreSQL still checks the
      // actual query's complete table permissions. No test grants SET ROLE.
      const actual = await createProjectionStore(runtime.database).readAllPlayerPlayerMetrics({
        leagueKey: 'league1', provider: 'sleeper', season: SEASON, seasonType: 'reg',
        throughWeek: 1, provisionalWeek: 1, scorerVersion: 'sleeper-actual-v1',
      }, scoreSparseStatistics);
      expect(actual).toMatchObject({ status: 'unavailable', rowsRead: 0, metrics: [] });
      expect(await historyFingerprint()).toEqual(before);
    } finally {
      await runtime.close();
    }
  });

  it('ranks actual unmapped peers and zero-score memberships without requiring a roster or projection alias', async () => {
    expect(entries).toHaveLength(323);
    expect(entries.filter((entry) => entry.mapping_state === 'absent')).toHaveLength(21);
    expect(baselineRead).toMatchObject({ status: 'provisional', throughWeek: 1, rowsRead: 322 });
    expect(baselineRead.metrics).toHaveLength(202);
    for (const [position, count] of Object.entries({ QB: 22, RB: 46, WR: 62, TE: 34, K: 19, DEF: 19 })) {
      const ranked = baselineRead.metrics.filter((metric) => metric.position === position);
      expect(ranked).toHaveLength(count);
      expect(ranked.every((metric) => metric.positionRank !== null)).toBe(true);
    }
    expect(baselineRead.metrics).toEqual(expect.arrayContaining([
      expect.objectContaining({ providerExternalId: '11280', scoringEntityId: null,
        totalFantasyPoints: 3, pointsPerGame: 3, appearanceGameCount: 1, positionRank: 23 }),
      expect.objectContaining({ providerExternalId: '12048', scoringEntityId: null,
        totalFantasyPoints: expect.closeTo(2.9, 8), pointsPerGame: expect.closeTo(2.9, 8),
        appearanceGameCount: 1, positionRank: 25 }),
      expect.objectContaining({ providerExternalId: '12732', scoringEntityId: null,
        totalFantasyPoints: 1.6, pointsPerGame: null, appearanceGameCount: 0, positionRank: 50 }),
      expect.objectContaining({ providerExternalId: '5859',
        totalFantasyPoints: 4.1, pointsPerGame: 4.1, appearanceGameCount: 1, positionRank: 29 }),
    ]));
    // Real raw arithmetic reaches equivalent decimal totals through different
    // floating operations. Rank keys match stored numeric(14,4) weekly scores.
    for (const [ids, rank] of [
      [['11576', '8228'], 21], [['10219', '12474'], 28],
      [['12969', '7567'], 32], [['5967', '9757'], 34],
    ] as const) {
      expect(ids.map((id) => baselineRead.metrics.find((metric) => metric.providerExternalId === id)?.positionRank))
        .toEqual([rank, rank]);
    }
    expect((await db.query<{ count: number }>(`SELECT count(*)::integer AS count
      FROM official_player_point_observations points
      JOIN league_week_observations observation ON observation.id=points.league_week_observation_id
      JOIN league_seasons season ON season.id=observation.league_season_id
      WHERE season.season=$1::smallint`, [SEASON]))[0].count).toBe(0);
  });

  it('uses each league profile independently for an unrostered source-only player', async () => {
    const divergent = await read('league2');
    const original = baselineRead.metrics.find((metric) => metric.providerExternalId === ABSENT_PLAYER)!;
    const changed = divergent.metrics.find((metric) => metric.providerExternalId === ABSENT_PLAYER)!;
    expect(changed).toMatchObject({ totalFantasyPoints: 4, pointsPerGame: 4, scoringEntityId: null,
      positionRank: 22 });
    expect(changed.scoringProfileId).not.toBe(original.scoringProfileId);
    expect((await read()).metrics).toEqual(baselineRead.metrics);
  });

  it.each(['observation', 'request completion', 'late persistence'] as const)(
    'keeps the weekly cutoff stable when a correction has postcutoff %s', async (lateField) => {
      // These explicitly timed owner fixtures are confined to the harness's
      // disposable transaction. They prove SQL selection, not provider cadence.
      const [{ cutoff }] = await db.query<{ cutoff: string }>(
        `SELECT (CURRENT_TIMESTAMP + interval '2 minutes')::text AS cutoff`,
      );
      const cutoffTime = Date.parse(cutoff);
      const asOf = new Date(cutoffTime).toISOString();
      const before = new Date(cutoffTime - 1000).toISOString();
      const after = new Date(cutoffTime + 1000).toISOString();
      const source = entries.find((entry) => entry.provider_external_id === '5859')!;
      await seedPartial([{ ...source, stats: { ...source.stats, rec: source.stats.rec + 10 } }], 1, {
        observedAt: lateField === 'observation' ? after : before,
        completedAt: lateField === 'observation' || lateField === 'request completion' ? after : before,
        createdAt: lateField === 'late persistence' ? after : before,
      });
      const held = await read('league1', 1, asOf);
      expect(held).toEqual(baselineRead);
      const nextCutoff = await read('league1', 1, new Date(cutoffTime + 2000).toISOString());
      expect(nextCutoff.status).toBe('provisional');
      expect(nextCutoff.metrics.find((metric) => metric.providerExternalId === '5859')!.pointsPerGame)
        .toBeGreaterThan(baselineRead.metrics.find((metric) => metric.providerExternalId === '5859')!.pointsPerGame!);
      expect((await read()).metrics).toEqual(nextCutoff.metrics);
    },
  );

  it('derives cutoff values from complete raw history without claiming it was published', async () => {
    const [{ cutoff }] = await db.query<{ cutoff: string }>(
      `SELECT (CURRENT_TIMESTAMP + interval '2 minutes')::text AS cutoff`,
    );
    const asOf = new Date(cutoff).toISOString();
    const source = entries.find((entry) => entry.provider_external_id === '5859')!;
    await seedPartial([{ ...source, stats: { ...source.stats, rec: source.stats.rec + 10 } }], 1, {
      quality: 'complete', observedAt: new Date(Date.parse(asOf) - 1000).toISOString(),
    });
    const held = await read('league1', 1, asOf);
    expect(held.status).toBe('provisional');
    expect(held.metrics).toHaveLength(1);
    expect(held.metrics[0]).toMatchObject({ providerExternalId: '5859', publishedWeekCount: 0 });
    expect(held.metrics[0].pointsPerGame).toBeGreaterThan(4.1);
    // Legacy callers still use current published pointers / partial observations.
    expect(await read()).toEqual(baselineRead);
  });

  it('uses a later registered immutable league profile with statistics retained before the cutoff', async () => {
    const [{ cutoff }] = await db.query<{ cutoff: string }>(
      `SELECT (CURRENT_TIMESTAMP - interval '1 second')::text AS cutoff`,
    );
    const asOf = new Date(cutoff).toISOString();
    const before = new Date(Date.parse(asOf) - 1000).toISOString();
    const source = entries.find((entry) => entry.provider_external_id === '5859')!;
    await seedPartial([source], 1, { observedAt: before, completedAt: before, createdAt: before });
    const [registration] = await db.query<{ after_cutoff: boolean }>(`SELECT
      season.created_at > $2::timestamptz AND profile.created_at > $2::timestamptz AS after_cutoff
      FROM league_seasons season JOIN leagues league ON league.id=season.league_id
      JOIN scoring_profiles profile ON profile.id=season.scoring_profile_id
      WHERE league.league_key='league1' AND season.season=$1::smallint`, [SEASON, asOf]);
    expect(registration.after_cutoff).toBe(true);
    const held = await read('league1', 1, asOf);
    expect(held.status).toBe('provisional');
    expect(held.metrics).toHaveLength(1);
    expect(held.metrics[0]).toMatchObject({ providerExternalId: '5859', pointsPerGame: 4.1,
      totalFantasyPoints: 4.1, publishedWeekCount: 0 });
  });

  it('enriches a valid player registered after the raw observation using current validity without rewriting history', async () => {
    await addMapping();
    const rows = await db.query<{ later: boolean }>(`SELECT mapping.valid_from>observation.observed_at AS later
      FROM external_scoring_entity_ids mapping CROSS JOIN all_player_stat_observations observation
      WHERE mapping.provider='sleeper' AND mapping.external_id=$1
        AND observation.all_player_stat_content_id=$2::uuid`, [ABSENT_PLAYER, baselineContentId]);
    expect(rows[0].later).toBe(true);
    const actual = await read();
    expect(actual.metrics).toEqual(baselineRead.metrics.map((metric) => metric.providerExternalId === ABSENT_PLAYER
      ? { ...metric, scoringEntityId: addedEntityId } : metric));
  });

  it.each([
    { label: 'future validity', validFrom: '1 day' },
    { label: 'expired validity', validFrom: '-3 days', validTo: '-1 day' },
    { label: 'retired relationship', status: 'retired' as const },
    { label: 'unverified relationship', status: 'unverified' as const },
    { label: 'wrong alias kind', kind: 'team_defense' as const },
    { label: 'wrong canonical kind', targetKind: 'team_defense' as const },
  ])('does not treat $label as an absent mapping', async (options) => {
    await addMapping(options);
    const actual = await read();
    expect(actual.metrics.some((metric) => metric.providerExternalId === ABSENT_PLAYER)).toBe(false);
    expect(actual.metrics.filter((metric) => metric.position === 'RB')
      .every((metric) => metric.positionRank === null)).toBe(true);
    expect(actual.metrics.find((metric) => metric.position === 'QB')?.positionRank).not.toBeNull();
  });

  it('rejects cross-kind ambiguity even when one of the two aliases would be usable', async () => {
    await addMapping();
    await addMapping({ kind: 'team_defense', canonicalId: randomUUID() });
    const actual = await read();
    expect(actual.metrics.some((metric) => metric.providerExternalId === ABSENT_PLAYER)).toBe(false);
    expect(actual.metrics.filter((metric) => metric.position === 'RB')
      .every((metric) => metric.positionRank === null)).toBe(true);
  });

  it('requires a canonical defense even when its official source row has valid points', async () => {
    await db.query(`DELETE FROM external_scoring_entity_ids
      WHERE provider='sleeper' AND external_id='ATL'`);
    const actual = await read();
    expect(actual.metrics.some((metric) => metric.providerExternalId === 'ATL')).toBe(false);
    expect(actual.metrics.filter((metric) => metric.position === 'DEF')
      .every((metric) => metric.positionRank === null)).toBe(true);
  });

  it('does not invent a source-only identity from a malformed unmapped player ID', async () => {
    const source = entries.find((entry) => entry.provider_external_id === ABSENT_PLAYER)!;
    await seedPartial([{ ...source, provider_external_id: 'not-an-official-player-id' }], 2);
    const actual = await read('league1', 2);
    expect(actual.metrics.some((metric) => metric.providerExternalId === 'not-an-official-player-id')).toBe(false);
    expect(actual.metrics.filter((metric) => metric.position === 'RB')
      .every((metric) => metric.positionRank === null)).toBe(true);
  });

  it('retains nonzero zero-appearance contradiction without erasing prior valid points or inventing PPG', async () => {
    const zeroControl = entries.find((entry) => entry.provider_external_id === '7527')!;
    await seedPartial([{ ...zeroControl, stats: { ...zeroControl.stats, pass_yd: 25 } }], 2);
    const actual = await read('league1', 2);
    expect(actual.metrics.some((metric) => metric.providerExternalId === '7527')).toBe(false);
    const beforeQuarterbacks = baselineRead.metrics.filter((metric) => metric.position === 'QB');
    const afterQuarterbacks = actual.metrics.filter((metric) => metric.position === 'QB');
    expect(afterQuarterbacks).toEqual(beforeQuarterbacks.map((metric) => ({ ...metric, positionRank: null }))
      .sort((left, right) => left.providerExternalId.localeCompare(right.providerExternalId)));
  });

  it('rejects distinct actual official identities collapsing onto one canonical target', async () => {
    await addMapping();
    await addMapping({ id: '12048' });
    await expect(read()).rejects.toThrow('Distinct all-player identities share one canonical target.');
  });
});
