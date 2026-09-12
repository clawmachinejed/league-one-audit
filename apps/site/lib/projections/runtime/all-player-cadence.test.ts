import { describe, expect, it } from 'vitest';
import type { AllPlayerJobState, StoredLeagueAuthorityRead } from '../adapters/neon/contracts';
import { isAllPlayerPollingOpportunity, selectAllPlayerRecurringPeriod } from './all-player-cadence';

const now = new Date('2026-09-16T00:00:00Z');
function authorities(week = 2, observedAt = now.toISOString()): readonly StoredLeagueAuthorityRead[] {
  return ['league1', 'league2'].map((leagueKey) => ({ kind: 'available', leagueKey,
    authority: {
      leagueKey, defaultSeason: 2026, defaultSeasonType: 'reg', defaultWeek: week,
      leagueLifecycle: 'active', activeSeason: 2026, activeSeasonType: 'reg', activeWeek: week,
      nflPhase: 'regular', sourceProvider: 'sleeper', verifiedAt: observedAt,
      sourceRevision: 'fixture', sourceObservedAt: observedAt, authorityGeneration: 1,
      lineupShape: { sourceExternalLeagueId: leagueKey, expectedRosterCount: 1,
        expectedStarterSlotCount: 1, expectedRosterIds: ['1'] },
      defaultPeriodCadence: { isCurrentRegularPeriod: true,
        games: [{ kickoffAt: '2026-09-18T00:00:00Z', date: '2026-09-18' }] },
    },
  }));
}
function job(week: number, published = false): AllPlayerJobState {
  return { state: 'completed', generation: 1, workerId: null, leaseUntil: null, nextRequestAt: null,
    payload: { period: { season: 2026, seasonType: 'reg', week }, periodHistory: published ? [{
      period: { season: 2026, seasonType: 'reg', week: 1 }, outcome: 'published', finalCoverage: true,
    }] : [] },
  };
}

describe('bounded all-player correction selection', () => {
  it('prioritizes previous-week final capture immediately after rollover', () => {
    expect(selectAllPlayerRecurringPeriod(authorities(), null, now)).toEqual({
      kind: 'selected', period: { season: 2026, seasonType: 'regular', week: 1 }, requireFinalCoverage: true,
    });
  });
  it('alternates current work with previous corrections without opening another budget', () => {
    expect(selectAllPlayerRecurringPeriod(authorities(), job(1), now)).toMatchObject({
      kind: 'selected', period: { week: 2 }, requireFinalCoverage: false,
    });
    expect(selectAllPlayerRecurringPeriod(authorities(), job(2), now)).toMatchObject({
      kind: 'selected', period: { week: 1 }, requireFinalCoverage: true,
    });
  });
  it('closes corrections after the finite schedule-derived window', () => {
    const later = new Date('2026-09-24T00:00:00Z');
    expect(selectAllPlayerRecurringPeriod(authorities(2, later.toISOString()), job(1, true), later))
      .toMatchObject({ kind: 'selected', period: { week: 2 } });
    expect(selectAllPlayerRecurringPeriod(authorities(2, later.toISOString()), job(1), later))
      .toEqual({ kind: 'unavailable', reason: 'previous-week-final-capture-overdue' });
  });
  it('rejects stale or conflicting league authority', () => {
    expect(selectAllPlayerRecurringPeriod(authorities(2, '2026-09-15T00:00:00Z'), null, now))
      .toMatchObject({ kind: 'unavailable', reason: 'authority-inconsistent-or-stale' });
    expect(selectAllPlayerRecurringPeriod([authorities(1)[0], authorities(2)[1]], null, now))
      .toMatchObject({ kind: 'unavailable' });
  });
  it('uses current week only at season start and a bounded opportunity gate', () => {
    expect(selectAllPlayerRecurringPeriod(authorities(1), null, now)).toMatchObject({
      kind: 'selected', period: { week: 1 }, requireFinalCoverage: false,
    });
    expect(isAllPlayerPollingOpportunity(new Date('2026-09-16T00:15:00Z'))).toBe(true);
    expect(isAllPlayerPollingOpportunity(new Date('2026-09-16T00:16:00Z'))).toBe(false);
  });
  it('retains the earliest missed final-capture obligation across later rollovers', () => {
    expect(selectAllPlayerRecurringPeriod(authorities(3), job(2), now)).toEqual({
      kind: 'unavailable', reason: 'final-capture-overdue:2026:regular:1',
    });
    expect(selectAllPlayerRecurringPeriod(authorities(4), job(3, true), now)).toEqual({
      kind: 'unavailable', reason: 'final-capture-overdue:2026:regular:2',
    });
  });
});
