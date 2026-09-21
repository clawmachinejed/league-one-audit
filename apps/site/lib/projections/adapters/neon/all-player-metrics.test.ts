import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import type { DatabaseRow } from '../../../database';
import { createFakeProjectionDatabase } from '../../../projection-store-test-support';
import { foundationFixture } from '../../../../test-support/all-player-foundation-fixture';
import actualRankFixture from '../../../../test-support/fixtures/actual-player-ranks/production.json';
import { scoreSparseStatistics } from '../../domain/scoring';
import { SLEEPER_ALL_PLAYER_SCORING_RULE_KEYS } from '../sleeper/scoring-profile';
import { createAllPlayerMetricMethods } from './all-player-metrics';

const profileId = '11111111-1111-4111-8111-111111111111';
const observedAt = '2026-09-12T03:30:00.000Z';
const rules = {
  pass_yd: 0.04, rush_yd: 0.1, rec: 1, rec_yd: 0.1,
  fgm: 3, sack: 1, fum_lost: -2,
};

function metadata(overrides: DatabaseRow = {}): DatabaseRow {
  return {
    row_kind: 'metadata', scoring_profile_id: profileId, rules,
    published_week_count: 0, published_through_week: null, published_observed_at: null,
    partial_week: 1, partial_observed_at: observedAt,
    rank_unavailable_positions: [], missing_prior_week_count: 0,
    ...overrides,
  };
}

function published(input: Readonly<{
  id: string; position: string; points: number; appearances: number;
  kind?: 'player' | 'team_defense'; entityId?: string | null;
}>): DatabaseRow {
  return {
    row_kind: 'published', scoring_profile_id: profileId,
    scoring_entity_id: input.entityId === undefined ? `entity-${input.id}` : input.entityId,
    provider_external_id: input.id, entity_kind: input.kind ?? 'player', position: input.position,
    total_fantasy_points: String(input.points),
    ppg_fantasy_points: input.appearances > 0 ? String(input.points) : '0',
    appearance_game_count: input.appearances,
    published_week_count: 1,
  };
}

function partial(input: Readonly<{
  id: string; position: string; stats: Readonly<Record<string, unknown>>;
  appearance?: number | null; eligible?: number | null; week?: number;
  kind?: 'player' | 'team_defense'; entityId?: string | null;
  mappingState?: 'absent' | 'usable' | 'unusable';
}>): DatabaseRow {
  return {
    row_kind: 'partial', scoring_profile_id: profileId,
    scoring_entity_id: input.entityId === undefined ? `entity-${input.id}` : input.entityId,
    provider_external_id: input.id, entity_kind: input.kind ?? 'player', position: input.position,
    stats: input.stats,
    partial_week: input.week ?? 1,
    appearance_game_count: input.appearance === undefined ? 1 : input.appearance,
    eligible_game_count: input.eligible === undefined ? 1 : input.eligible,
    mapping_state: input.mappingState ?? (input.entityId === null ? 'absent' : 'usable'),
  };
}

function read(rows: readonly DatabaseRow[], options: {
  leagueKey?: string; throughWeek?: number; provisionalWeek?: number | null; provider?: string; asOf?: string;
} = {}) {
  const fake = createFakeProjectionDatabase(() => rows);
  const result = createAllPlayerMetricMethods(fake.database).readAllPlayerPlayerMetrics({
    leagueKey: options.leagueKey ?? 'league1', provider: options.provider ?? ' Sleeper ', season: 2026,
    seasonType: 'reg', throughWeek: options.throughWeek ?? 1,
    provisionalWeek: options.provisionalWeek === undefined ? 1 : options.provisionalWeek,
    scorerVersion: 'sleeper-actual-v1',
    ...(options.asOf === undefined ? {} : { asOf: options.asOf }),
  }, scoreSparseStatistics);
  return { fake, result };
}

