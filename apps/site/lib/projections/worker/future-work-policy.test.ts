import { describe, expect, it } from 'vitest';
import type { LeaguePeriodAuthority } from '../domain/contracts';
import { externalLeagueRef } from '../shared/provider-identity';
import {
  futurePeriodsForAuthorities,
  futureRefreshIntervalMs,
  futureRetryDelayMs,
  futureWorkMayStart,
  initialFutureRefreshAt,
  selectFutureWork,
  type FutureRefreshPlan,
} from './future-work-policy';

const HOUR_MS = 60 * 60 * 1_000;

function authority(
  key: string,
  overrides: Partial<LeaguePeriodAuthority> = {},
): LeaguePeriodAuthority {
  const configuration = {
    key,
    displayName: key,
    leagueRef: externalLeagueRef('sleeper', key),
  };
  return {
    configuration,
    defaultDisplayPeriod: { season: 2026, seasonType: 'regular', week: 1 },
    activeScoringPeriod: { season: 2026, seasonType: 'regular', week: 1 },
    lifecycle: 'active',
    nflPhase: 'regular',
    source: configuration.leagueRef.provider,
    sourceRevision: 'revision',
    observedAt: '2026-09-03T12:00:00.000Z',
    verifiedAt: '2026-09-03T12:00:00.000Z',
    ...overrides,
  };
}

function plan(
  week: number,
  overrides: Partial<FutureRefreshPlan> = {},
): FutureRefreshPlan {
  return {
    period: { season: 2026, seasonType: 'regular', week },
    projectionNextRefreshAt: '2026-09-03T11:00:00.000Z',
    projectionLastSucceededAt: '2026-09-03T10:00:00.000Z',
    projectionConsecutiveFailures: 0,
    currentProjectionSlateContentId: `content-${week}`,
    materializations: ['league1', 'league2'].map((leagueKey) => ({
      leagueKey,
      nextRefreshAt: '2026-09-03T11:00:00.000Z',
      lastSucceededAt: '2026-09-03T10:00:00.000Z',
      lastProjectionSlateContentId: `content-${week}`,
      consecutiveFailures: 0,
    })),
    ...overrides,
  };
}

