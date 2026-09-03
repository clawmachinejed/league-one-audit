import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createProjectionStore, type ProjectionStore } from '../lib/projection-store';
import { createIndependentDatabase, ownerQuery, type IndependentDatabase } from './neon-integration-harness';

describe.sequential('heterogeneous future distances in isolated Neon', () => {
  let database: IndependentDatabase;
  let store: ProjectionStore;
  const period = { season: 2026, seasonType: 'reg' as const, week: 6 };
  const base = { projectionProvider: 'tank01', normalizerVersion: 'distance-integration-v1', modelVersion: 'clock-v1' };
  const seededAt = '2026-09-03T12:00:00.000Z';
  beforeAll(() => { database = createIndependentDatabase(); store = createProjectionStore(database.database); });
  afterAll(async () => { await database.close(); });

  it('shares the closest provider tier while preserving each league tier, seed and rollover', async () => {
    for (const [leagueKey, activeWeek] of [['distance-far', 1], ['distance-near', 5]] as const) {
      expect(await store.upsertLeaguePeriodAuthority({ leagueKey, defaultSeason: 2026, defaultSeasonType: 'reg',
        defaultWeek: activeWeek, activeSeason: 2026, activeSeasonType: 'reg', activeWeek,
        leagueLifecycle: 'active', nflPhase: 'regular', sourceProvider: 'sleeper', sourceRevision: leagueKey,
        sourceObservedAt: seededAt, verifiedAt: seededAt })).toMatchObject({ kind: 'stored' });
    }
    for (const [leagueKey, weekDistance] of [['distance-far', 5], ['distance-near', 1]] as const) {
      expect(await store.ensureFutureRefreshStates({ ...base, targets: [{ period, weekDistance, projectionWeekDistance: 1 }],
        leagueKeys: [leagueKey], seededAt })).toMatchObject({ kind: 'stored' });
      const plan = await store.readFutureRefreshPlan({ ...base, targets: [{ period, weekDistance, projectionWeekDistance: 1 }],
        leagueKeys: [leagueKey], asOf: seededAt });
      expect(plan).toMatchObject([{ weekDistance: 1, projection: { due: true },
        materializations: [{ leagueKey, due: weekDistance === 1 }] }]);
    }
    const rows = await ownerQuery<{ league_key: string; week_distance: number; next_refresh_at: string }>(
      `SELECT league_key, week_distance, next_refresh_at::text FROM league_week_materialization_states
       WHERE normalizer_version = $1 ORDER BY league_key`, [base.normalizerVersion]);
    expect(rows.map((row) => [row.league_key, row.week_distance, new Date(row.next_refresh_at).toISOString()]))
      .toEqual([['distance-far', 5, '2026-09-03T13:00:00.000Z'], ['distance-near', 1, seededAt]]);
    const projection = await ownerQuery<{ week_distance: number }>(
      'SELECT week_distance FROM projection_period_refresh_states WHERE normalizer_version = $1', [base.normalizerVersion]);
    expect(projection).toEqual([{ week_distance: 1 }]);
    expect(await store.ensureFutureRefreshStates({ ...base, targets: [{ period, weekDistance: 4, projectionWeekDistance: 1 }],
      leagueKeys: ['distance-far'], seededAt })).toMatchObject({ kind: 'stored' });
    const rolled = await store.readFutureRefreshPlan({ ...base, targets: [{ period, weekDistance: 4, projectionWeekDistance: 1 }],
      leagueKeys: ['distance-far'], asOf: seededAt });
    expect(rolled).toMatchObject([{ weekDistance: 1, materializations: [{ leagueKey: 'distance-far', due: true }] }]);
  });
});
