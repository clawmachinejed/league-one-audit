import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import type { DatabaseRow } from '../../../database';
import { createFakeProjectionDatabase } from '../../../projection-store-test-support';
import { foundationFixture } from '../../../../test-support/all-player-foundation-fixture';
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
  kind?: 'player' | 'team_defense'; entityId?: string;
}>): DatabaseRow {
  return {
    row_kind: 'published', scoring_profile_id: profileId,
    scoring_entity_id: input.entityId ?? `entity-${input.id}`,
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
  kind?: 'player' | 'team_defense'; entityId?: string;
}>): DatabaseRow {
  return {
    row_kind: 'partial', scoring_profile_id: profileId,
    scoring_entity_id: input.entityId ?? `entity-${input.id}`,
    provider_external_id: input.id, entity_kind: input.kind ?? 'player', position: input.position,
    stats: input.stats,
    partial_week: input.week ?? 1,
    appearance_game_count: input.appearance === undefined ? 1 : input.appearance,
    eligible_game_count: input.eligible === undefined ? 1 : input.eligible,
  };
}

function read(rows: readonly DatabaseRow[], options: {
  leagueKey?: string; throughWeek?: number; provisionalWeek?: number | null;
} = {}) {
  const fake = createFakeProjectionDatabase(() => rows);
  const result = createAllPlayerMetricMethods(fake.database).readAllPlayerPlayerMetrics({
    leagueKey: options.leagueKey ?? 'league1', provider: ' Sleeper ', season: 2026,
    seasonType: 'reg', throughWeek: options.throughWeek ?? 1,
    provisionalWeek: options.provisionalWeek === undefined ? 1 : options.provisionalWeek,
    scorerVersion: 'sleeper-actual-v1',
  }, scoreSparseStatistics);
  return { fake, result };
}

describe('all-player roster metrics', () => {
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
      'league1', 'sleeper', 2026, 'reg', 1, 'sleeper-actual-v1', 1,
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

  it('withholds ranks for stored identity gaps while retaining confirmed PPG', async () => {
    const value = await read([
      metadata({ rank_unavailable_positions: ['RB'] }),
      partial({ id: 'rb', position: 'RB', stats: { rush_yd: 20 } }),
      partial({ id: 'wr', position: 'WR', stats: { rec: 4 } }),
    ]).result;
    expect(value.metrics).toEqual(expect.arrayContaining([
      expect.objectContaining({ providerExternalId: 'rb', positionRank: null, pointsPerGame: 2 }),
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
