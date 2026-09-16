import { describe, expect, it } from 'vitest';
import type { AllPlayerJobState, StoredLeagueAuthorityRead } from '../adapters/neon/contracts';
import { isAllPlayerPollingOpportunity, selectAllPlayerRecurringPeriod } from './all-player-cadence';

const expectedLeagueKeys = ['league1', 'league2'];
const now = new Date('2026-09-16T00:00:00Z');
function authorities(week = 2, observedAt = now.toISOString(), keys = expectedLeagueKeys): readonly StoredLeagueAuthorityRead[] {
  return keys.map((leagueKey) => ({ kind: 'available', leagueKey,
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
  it('selects one shared correction for every configured league, including Dynasty', () => {
    const keys = ['league1', 'league2', 'dynasty'];
    const rows = authorities(2, now.toISOString(), keys);
    expect(selectAllPlayerRecurringPeriod([...rows].reverse(), null, now, keys)).toEqual({
      kind: 'selected', period: { season: 2026, seasonType: 'regular', week: 1 }, requireFinalCoverage: true,
    });
    expect(selectAllPlayerRecurringPeriod(rows, job(1), now, keys)).toMatchObject({
      kind: 'selected', period: { week: 2 }, requireFinalCoverage: false,
    });
  });
  it.each(['empty', 'missing', 'duplicate', 'unexpected', 'nested-key', 'missing-row',
    'empty-registry', 'duplicate-registry'] as const)
  ('rejects %s authority inventory instead of silently selecting a subset of leagues', (variant) => {
    const keys = ['league1', 'league2', 'dynasty'];
    const rows = [...authorities(2, now.toISOString(), keys)];
    if (variant === 'empty') rows.length = 0;
    if (variant === 'missing') rows.pop();
    if (variant === 'duplicate') rows[2] = rows[1];
    if (variant === 'unexpected') rows[2] = { ...rows[2], leagueKey: 'other' };
    if (variant === 'nested-key' && rows[2].kind === 'available') {
      rows[2] = { ...rows[2], authority: { ...rows[2].authority, leagueKey: 'league1' } };
    }
    if (variant === 'missing-row') rows[2] = { kind: 'missing', leagueKey: 'dynasty' };
    if (variant === 'empty-registry') keys.length = 0;
    if (variant === 'duplicate-registry') keys[2] = keys[1];
    expect(selectAllPlayerRecurringPeriod(rows, null, now, keys)).toEqual({
      kind: 'unavailable', reason: 'authority-missing',
    });
  });
  it('prioritizes previous-week final capture immediately after rollover', () => {
    expect(selectAllPlayerRecurringPeriod(authorities(), null, now, expectedLeagueKeys)).toEqual({
      kind: 'selected', period: { season: 2026, seasonType: 'regular', week: 1 }, requireFinalCoverage: true,
    });
  });
  it('alternates current work with previous corrections without opening another budget', () => {
    expect(selectAllPlayerRecurringPeriod(authorities(), job(1), now, expectedLeagueKeys)).toMatchObject({
      kind: 'selected', period: { week: 2 }, requireFinalCoverage: false,
    });
    expect(selectAllPlayerRecurringPeriod(authorities(), job(2), now, expectedLeagueKeys)).toMatchObject({
      kind: 'selected', period: { week: 1 }, requireFinalCoverage: true,
    });
  });
  it('closes corrections after the finite schedule-derived window', () => {
    const later = new Date('2026-09-24T00:00:00Z');
    expect(selectAllPlayerRecurringPeriod(authorities(2, later.toISOString()), job(1, true), later, expectedLeagueKeys))
      .toMatchObject({ kind: 'selected', period: { week: 2 } });
    expect(selectAllPlayerRecurringPeriod(authorities(2, later.toISOString()), job(1), later, expectedLeagueKeys))
      .toEqual({ kind: 'selected', period: { season: 2026, seasonType: 'regular', week: 2 },
        requireFinalCoverage: false, diagnostics: ['final-capture-overdue:2026:regular:1'] });
  });
  it('rejects stale or conflicting league authority', () => {
    expect(selectAllPlayerRecurringPeriod(authorities(2, '2026-09-15T00:00:00Z'), null, now, expectedLeagueKeys))
      .toMatchObject({ kind: 'unavailable', reason: 'authority-inconsistent-or-stale' });
    expect(selectAllPlayerRecurringPeriod([authorities(1)[0], authorities(2)[1]], null, now, expectedLeagueKeys))
      .toMatchObject({ kind: 'unavailable' });
  });
  it('uses current week only at season start and a bounded opportunity gate', () => {
    expect(selectAllPlayerRecurringPeriod(authorities(1), null, now, expectedLeagueKeys)).toMatchObject({
      kind: 'selected', period: { week: 1 }, requireFinalCoverage: false,
    });
    expect(isAllPlayerPollingOpportunity(new Date('2026-09-16T00:00:00Z'))).toBe(true);
    expect(isAllPlayerPollingOpportunity(new Date('2026-09-16T00:15:00Z'))).toBe(false);
    expect(isAllPlayerPollingOpportunity(new Date('2026-09-16T00:16:00Z'))).toBe(false);
  });
  it('retains missed complete-score obligations while continuing current raw capture across rollovers', () => {
    expect(selectAllPlayerRecurringPeriod(authorities(3), job(2), now, expectedLeagueKeys)).toEqual({
      kind: 'selected', period: { season: 2026, seasonType: 'regular', week: 3 }, requireFinalCoverage: false,
      diagnostics: ['final-capture-overdue:2026:regular:1'],
    });
    expect(selectAllPlayerRecurringPeriod(authorities(4), job(3, true), now, expectedLeagueKeys)).toEqual({
      kind: 'selected', period: { season: 2026, seasonType: 'regular', week: 4 }, requireFinalCoverage: false,
      diagnostics: ['final-capture-overdue:2026:regular:2'],
    });
    expect(selectAllPlayerRecurringPeriod(authorities(3), job(3), now, expectedLeagueKeys)).toEqual({
      kind: 'selected', period: { season: 2026, seasonType: 'regular', week: 2 }, requireFinalCoverage: true,
      diagnostics: ['final-capture-overdue:2026:regular:1'],
    });
  });
  it('retains every older obligation after corrections close without polling old periods', () => {
    const later = new Date('2026-10-02T16:00:00Z');
    expect(selectAllPlayerRecurringPeriod(authorities(4, later.toISOString()), job(3), later, expectedLeagueKeys)).toEqual({
      kind: 'selected', period: { season: 2026, seasonType: 'regular', week: 4 }, requireFinalCoverage: false,
      diagnostics: ['final-capture-overdue:2026:regular:1', 'final-capture-overdue:2026:regular:2',
        'final-capture-overdue:2026:regular:3'],
    });
  });
  it('stops at the finite season completion window even with unfulfilled obligations', () => {
    const later = new Date('2026-10-02T16:00:00Z');
    const completed = authorities(4, later.toISOString()).map((row) => row.kind !== 'available' ? row : ({
      ...row, authority: { ...row.authority, leagueLifecycle: 'complete' as const },
    }));
    expect(selectAllPlayerRecurringPeriod(completed, job(3), later, expectedLeagueKeys)).toEqual({
      kind: 'unavailable', reason: 'season-correction-window-closed',
      period: { season: 2026, seasonType: 'regular', week: 1 },
      diagnostics: ['final-capture-overdue:2026:regular:1', 'final-capture-overdue:2026:regular:2',
        'final-capture-overdue:2026:regular:3', 'final-capture-overdue:2026:regular:4'],
    });
  });
  it('selects active Week 1 without depending on an advanced display schedule', () => {
    const advanced = authorities(1).map((row) => row.kind !== 'available' ? row : ({ ...row,
      authority: { ...row.authority, defaultWeek: 2, defaultPeriodCadence: {
        isCurrentRegularPeriod: false, games: [],
      } },
    }));
    expect(selectAllPlayerRecurringPeriod(advanced, null, now, expectedLeagueKeys)).toEqual({
      kind: 'selected', period: { season: 2026, seasonType: 'regular', week: 1 }, requireFinalCoverage: false,
    });
  });
  it.each(['empty', 'future'] as const)('keeps current capture while explicitly deferring corrections for %s advanced display timing', (variant) => {
    const advanced = authorities(2).map((row) => row.kind !== 'available' ? row : ({ ...row,
      authority: { ...row.authority, defaultWeek: 3, defaultPeriodCadence: {
        isCurrentRegularPeriod: false,
        games: variant === 'empty' ? [] : [{ kickoffAt: '2026-09-25T00:00:00Z', date: '2026-09-25' }],
      } },
    }));
    expect(selectAllPlayerRecurringPeriod(advanced, null, now, expectedLeagueKeys)).toEqual({
      kind: 'selected', period: { season: 2026, seasonType: 'regular', week: 2 }, requireFinalCoverage: false,
      diagnostics: ['correction-window-period-unavailable:2026:regular:1'],
    });
  });
  it('defers a prior correction when its finite window cannot be derived from stored timing', () => {
    const missing = authorities(2).map((row) => row.kind !== 'available' ? row : ({ ...row,
      authority: { ...row.authority, defaultPeriodCadence: { isCurrentRegularPeriod: true, games: [] } },
    }));
    expect(selectAllPlayerRecurringPeriod(missing, null, now, expectedLeagueKeys)).toEqual({
      kind: 'selected', period: { season: 2026, seasonType: 'regular', week: 2 }, requireFinalCoverage: false,
      diagnostics: ['correction-window-schedule-unavailable:2026:regular:1'],
    });
  });
});