describe('future work policy', () => {
  it('enumerates Week 2 through Week 18 from a shared active Week 1 authority', () => {
    const periods = futurePeriodsForAuthorities(
      [authority('league1'), authority('league2')],
      ['league1', 'league2'],
    );
    expect(periods).not.toBeNull();
    expect(periods?.[0]).toEqual({ season: 2026, seasonType: 'regular', week: 2 });
    expect(periods?.at(-1)?.week).toBe(18);
    expect(periods).toHaveLength(17);
  });

  it('keeps the displayed next week in the horizon while the prior week is active', () => {
    const overrides = {
      defaultDisplayPeriod: { season: 2026, seasonType: 'regular' as const, week: 2 },
    };
    expect(futurePeriodsForAuthorities([
      authority('league1', overrides), authority('league2', overrides),
    ], ['league1', 'league2'])?.[0].week).toBe(2);
  });

  it('includes Week 1 during preseason and stops after completion or Week 18', () => {
    const preseason = {
      lifecycle: 'preseason' as const,
      activeScoringPeriod: null,
      nflPhase: 'preseason' as const,
    };
    expect(futurePeriodsForAuthorities([
      authority('league1', preseason), authority('league2', preseason),
    ], ['league1', 'league2'])?.[0].week).toBe(1);
    expect(futurePeriodsForAuthorities([
      authority('league1', { lifecycle: 'complete', activeScoringPeriod: null }),
      authority('league2', { lifecycle: 'complete', activeScoringPeriod: null }),
    ], ['league1', 'league2'])).toEqual([]);
    expect(futurePeriodsForAuthorities([
      authority('league1', {
        defaultDisplayPeriod: { season: 2026, seasonType: 'regular', week: 18 },
        activeScoringPeriod: { season: 2026, seasonType: 'regular', week: 18 },
      }),
      authority('league2', {
        defaultDisplayPeriod: { season: 2026, seasonType: 'regular', week: 18 },
        activeScoringPeriod: { season: 2026, seasonType: 'regular', week: 18 },
      }),
    ], ['league1', 'league2'])).toEqual([]);
  });

  it('fails closed for missing, duplicate, or conflicting league authorities', () => {
    expect(futurePeriodsForAuthorities([authority('league1')], ['league1', 'league2']))
      .toBeNull();
    expect(futurePeriodsForAuthorities(
      [authority('league1'), authority('league1')],
      ['league1', 'league2'],
    )).toBeNull();
    expect(futurePeriodsForAuthorities([
      authority('league1'),
      authority('league2', {
        activeScoringPeriod: { season: 2026, seasonType: 'regular', week: 2 },
      }),
    ], ['league1', 'league2'])).toBeNull();
  });

  it('uses the approved refresh and retry tiers', () => {
    expect(futureRefreshIntervalMs('projection', 1)).toBe(6 * HOUR_MS);
    expect(futureRefreshIntervalMs('materialization', 1)).toBe(HOUR_MS);
    expect(futureRefreshIntervalMs('projection', 4)).toBe(24 * HOUR_MS);
    expect(futureRefreshIntervalMs('materialization', 5)).toBe(7 * 24 * HOUR_MS);
    expect(futureRetryDelayMs(1)).toBe(5 * 60 * 1_000);
    expect(futureRetryDelayMs(2)).toBe(15 * 60 * 1_000);
    expect(futureRetryDelayMs(3)).toBe(HOUR_MS);
    expect(futureRetryDelayMs(50)).toBe(6 * HOUR_MS);
  });

  it('stagger-seeds later periods and enforces the start deadline', () => {
    const seed = new Date('2026-09-03T12:00:00.000Z');
    expect(initialFutureRefreshAt(seed, 1)).toBe(seed.toISOString());
    expect(initialFutureRefreshAt(seed, 3)).toBe('2026-09-03T12:30:00.000Z');
    expect(futureWorkMayStart(1_000, 45_999)).toBe(true);
    expect(futureWorkMayStart(1_000, 46_000)).toBe(false);
  });

  it('ingests the canary before it can materialize and blocks later periods', () => {
    const periods = [
      { season: 2026, seasonType: 'regular' as const, week: 2 },
      { season: 2026, seasonType: 'regular' as const, week: 3 },
    ];
    const canary = plan(2, {
      currentProjectionSlateContentId: null,
      projectionLastSucceededAt: null,
      materializations: plan(2).materializations.map((state) => ({
        ...state, lastSucceededAt: null, lastProjectionSlateContentId: null,
      })),
    });
    expect(selectFutureWork([canary, plan(3)], periods, ['league1', 'league2'],
      new Date('2026-09-03T12:00:00.000Z'))).toEqual({
      kind: 'projection-ingest', period: periods[0], weekDistance: 1,
    });
  });

  it('materializes from the stored canary with no projection refresh due', () => {
    const periods = [{ season: 2026, seasonType: 'regular' as const, week: 2 }];
    const candidate = plan(2, {
      projectionNextRefreshAt: '2026-09-03T18:00:00.000Z',
      materializations: plan(2).materializations.map((state) => ({
        ...state, lastSucceededAt: null, lastProjectionSlateContentId: null,
      })),
    });
    expect(selectFutureWork([candidate], periods, ['league1', 'league2'],
      new Date('2026-09-03T12:00:00.000Z'))?.kind).toBe('materialize');
  });

  it('uses content identity, not observation identity, to force rematerialization', () => {
    const periods = [{ season: 2026, seasonType: 'regular' as const, week: 2 }];
    const upToDate = plan(2, {
      projectionNextRefreshAt: '2026-09-03T18:00:00.000Z',
      materializations: plan(2).materializations.map((state) => ({
        ...state, nextRefreshAt: '2026-09-03T18:00:00.000Z',
      })),
    });
    expect(selectFutureWork([upToDate], periods, ['league1', 'league2'],
      new Date('2026-09-03T12:00:00.000Z'))).toBeNull();
    const changed = {
      ...upToDate,
      currentProjectionSlateContentId: 'changed-content',
    };
    expect(selectFutureWork([changed], periods, ['league1', 'league2'],
      new Date('2026-09-03T12:00:00.000Z'))?.kind).toBe('materialize');
  });

  it('opens later periods only after every current league completes the canary', () => {
    const periods = [
      { season: 2026, seasonType: 'regular' as const, week: 2 },
      { season: 2026, seasonType: 'regular' as const, week: 3 },
    ];
    const waiting = plan(2, {
      projectionNextRefreshAt: '2026-09-03T18:00:00.000Z',
      materializations: plan(2).materializations.map((state, index) => ({
        ...state,
        nextRefreshAt: '2026-09-03T18:00:00.000Z',
        lastSucceededAt: index === 0 ? state.lastSucceededAt : null,
      })),
    });
    expect(selectFutureWork([waiting, plan(3)], periods, ['league1', 'league2'],
      new Date('2026-09-03T12:00:00.000Z'))).toBeNull();
    expect(selectFutureWork([plan(2, {
      projectionNextRefreshAt: '2026-09-03T18:00:00.000Z',
      materializations: plan(2).materializations.map((state) => ({
        ...state, nextRefreshAt: '2026-09-03T18:00:00.000Z',
      })),
    }), plan(3)], periods, ['league1', 'league2'],
    new Date('2026-09-03T12:00:00.000Z'))?.period.week).toBe(3);
  });

  it('fails closed if the durable plan does not exactly match the live registry', () => {
    const periods = [{ season: 2026, seasonType: 'regular' as const, week: 2 }];
    expect(selectFutureWork([plan(2, {
      materializations: plan(2).materializations.slice(0, 1),
    })], periods, ['league1', 'league2'], new Date())).toBeNull();
  });
});