describe('all-player roster metrics', () => {
  it('ranks decimal ties at stored weekly precision without changing totals or PPG', async () => {
    const value = await read([metadata(),
      partial({ id: 'binary', position: 'RB', stats: { rush_yd: 35, rec: 0.5 } }),
      partial({ id: 'decimal', position: 'RB', stats: { rec: 4 } }),
      partial({ id: 'distinct', position: 'RB', stats: { rec: 4.0001 } }),
    ]).result;
    expect(value.metrics.map((metric) => [metric.providerExternalId, metric.positionRank]))
      .toEqual([['distinct', 1], ['binary', 2], ['decimal', 2]]);
    expect(value.metrics.find((metric) => metric.providerExternalId === 'distinct'))
      .toMatchObject({ totalFantasyPoints: 4.0001, pointsPerGame: 4.0001 });
  });

  it('rounds positive and negative halfway scores away from zero and excludes rounded zero from rank counts', async () => {
    const value = await read([metadata(),
      ...[['positive-half', 0.00005], ['positive-unit', 0.0001],
        ['negative-half', -0.00005], ['negative-unit', -0.0001],
        ['positive-zero', 0.00001], ['negative-zero', -0.00001]].map(([id, score]) =>
        partial({ id: String(id), position: 'WR', stats: { rec: Number(score) } })),
    ]).result;
    const ranks = Object.fromEntries(value.metrics.map((metric) => [metric.providerExternalId, metric.positionRank]));
    expect(ranks).toEqual({ 'positive-half': 1, 'positive-unit': 1,
      'negative-half': 3, 'negative-unit': 3, 'positive-zero': null, 'negative-zero': null });
    expect(value.metrics.find((metric) => metric.providerExternalId === 'negative-half'))
      .toMatchObject({ totalFantasyPoints: -0.00005, pointsPerGame: -0.00005 });
    expect(() => JSON.stringify(value)).not.toThrow();
  });

  it('sums independently rounded weekly scores just like published numeric scores', async () => {
    const value = await read([metadata({ published_week_count: 1, published_through_week: 1,
      published_observed_at: observedAt, partial_week: 3 }),
    published({ id: 'published-peer', position: 'WR', points: 0.0002, appearances: 1 }),
    partial({ id: 'partial-peer', position: 'WR', stats: { rec: 0.00006 }, week: 2 }),
    partial({ id: 'partial-peer', position: 'WR', stats: { rec: 0.00006 }, week: 3 }),
    ], { throughWeek: 3, provisionalWeek: 3 }).result;
    expect(value.metrics.map((metric) => [metric.providerExternalId, metric.positionRank]))
      .toEqual([['partial-peer', 1], ['published-peer', 1]]);
    expect(value.metrics.find((metric) => metric.providerExternalId === 'partial-peer'))
      .toMatchObject({ totalFantasyPoints: 0.00012, pointsPerGame: 0.00006 });
  });

  it('retains a nonzero summed weekly rank key when unrounded totals cancel', async () => {
    const value = await read([metadata({ partial_week: 3 }),
      partial({ id: 'rounded', position: 'WR', stats: { rec: 0.00006 }, week: 1 }),
      partial({ id: 'rounded', position: 'WR', stats: { rec: 0.00006 }, week: 2 }),
      partial({ id: 'rounded', position: 'WR', stats: { rec: -0.00012 }, week: 3 }),
      partial({ id: 'peer', position: 'WR', stats: { rec: -0.0001 }, week: 3 }),
    ], { throughWeek: 3, provisionalWeek: 3 }).result;
    expect(value.metrics).toEqual([
      expect.objectContaining({ providerExternalId: 'rounded', totalFantasyPoints: 0,
        pointsPerGame: null, positionRank: 1 }),
      expect.objectContaining({ providerExternalId: 'peer', positionRank: 2 }),
    ]);
  });

  it.each(['league1', 'league2'])('ranks the entire retained live scoring population for %s', async (leagueKey) => {
    const profile = actualRankFixture.profiles[0];
    // The capture retains two zero-participation controls in addition to the
    // real SQL candidates; replay only rows returned by the reader predicate.
    const candidates = actualRankFixture.entries.filter((entry) => entry.appearance_game_count === 1
      || Object.entries(entry.stats).some(([key, value]) => {
        const weight = (profile.rules as Readonly<Record<string, number>>)[key];
        return typeof value === 'number' && value !== 0 && typeof weight === 'number' && weight !== 0;
      }));
    const rows: DatabaseRow[] = [metadata({ scoring_profile_id: profile.id, rules: profile.rules,
      partial_observed_at: actualRankFixture.observation.observedAt,
      rank_unavailable_positions: actualRankFixture.observation.projectionRankUnavailablePositions,
    }), ...candidates.map((entry) => ({ ...entry, row_kind: 'partial',
      scoring_profile_id: profile.id, partial_week: actualRankFixture.period.week }))];
    const value = await read(rows, { leagueKey }).result;
    expect(actualRankFixture.entries).toHaveLength(323);
    expect(candidates).toHaveLength(321);
    expect(value).toMatchObject({ status: 'provisional', throughWeek: 1,
      observedAt: '2026-09-13T19:00:28.921Z', rowsRead: 322 });
    expect(value.metrics).toHaveLength(202);
    expect(value.metrics.every((metric) => metric.positionRank !== null)).toBe(true);
    expect(new Set(value.metrics.map((metric) => metric.position)))
      .toEqual(new Set(['QB', 'RB', 'WR', 'TE', 'K', 'DEF']));
    for (const [id, rank] of [['11280', 23], ['12048', 25], ['12732', 50]] as const) {
      expect(value.metrics.find((metric) => metric.providerExternalId === id))
        .toMatchObject({ scoringEntityId: null, positionRank: rank });
    }
    for (const [left, right, rank] of [['11576', '8228', 21], ['10219', '12474', 28],
      ['12969', '7567', 32], ['5967', '9757', 34]] as const) {
      for (const id of [left, right]) {
        expect(value.metrics.find((metric) => metric.providerExternalId === id))
          .toMatchObject({ position: 'RB', positionRank: rank });
      }
    }
    expect(value.metrics.find((metric) => metric.providerExternalId === '12732'))
      .toMatchObject({ totalFantasyPoints: 1.6, pointsPerGame: null, appearanceGameCount: 0 });
    expect(value.metrics.find((metric) => metric.providerExternalId === '5859'))
      .toMatchObject({ totalFantasyPoints: 4.1, pointsPerGame: 4.1, appearanceGameCount: 1, positionRank: 29 });
    expect(value.metrics.some((metric) => ['7527', '12529'].includes(metric.providerExternalId))).toBe(false);
  });

  it.each(['QB', 'RB', 'WR', 'TE', 'K'])('ranks absent-mapping %s players with mapped peers and valid negatives', async (metricPosition) => {
    const value = await read([metadata(),
      partial({ id: '990001', position: metricPosition, stats: { rec: 6 }, entityId: null }),
      partial({ id: 'mapped', position: metricPosition, stats: { rec: 4 } }),
      partial({ id: '990002', position: metricPosition, stats: { fum_lost: 1 }, entityId: null }),
      partial({ id: '990003', position: metricPosition, stats: { rec: 0 }, entityId: null }),
    ]).result;
    expect(value.metrics.map((metric) => [metric.providerExternalId, metric.scoringEntityId,
      metric.positionRank, metric.pointsPerGame])).toEqual([
      ['990001', null, 1, 6], ['mapped', 'entity-mapped', 2, 4], ['990002', null, 3, -2],
    ]);
  });

  it.each([
    { eligible: 1, appearance: 1, ppg: 4, denominator: 1 },
    { eligible: null, appearance: 1, ppg: null, denominator: 0 },
    { eligible: 1, appearance: null, ppg: null, denominator: 0 },
    { eligible: null, appearance: null, ppg: null, denominator: 0 },
  ])('keeps actual totals independent of unknown PPG participation (%j)', async ({ ppg, denominator, ...counts }) => {
    const value = await read([metadata(),
      partial({ id: '990004', position: 'WR', stats: { rec: 4 }, entityId: null, ...counts }),
      partial({ id: 'peer', position: 'WR', stats: { rec: 2 } }),
    ]).result;
    expect(value.metrics).toEqual(expect.arrayContaining([
      expect.objectContaining({ providerExternalId: '990004', totalFantasyPoints: 4,
        positionRank: 1, pointsPerGame: ppg, appearanceGameCount: denominator }),
      expect.objectContaining({ providerExternalId: 'peer', positionRank: 2, pointsPerGame: 2 }),
    ]));
  });

  it.each([0, 1])('keeps nonzero statistics with known zero appearances unavailable (eligible=%i)', async (eligible) => {
    const value = await read([metadata(),
      partial({ id: 'conflict', position: 'WR', stats: { rec: 4 }, eligible, appearance: 0 }),
      partial({ id: 'peer', position: 'WR', stats: { rec: 2 } }),
    ]).result;
    expect(value.metrics).toEqual([expect.objectContaining({ providerExternalId: 'peer', positionRank: null })]);
  });

  it('does not fall back to the source ID for a SQL-classified unusable mapping', async () => {
      const value = await read([metadata(),
        partial({ id: 'invalid', position: 'WR', stats: { rec: 4 }, entityId: null, mappingState: 'unusable' }),
        partial({ id: 'peer', position: 'WR', stats: { rec: 2 } }),
      ]).result;
      expect(value.metrics).toEqual([expect.objectContaining({ providerExternalId: 'peer', positionRank: null })]);
  });

  it('keeps canonical mapping mandatory for defenses and non-Sleeper sources', async () => {
    const defense = await read([metadata(),
      partial({ id: 'NE', position: 'DEF', kind: 'team_defense', stats: { sack: 2 }, entityId: null }),
      partial({ id: 'ATL', position: 'DEF', kind: 'team_defense', stats: { sack: 1 } }),
    ]).result;
    expect(defense.metrics).toEqual([expect.objectContaining({ providerExternalId: 'ATL', positionRank: null })]);
    const otherProvider = await read([metadata(),
      partial({ id: 'absent', position: 'WR', stats: { rec: 4 }, entityId: null }),
      partial({ id: 'peer', position: 'WR', stats: { rec: 2 } }),
    ], { provider: 'tank01' }).result;
    expect(otherProvider.metrics).toEqual([expect.objectContaining({ providerExternalId: 'peer', positionRank: null })]);
    await expect(read([metadata({ published_week_count: 1, published_through_week: 1,
      published_observed_at: observedAt, partial_week: null, partial_observed_at: null }),
    published({ id: 'published', position: 'WR', points: 4, appearances: 1, entityId: null }),
    ]).result).rejects.toThrow();
  });

  it.each([false, true])('combines source-only and mapped weeks without inventing canonical IDs (reverse=%s)', async (reverse) => {
    const rows = [
      partial({ id: '990005', position: 'WR', stats: { rec: 4 }, week: 1, entityId: null }),
      partial({ id: '990005', position: 'WR', stats: { rec: 8 }, week: 2 }),
    ];
    const value = await read([metadata({ partial_week: 2 }), ...(reverse ? rows.reverse() : rows)],
      { throughWeek: 2, provisionalWeek: 2 }).result;
    expect(value.metrics).toEqual([expect.objectContaining({ providerExternalId: '990005',
      scoringEntityId: 'entity-990005', totalFantasyPoints: 12, pointsPerGame: 6,
      appearanceGameCount: 2, positionRank: 1 })]);
  });

  it('rejects source-only duplicate periods and cross-period classification conflicts', async () => {
    const row = partial({ id: '990005', position: 'WR', stats: { rec: 4 }, entityId: null });
    await expect(read([metadata(), row, row]).result).rejects.toThrow('partial identity is duplicated');
    await expect(read([metadata({ partial_week: 2 }), row,
      partial({ id: '990005', position: 'RB', stats: { rush_yd: 10 }, week: 2 }),
    ], { throughWeek: 2, provisionalWeek: 2 }).result).rejects.toThrow('identities disagree across periods');
  });

  it('rejects cross-period classification conflicts before skipping an unusable mapping', async () => {
    await expect(read([metadata({ published_week_count: 1, published_through_week: 1,
      published_observed_at: observedAt, partial_week: 2 }),
    published({ id: 'subject', position: 'WR', points: 10, appearances: 1 }),
    published({ id: 'peer', position: 'WR', points: 5, appearances: 1 }),
    partial({ id: 'subject', position: 'RB', stats: { rec: 2 }, week: 2,
      entityId: null, mappingState: 'unusable' }),
    ], { throughWeek: 2, provisionalWeek: 2 }).result).rejects.toThrow('identities disagree across periods');
  });

  it.each(['not-an-official-id', '0', '01234'])('does not accept malformed source-only Sleeper ID %s', async (id) => {
    const value = await read([metadata(),
      partial({ id, position: 'WR', stats: { rec: 4 }, entityId: null }),
      partial({ id: 'peer', position: 'WR', stats: { rec: 2 } }),
    ]).result;
    expect(value.metrics).toEqual([expect.objectContaining({ providerExternalId: 'peer', positionRank: null })]);
  });

  it('rejects one official ID changing entity kind even when its later mapping is unusable', async () => {
    await expect(read([metadata({ partial_week: 2 }),
      partial({ id: '990005', position: 'WR', stats: { rec: 4 }, week: 1, entityId: null }),
      partial({ id: '990005', position: 'DEF', kind: 'team_defense', stats: { sack: 2 }, week: 2,
        entityId: null, mappingState: 'unusable' }),
    ], { throughWeek: 2, provisionalWeek: 2 }).result).rejects.toThrow('identity kinds disagree across periods');
  });

  it.each([2, -1, 0.5, 'malformed'])('rejects malformed participation counts (%s)', async (count) => {
    await expect(read([metadata(), { ...partial({ id: '990007', position: 'WR', stats: { rec: 4 }, entityId: null }),
      appearance_game_count: count }]).result).rejects.toThrow();
  });

  it('withholds a position when finite inputs overflow scoring rather than silently excluding its competitor', async () => {
    const value = await read([metadata({ rules: { rec: 2 } }),
      partial({ id: '990006', position: 'WR', stats: { rec: 1e308 }, entityId: null }),
      partial({ id: 'peer', position: 'WR', stats: { rec: 1 } }),
    ]).result;
    expect(value.metrics).toEqual([expect.objectContaining({ providerExternalId: 'peer', positionRank: null })]);
  });

  it('reads the Production-shaped two-game Week 1 fixture without returning empty inventory rows', async () => {
    expect(foundationFixture.games.filter((game) => game.phase === 'final')).toHaveLength(2);
    const scoringRules = foundationFixture.leagues[0].settings.scoring_settings;
    const fixtureRows: DatabaseRow[] = [metadata({
      rules: scoringRules,
      partial_observed_at: foundationFixture.replayObservedAt,
    })];
    for (const metricPosition of ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'] as const) {
      for (const identity of foundationFixture.catalogs[metricPosition]) {
        const providerExternalId = identity.id;
        const stats = foundationFixture.weekly[metricPosition === 'DEF'
          ? `TEAM_${providerExternalId}` : providerExternalId];
        if (!stats) continue;
        const score = scoreSparseStatistics(stats, scoringRules, SLEEPER_ALL_PLAYER_SCORING_RULE_KEYS);
        const appeared = stats.gp === 1 || (stats.off_snp ?? 0) > 0
          || (stats.def_snp ?? 0) > 0 || (stats.st_snp ?? 0) > 0;
        if (!score.available || score.points === null || (score.points === 0 && !appeared)) continue;
        fixtureRows.push(partial({
          id: providerExternalId,
          position: metricPosition,
          kind: metricPosition === 'DEF' ? 'team_defense' : 'player',
          stats,
          appearance: appeared ? 1 : null,
          eligible: appeared ? 1 : null,
        }));
      }
    }
    const value = await read(fixtureRows).result;
    const brown = value.metrics.find((metric) => metric.providerExternalId === '5859');
    expect(value).toMatchObject({
      status: 'provisional', throughWeek: 1, observedAt: foundationFixture.replayObservedAt,
      rowsRead: fixtureRows.length,
    });
    expect(fixtureRows.length).toBeLessThan(200);
    expect(brown).toMatchObject({
      position: 'WR', totalFantasyPoints: 4.1, appearanceGameCount: 1, pointsPerGame: 4.1,
    });
    expect(brown?.positionRank).toBe(9);
    expect(value.metrics.some((metric) => metric.providerExternalId === '7527')).toBe(false);
    expect(value.metrics.some((metric) => metric.providerExternalId === '12529')).toBe(false);
    expect(new Set(value.metrics.map((metric) => metric.position)))
      .toEqual(new Set(['QB', 'RB', 'WR', 'TE', 'K', 'DEF']));
    const rostered = new Set(foundationFixture.leagues.flatMap((league) => league.rosters
      .flatMap((roster) => roster.players)));
    expect(value.metrics.some((metric) => !rostered.has(metric.providerExternalId))).toBe(true);
  });

  it('derives provisional ranks and PPG from partial Week 1 without waiting for completion', async () => {
    const { fake, result } = read([
      metadata(),
      partial({ id: '5859', position: 'WR', stats: { rec: 3, rec_yd: 11 } }),
      partial({ id: 'unrostered-wr', position: 'WR', stats: { rec: 2, rec_yd: 25 } }),
    ]);
    await expect(result).resolves.toMatchObject({
      status: 'provisional', observedAt, throughWeek: 1, rowsRead: 3,
      metrics: expect.arrayContaining([
        expect.objectContaining({ providerExternalId: '5859', positionRank: 2, pointsPerGame: 4.1 }),
        expect.objectContaining({ providerExternalId: 'unrostered-wr', positionRank: 1, pointsPerGame: 4.5 }),
      ]),
    });
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].parameters).toEqual([
      'league1', 'sleeper', 2026, 'reg', 1, 'sleeper-actual-v1', 1, null,
    ]);
    expect(fake.calls[0].statement).toContain("observation.quality = 'partial'");
    expect(fake.calls[0].statement).toContain('SELECT DISTINCT ON (observation.week)');
    expect(fake.calls[0].statement).toContain('ORDER BY observation.week, observation.observed_at DESC');
    expect(fake.calls[0].statement).toContain('observation.week <= $5::smallint');
    expect(fake.calls[0].statement).toContain('NOT EXISTS');
    expect(fake.calls[0].statement).toContain('score.fantasy_points <> 0 OR score.appearance_game_count = 1');
    expect(fake.calls[0].statement).not.toContain("score.entity_kind = 'player'");
  });

  it('uses standard competition ranks, exact totals, deterministic tie ordering, and keeps negatives rankable', async () => {
    const { result } = read([
      metadata({ published_week_count: 1, published_through_week: 1, published_observed_at: observedAt,
        partial_week: null, partial_observed_at: null }),
      published({ id: 'winner', position: 'WR', points: 20, appearances: 1 }),
      published({ id: 'tie-z', position: 'WR', points: 10, appearances: 1 }),
      published({ id: 'tie-a', position: 'WR', points: 10, appearances: 1 }),
      published({ id: 'negative', position: 'WR', points: -2, appearances: 1 }),
      published({ id: 'zero', position: 'WR', points: 0, appearances: 1 }),
    ], { provisionalWeek: null });
    const value = await result;
    expect(value.status).toBe('published');
    expect(value.metrics.filter((metric) => metric.position === 'WR').map((metric) => ({
      id: metric.providerExternalId, rank: metric.positionRank, ppg: metric.pointsPerGame,
    }))).toEqual([
      { id: 'winner', rank: 1, ppg: 20 },
      { id: 'tie-a', rank: 2, ppg: 10 },
      { id: 'tie-z', rank: 2, ppg: 10 },
      { id: 'negative', rank: 4, ppg: -2 },
    ]);
  });

  it('ranks QB, RB, WR, TE, K, and team defense populations independently', async () => {
    const { result } = read([
      metadata(),
      partial({ id: 'qb', position: 'QB', stats: { pass_yd: 25 } }),
      partial({ id: 'rb', position: 'RB', stats: { rush_yd: 10 } }),
      partial({ id: 'wr', position: 'WR', stats: { rec_yd: 10 } }),
      partial({ id: 'te', position: 'TE', stats: { rec: 1 } }),
      partial({ id: 'k', position: 'K', stats: { fgm: 1 } }),
      partial({ id: 'PHI', position: 'DEF', kind: 'team_defense', stats: { sack: 1 } }),
    ]);
    const value = await result;
    expect(value.metrics.map((metric) => [metric.position, metric.positionRank]))
      .toEqual([['DEF', 1], ['K', 1], ['QB', 1], ['RB', 1], ['TE', 1], ['WR', 1]]);
  });

  it('withholds zero, conflicting participation, and missing identity evidence while preserving unknown PPG semantics', async () => {
    const { result } = read([
      metadata({ published_week_count: 1, published_through_week: 1, published_observed_at: observedAt,
        partial_week: 2, partial_observed_at: observedAt }),
      published({ id: 'known', position: 'WR', points: 10, appearances: 1 }),
      partial({ id: 'known', position: 'WR', stats: { rec: 5 }, appearance: null, eligible: null, week: 2 }),
      partial({ id: 'zero', position: 'WR', stats: { rec: 0 }, week: 2 }),
      partial({ id: 'conflict', position: 'WR', stats: { rec: 2 }, appearance: 0, eligible: 0, week: 2 }),
      partial({ id: 'malformed', position: 'WR', stats: { rec: 'not-a-number' }, week: 2 }),
    ], { throughWeek: 2, provisionalWeek: 2 });
    const value = await result;
    expect(value.metrics.find((metric) => metric.providerExternalId === 'known')).toMatchObject({
      totalFantasyPoints: 15, appearanceGameCount: 1, pointsPerGame: 10,
    });
    expect(value.metrics.some((metric) => ['zero', 'conflict', 'malformed']
      .includes(metric.providerExternalId))).toBe(false);
  });

  it('combines completed totals with a current partial week exactly once', async () => {
    const { result } = read([
      metadata({ published_week_count: 1, published_through_week: 1,
        published_observed_at: '2026-09-08T03:00:00.000Z', partial_week: 2 }),
      published({ id: 'combo', position: 'RB', points: 7, appearances: 1 }),
      partial({ id: 'combo', position: 'RB', stats: { rush_yd: 30 }, week: 2 }),
    ], { throughWeek: 2, provisionalWeek: 2 });
    await expect(result).resolves.toMatchObject({
      status: 'provisional', throughWeek: 2,
      metrics: [expect.objectContaining({
        providerExternalId: 'combo', totalFantasyPoints: 10,
        appearanceGameCount: 2, pointsPerGame: 5,
      })],
    });
  });

  it('carries each earlier partial week into season PPG when the active week advances', async () => {
    const value = await read([
      metadata({ partial_week: 2 }),
      partial({ id: 'carry', position: 'WR', stats: { rec: 4 }, week: 1 }),
      partial({ id: 'carry', position: 'WR', stats: { rec: 8 }, week: 2 }),
    ], { throughWeek: 2, provisionalWeek: 2 }).result;
    expect(value).toMatchObject({ status: 'provisional', throughWeek: 2,
      metrics: [expect.objectContaining({ totalFantasyPoints: 12,
        appearanceGameCount: 2, pointsPerGame: 6, positionRank: 1, publishedWeekCount: 0 })] });
  });

  it('retains a historical partial when the requested week has no active provisional overlay', async () => {
    const { fake, result } = read([
      metadata(), partial({ id: 'past', position: 'WR', stats: { rec: 4 }, week: 1 }),
    ], { throughWeek: 1, provisionalWeek: null });
    await expect(result).resolves.toMatchObject({ status: 'provisional', throughWeek: 1,
      metrics: [expect.objectContaining({ pointsPerGame: 4, appearanceGameCount: 1 })] });
    expect(fake.calls[0].parameters[6]).toBeNull();
    expect(fake.calls[0].statement).not.toContain('WHERE $7::smallint IS NOT NULL');
  });

  it('keeps the latest covered week when an older partial correction follows newer publication', async () => {
    const value = await read([
      metadata({ published_week_count: 1, published_through_week: 2,
        published_observed_at: '2026-09-11T03:00:00.000Z' }),
      published({ id: 'carry', position: 'WR', points: 8, appearances: 1 }),
      partial({ id: 'carry', position: 'WR', stats: { rec: 4 }, week: 1 }),
    ], { throughWeek: 2, provisionalWeek: null }).result;
    expect(value).toMatchObject({ status: 'provisional', throughWeek: 2, observedAt,
      metrics: [expect.objectContaining({ totalFantasyPoints: 12,
        pointsPerGame: 6, publishedWeekCount: 1 })] });
  });

  it.each(['partial', 'published'] as const)(
    'withholds every positional rank when an entire prior week is missing before %s data', async (kind) => {
      const value = await read([
        metadata({ missing_prior_week_count: 1,
          ...(kind === 'partial' ? { partial_week: 2 } : {
            partial_week: null, partial_observed_at: null, published_week_count: 1,
            published_through_week: 2, published_observed_at: observedAt,
          }) }),
        ...(kind === 'partial' ? [
          partial({ id: 'known', position: 'WR', stats: { rec: 4 }, week: 2 }),
          partial({ id: 'other', position: 'RB', stats: { rush_yd: 20 }, week: 2 }),
        ] : [
          published({ id: 'known', position: 'WR', points: 4, appearances: 1 }),
          published({ id: 'other', position: 'RB', points: 2, appearances: 1 }),
        ]),
      ], { throughWeek: 2, provisionalWeek: 2 }).result;
      expect(value).toMatchObject({ status: 'provisional', throughWeek: 2 });
      expect(value.metrics).toHaveLength(2);
      expect(value.metrics.every((metric) => metric.positionRank === null)).toBe(true);
      expect(value.metrics.find((metric) => metric.providerExternalId === 'known'))
        .toMatchObject({ totalFantasyPoints: 4, appearanceGameCount: 1, pointsPerGame: 4 });
    },
  );

  it('marks retained published metrics provisional when a captured partial has no scoreable rows', async () => {
    const value = await read([
      metadata({ published_week_count: 1, published_through_week: 1,
        published_observed_at: observedAt, partial_week: 2 }),
      published({ id: 'known', position: 'WR', points: 4, appearances: 1 }),
    ], { throughWeek: 2, provisionalWeek: 2 }).result;
    expect(value).toMatchObject({ status: 'provisional', throughWeek: 2 });
  });

  it.each([
    { stats: { rec: 0 }, appearance: 0, eligible: 0, expectedCount: 1 },
    { stats: { rec: 0 }, appearance: 1, eligible: 1, expectedCount: 2 },
    { stats: { gp: 1 }, appearance: 1, eligible: 1, expectedCount: 2 },
  ])('preserves prior partial points with a later zero record (%j)', async (scenario) => {
    const value = await read([
      metadata({ partial_week: 2 }),
      partial({ id: 'carry', position: 'WR', stats: { rec: 4 }, week: 1 }),
      partial({ id: 'carry', position: 'WR', week: 2, ...scenario }),
    ], { throughWeek: 2, provisionalWeek: 2 }).result;
    expect(value.metrics).toEqual([expect.objectContaining({ totalFantasyPoints: 4,
      appearanceGameCount: scenario.expectedCount, pointsPerGame: 4 / scenario.expectedCount })]);
  });

  it('rejects conflicting canonical identities across partial weeks even for a zero record', async () => {
    await expect(read([
      metadata({ partial_week: 2 }),
      partial({ id: 'carry', position: 'WR', stats: { rec: 4 }, week: 1 }),
      partial({ id: 'carry', entityId: 'different', position: 'WR', stats: { rec: 0 }, week: 2 }),
    ], { throughWeek: 2, provisionalWeek: 2 }).result).rejects.toThrow('identities disagree across periods');
  });

  it.each([
    { stats: { rec: 2 }, appearance: 0, eligible: 0 },
    { stats: { rec: 'malformed' }, appearance: 1, eligible: 1 },
  ])('retains known prior contributions when a later period is unusable (%j)', async (scenario) => {
    const value = await read([
      metadata({ partial_week: 2 }),
      partial({ id: 'carry', position: 'WR', stats: { rec: 4 }, week: 1 }),
      partial({ id: 'peer', position: 'WR', stats: { rec: 2 }, week: 1 }),
      partial({ id: 'carry', position: 'WR', week: 2, ...scenario }),
    ], { throughWeek: 2, provisionalWeek: 2 }).result;
    expect(value).toMatchObject({ status: 'provisional', throughWeek: 2 });
    expect(value.metrics).toEqual(expect.arrayContaining([
      expect.objectContaining({ providerExternalId: 'carry', totalFantasyPoints: 4,
        appearanceGameCount: 1, pointsPerGame: 4, positionRank: null }),
      expect.objectContaining({ providerExternalId: 'peer', positionRank: null }),
    ]));
  });

  it.each([{ gp: 1 }, { rec: 0 }, { rec: 2, fum_lost: 1 }])(
    'includes a confirmed zero-point current appearance in cumulative PPG (%j)', async (stats) => {
      const value = await read([
        metadata({ published_week_count: 1, published_through_week: 1,
          published_observed_at: observedAt, partial_week: 2 }),
        published({ id: 'played-zero', position: 'WR', points: 10, appearances: 1 }),
        partial({ id: 'played-zero', position: 'WR', stats, week: 2 }),
      ], { throughWeek: 2, provisionalWeek: 2 }).result;
      expect(value).toMatchObject({ status: 'provisional', throughWeek: 2,
        metrics: [expect.objectContaining({ totalFantasyPoints: 10,
          appearanceGameCount: 2, pointsPerGame: 5 })] });
    },
  );

  it('retains prior appearances when earlier published points cancel to zero', async () => {
    const value = await read([
      metadata({ published_week_count: 2, published_through_week: 2,
        published_observed_at: observedAt, partial_week: 3 }),
      published({ id: 'cancelled', position: 'WR', points: 0, appearances: 2 }),
      partial({ id: 'cancelled', position: 'WR', stats: { rec: 6 }, week: 3 }),
    ], { throughWeek: 3, provisionalWeek: 3 }).result;
    expect(value.metrics).toEqual([expect.objectContaining({ totalFantasyPoints: 6,
      appearanceGameCount: 3, pointsPerGame: 2 })]);
  });

  it('does not use legacy projection coverage to suppress actual-stat ranks', async () => {
    const value = await read([
      metadata({ rank_unavailable_positions: ['RB'] }),
      partial({ id: 'rb', position: 'RB', stats: { rush_yd: 20 } }),
      partial({ id: 'wr', position: 'WR', stats: { rec: 4 } }),
    ]).result;
    expect(value.metrics).toEqual(expect.arrayContaining([
      expect.objectContaining({ providerExternalId: 'rb', positionRank: 1, pointsPerGame: 2 }),
      expect.objectContaining({ providerExternalId: 'wr', positionRank: 1, pointsPerGame: 4 }),
    ]));
  });

  it('withholds the affected position rank if a scoring row has no usable mapping', async () => {
    const value = await read([
      metadata(),
      { ...partial({ id: 'unmapped', position: 'WR', stats: { rec: 6 } }), scoring_entity_id: null },
      partial({ id: 'wr', position: 'WR', stats: { rec: 4 } }),
    ]).result;
    expect(value.metrics).toEqual([
      expect.objectContaining({ providerExternalId: 'wr', positionRank: null, pointsPerGame: 4 }),
    ]);
  });

  it('rejects distinct official identities sharing a canonical target across history and partial data', async () => {
    await expect(read([
      metadata({ published_week_count: 1, published_through_week: 1,
        published_observed_at: observedAt, partial_week: 2 }),
      published({ id: 'old-id', position: 'WR', points: 2, appearances: 1, entityId: 'same-entity' }),
      partial({ id: 'new-id', position: 'WR', stats: { rec: 6 }, entityId: 'same-entity', week: 2 }),
    ], { throughWeek: 2, provisionalWeek: 2 }).result).rejects.toThrow('share one canonical target');
  });

  it('rejects duplicate partial rows before counting their appearances twice', async () => {
    const row = partial({ id: 'duplicate', position: 'WR', stats: { rec: 6 } });
    await expect(read([metadata(), row, row]).result).rejects.toThrow('partial identity is duplicated');
  });

  it('calculates each league independently from its exact scoring profile', async () => {
    const rowsFor = (scoringRules: DatabaseRow['rules']) => [
      metadata({ rules: scoringRules }),
      partial({ id: 'catcher', position: 'WR', stats: { rec: 1 } }),
      partial({ id: 'yardage', position: 'WR', stats: { rec_yd: 15 } }),
    ];
    const leagueOne = await read(rowsFor({ rec: 1, rec_yd: 0.1 }), { leagueKey: 'league1' }).result;
    const leagueTwo = await read(rowsFor({ rec: 2, rec_yd: 0.1 }), { leagueKey: 'league2' }).result;
    expect(leagueOne.metrics.find((metric) => metric.providerExternalId === 'yardage')?.positionRank).toBe(1);
    expect(leagueTwo.metrics.find((metric) => metric.providerExternalId === 'catcher')?.positionRank).toBe(1);
  });

  it('fails softly at the read model boundary when no scoring profile is available', async () => {
    await expect(read([]).result).resolves.toEqual({
      status: 'unavailable', observedAt: null, throughWeek: null, rowsRead: 0, metrics: [],
    });
  });

  it('uses a fixed cutoff for provisional display statistics without claiming complete publication', async () => {
    const asOf = '2026-09-15T08:00:00.000Z';
    const { result, fake } = read([metadata(),
      partial({ id: '5859', position: 'WR', stats: { rec: 3, rec_yd: 11 } }),
    ], { asOf, provisionalWeek: null });
    expect(await result).toMatchObject({ status: 'provisional', throughWeek: 1,
      metrics: [expect.objectContaining({ providerExternalId: '5859', pointsPerGame: 4.1, positionRank: 1 })] });
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].parameters).toEqual([
      'league1', 'sleeper', 2026, 'reg', 1, 'sleeper-actual-v1', null, asOf,
    ]);
  });

  it.each(['', '2026-09-15', '2026-09-15T04:00:00-04:00', '2026-02-30T08:00:00.000Z',
    'not-a-time', '2026-09-15T08:00:00Z'])('rejects a noncanonical metric cutoff before SQL (%s)', async (asOf) => {
    const { result, fake } = read([], { asOf });
    await expect(result).rejects.toThrow('cutoff must be a canonical UTC timestamp');
    expect(fake.calls).toHaveLength(0);
  });

  it('rejects invalid temporal bounds before database work', async () => {
    const fake = createFakeProjectionDatabase();
    const reader = createAllPlayerMetricMethods(fake.database);
    await expect(reader.readAllPlayerPlayerMetrics({
      leagueKey: 'league1', provider: 'sleeper', season: 2026, seasonType: 'reg',
      throughWeek: 0, provisionalWeek: null, scorerVersion: 'sleeper-actual-v1',
    }, scoreSparseStatistics)).rejects.toThrow('through week is invalid');
    await expect(reader.readAllPlayerPlayerMetrics({
      leagueKey: 'league1', provider: 'sleeper', season: 2026, seasonType: 'reg',
      throughWeek: 1, provisionalWeek: 2, scorerVersion: 'sleeper-actual-v1',
    }, scoreSparseStatistics)).rejects.toThrow('exceeds the through-week boundary');
    expect(fake.calls).toHaveLength(0);
  });
});
