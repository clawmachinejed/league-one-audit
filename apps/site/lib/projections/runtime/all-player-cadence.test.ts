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
    expect(selectAllPlayerRecurringPeriod([...rows].reverse(), null, now, keys)).toMatchObject({
      kind: 'selected', period: { season: 2026, seasonType: 'regular', week: 1 }, requireFinalCoverage: true,
    });
    expect(selectAllPlayerRecurringPeriod(rows, job(1), now, keys)).toMatchObject({
      kind: 'selected', period: { week: 2 }, requireFinalCoverage: false,
    });
  });
  it.each(['unexpected', 'empty-registry', 'duplicate-registry', 'blank-key'] as const)
  ('fails closed for a globally invalid %s inventory', (variant) => {
    const keys = ['league1', 'league2', 'dynasty'];
    const rows = [...authorities(2, now.toISOString(), keys)];
    if (variant === 'unexpected') rows[2] = { ...rows[2], leagueKey: 'other' };
    if (variant === 'empty-registry') keys.length = 0;
    if (variant === 'duplicate-registry') keys[2] = keys[1];
    if (variant === 'blank-key') keys[2] = ' ';
    expect(selectAllPlayerRecurringPeriod(rows, null, now, keys)).toMatchObject({
      kind: 'unavailable', reason: 'authority-missing', eligibleLeagueKeys: [], deferredLeagueKeys: [],
    });
  });
  it.each(['missing', 'duplicate', 'nested-key', 'missing-row', 'malformed-row'] as const)
  ('isolates %s authority with explicit unavailable inventory', (variant) => {
    const keys = ['league1', 'league2', 'dynasty'];
    const rows = [...authorities(2, now.toISOString(), keys)];
    if (variant === 'missing') rows.pop();
    if (variant === 'duplicate') rows.push(rows[2]);
    if (variant === 'nested-key' && rows[2].kind === 'available') {
      rows[2] = { ...rows[2], authority: { ...rows[2].authority, leagueKey: 'league1' } };
    }
    if (variant === 'missing-row') rows[2] = { kind: 'missing', leagueKey: 'dynasty' };
    if (variant === 'malformed-row') rows[2] = { kind: 'malformed', leagueKey: 'dynasty' };
    expect(selectAllPlayerRecurringPeriod(rows, null, now, keys)).toEqual({
      kind: 'selected', period: { season: 2026, seasonType: 'regular', week: 1 }, requireFinalCoverage: true,
      eligibleLeagueKeys: ['league1', 'league2'], unavailableLeagueKeys: ['dynasty'], deferredLeagueKeys: [],
    });
  });
  it('reports every missing authority when no league is usable', () => {
    expect(selectAllPlayerRecurringPeriod([], null, now, expectedLeagueKeys)).toEqual({
      kind: 'unavailable', reason: 'authority-missing', eligibleLeagueKeys: [],
      unavailableLeagueKeys: expectedLeagueKeys, deferredLeagueKeys: [],
    });
  });
  it('prioritizes previous-week final capture immediately after rollover', () => {
    expect(selectAllPlayerRecurringPeriod(authorities(), null, now, expectedLeagueKeys)).toMatchObject({
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
  it('does not let minute-level current defense captures starve hourly current statistics after a prior correction', () => {
    const mixed: AllPlayerJobState = { ...job(2, true), payload: { ...job(2, true).payload,
      mode: 'live-defense',
      lastOutcome: { outcome: 'published', period: { season: 2026, seasonType: 'reg', week: 1 } },
      lastLiveDefenseOutcome: { outcome: 'captured', period: { season: 2026, seasonType: 'reg', week: 2 } },
    } };
    expect(selectAllPlayerRecurringPeriod(authorities(), mixed, now, expectedLeagueKeys)).toMatchObject({
      kind: 'selected', period: { week: 2 }, requireFinalCoverage: false,
    });
    const afterCurrent: AllPlayerJobState = { ...mixed, payload: { ...mixed.payload,
      lastOutcome: { outcome: 'partial', period: { season: 2026, seasonType: 'reg', week: 2 } },
    } };
    expect(selectAllPlayerRecurringPeriod(authorities(), afterCurrent, now, expectedLeagueKeys)).toMatchObject({
      kind: 'selected', period: { week: 1 }, requireFinalCoverage: true,
    });
  });
  it.each(['captured', 'validation-failed', 'provider-failed', 'timeout', 'lease-lost'] as const)
  ('retains hourly alternation after an all-player %s outcome followed by live captures', (outcome) => {
    const priorFailed: AllPlayerJobState = { ...job(2), payload: { ...job(2).payload,
      mode: 'live-defense', lastOutcome: { outcome, period: { season: 2026, seasonType: 'reg', week: 1 } },
    } };
    expect(selectAllPlayerRecurringPeriod(authorities(), priorFailed, now, expectedLeagueKeys)).toMatchObject({
      kind: 'selected', period: { week: 2 }, requireFinalCoverage: false,
    });
  });
  it('uses only valid legacy periods when an all-player completion is absent or malformed', () => {
    const legacy = job(1);
    for (const lastOutcome of [undefined, { outcome: 'invalid', period: legacy.payload.period },
      { outcome: 'partial', period: { season: 2026, seasonType: 'regular', week: 1 } }]) {
      expect(selectAllPlayerRecurringPeriod(authorities(), { ...legacy, payload: { ...legacy.payload, lastOutcome } }, now, expectedLeagueKeys))
        .toMatchObject({ kind: 'selected', period: { week: 2 } });
    }
    expect(selectAllPlayerRecurringPeriod(authorities(), { ...legacy, payload: { ...legacy.payload,
      period: { season: 2026, seasonType: 'post', week: 1 },
    } }, now, expectedLeagueKeys)).toMatchObject({ kind: 'selected', period: { week: 1 } });
    expect(selectAllPlayerRecurringPeriod(authorities(), { ...legacy, payload: { ...legacy.payload, mode: 'live-defense' } }, now, expectedLeagueKeys))
      .toMatchObject({ kind: 'selected', period: { week: 1 } });
  });
  it('returns to previous-week corrections after a budgeted current-week no-statistics-yet outcome', () => {
    const emptyCurrent = job(2, true);
    const priorProof = emptyCurrent.payload.periodHistory;
    const completedEmpty: AllPlayerJobState = { ...emptyCurrent, payload: { ...emptyCurrent.payload,
      lastOutcome: { outcome: 'no-statistics-yet', period: { season: 2026, seasonType: 'reg', week: 2 },
        finalCoverage: false },
    } };
    expect(selectAllPlayerRecurringPeriod(authorities(), completedEmpty, now, expectedLeagueKeys))
      .toMatchObject({ kind: 'selected', period: { season: 2026, seasonType: 'regular', week: 1 }, requireFinalCoverage: true });
    expect(completedEmpty.payload.periodHistory).toEqual(priorProof);
  });
  it('closes corrections after the finite schedule-derived window', () => {
    const later = new Date('2026-09-24T00:00:00Z');
    expect(selectAllPlayerRecurringPeriod(authorities(2, later.toISOString()), job(1, true), later, expectedLeagueKeys))
      .toMatchObject({ kind: 'selected', period: { week: 2 } });
    expect(selectAllPlayerRecurringPeriod(authorities(2, later.toISOString()), job(1), later, expectedLeagueKeys))
      .toMatchObject({ kind: 'selected', period: { season: 2026, seasonType: 'regular', week: 2 },
        requireFinalCoverage: false, diagnostics: ['final-capture-overdue:2026:regular:1'] });
  });
  it('rejects an entirely stale fleet while coalescing compatible current and correction requests', () => {
    expect(selectAllPlayerRecurringPeriod(authorities(2, '2026-09-15T00:00:00Z'), null, now, expectedLeagueKeys))
      .toMatchObject({ kind: 'unavailable', reason: 'authority-inconsistent-or-stale' });
    expect(selectAllPlayerRecurringPeriod([authorities(1)[0], authorities(2)[1]], null, now, expectedLeagueKeys))
      .toEqual({ kind: 'selected', period: { season: 2026, seasonType: 'regular', week: 1 },
        requireFinalCoverage: false, eligibleLeagueKeys: expectedLeagueKeys,
        unavailableLeagueKeys: [], deferredLeagueKeys: [] });
  });
  it.each(['stale', 'future-clock', 'wrong-provider', 'unsupported-period'] as const)
  ('continues healthy work while isolating a %s league', (variant) => {
    const rows = [...authorities()];
    if (rows[0].kind !== 'available') throw new Error('Expected fixture authority.');
    rows[0] = { ...rows[0], authority: { ...rows[0].authority,
      ...(variant === 'stale' ? { verifiedAt: '2026-09-15T00:00:00Z' } : {}),
      ...(variant === 'future-clock' ? { verifiedAt: '2026-09-17T00:00:00Z' } : {}),
      ...(variant === 'wrong-provider' ? { sourceProvider: 'tank01' } : {}),
      ...(variant === 'unsupported-period' ? { activeWeek: 0 } : {}),
    } };
    expect(selectAllPlayerRecurringPeriod(rows, null, now, expectedLeagueKeys)).toEqual({
      kind: 'selected', period: { season: 2026, seasonType: 'regular', week: 1 }, requireFinalCoverage: true,
      eligibleLeagueKeys: ['league2'], unavailableLeagueKeys: ['league1'], deferredLeagueKeys: [],
    });
  });
  it('rotates incompatible exact seasons and weeks without starving either group', () => {
    const nextSeason = authorities(3)[1];
    if (nextSeason.kind !== 'available') throw new Error('Expected fixture authority.');
    const rows: readonly StoredLeagueAuthorityRead[] = [authorities(2)[0], { ...nextSeason,
      authority: { ...nextSeason.authority, activeSeason: 2027, defaultSeason: 2027 } }];
    const seen = new Set<string>();
    let previous: AllPlayerJobState | null = null;
    for (let index = 0; index < 8; index += 1) {
      const selected = selectAllPlayerRecurringPeriod(index % 2 ? rows : [...rows].reverse(), previous,
        now, [...expectedLeagueKeys].reverse());
      expect(selected.kind).toBe('selected');
      if (selected.kind !== 'selected') throw new Error('Expected a healthy period.');
      seen.add(`${selected.period.season}:${selected.period.week}`);
      expect(selected.unavailableLeagueKeys).toEqual([]);
      expect(selected.eligibleLeagueKeys).toHaveLength(1);
      expect(selected.deferredLeagueKeys).toHaveLength(1);
      previous = { ...job(selected.period.week), payload: { period: {
        season: selected.period.season, seasonType: 'reg', week: selected.period.week,
      } } };
    }
    expect([...seen].sort()).toEqual(['2026:1', '2026:2', '2027:2', '2027:3']);
  });
  it('does not let a peer with missing correction timing suppress a healthy correction', () => {
    const rows = [...authorities()];
    if (rows[0].kind !== 'available') throw new Error('Expected fixture authority.');
    rows[0] = { ...rows[0], authority: { ...rows[0].authority,
      defaultPeriodCadence: { isCurrentRegularPeriod: true, games: [] } } };
    expect(selectAllPlayerRecurringPeriod(rows, null, now, expectedLeagueKeys)).toEqual({
      kind: 'selected', period: { season: 2026, seasonType: 'regular', week: 1 }, requireFinalCoverage: true,
      diagnostics: ['correction-window-schedule-unavailable:2026:regular:1'],
      eligibleLeagueKeys: ['league2'], unavailableLeagueKeys: [], deferredLeagueKeys: ['league1'],
    });
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
    expect(selectAllPlayerRecurringPeriod(authorities(3), job(2), now, expectedLeagueKeys)).toMatchObject({
      kind: 'selected', period: { season: 2026, seasonType: 'regular', week: 3 }, requireFinalCoverage: false,
      diagnostics: ['final-capture-overdue:2026:regular:1'],
    });
    expect(selectAllPlayerRecurringPeriod(authorities(4), job(3, true), now, expectedLeagueKeys)).toMatchObject({
      kind: 'selected', period: { season: 2026, seasonType: 'regular', week: 4 }, requireFinalCoverage: false,
      diagnostics: ['final-capture-overdue:2026:regular:2'],
    });
    expect(selectAllPlayerRecurringPeriod(authorities(3), job(3), now, expectedLeagueKeys)).toMatchObject({
      kind: 'selected', period: { season: 2026, seasonType: 'regular', week: 2 }, requireFinalCoverage: true,
      diagnostics: ['final-capture-overdue:2026:regular:1'],
    });
  });
  it('retains every older obligation after corrections close without polling old periods', () => {
    const later = new Date('2026-10-02T16:00:00Z');
    expect(selectAllPlayerRecurringPeriod(authorities(4, later.toISOString()), job(3), later, expectedLeagueKeys)).toMatchObject({
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
    expect(selectAllPlayerRecurringPeriod(completed, job(3), later, expectedLeagueKeys)).toMatchObject({
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
    expect(selectAllPlayerRecurringPeriod(advanced, null, now, expectedLeagueKeys)).toMatchObject({
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
    expect(selectAllPlayerRecurringPeriod(advanced, null, now, expectedLeagueKeys)).toMatchObject({
      kind: 'selected', period: { season: 2026, seasonType: 'regular', week: 2 }, requireFinalCoverage: false,
      diagnostics: ['correction-window-period-unavailable:2026:regular:1'],
    });
  });
  it('defers a prior correction when its finite window cannot be derived from stored timing', () => {
    const missing = authorities(2).map((row) => row.kind !== 'available' ? row : ({ ...row,
      authority: { ...row.authority, defaultPeriodCadence: { isCurrentRegularPeriod: true, games: [] } },
    }));
    expect(selectAllPlayerRecurringPeriod(missing, null, now, expectedLeagueKeys)).toMatchObject({
      kind: 'selected', period: { season: 2026, seasonType: 'regular', week: 2 }, requireFinalCoverage: false,
      diagnostics: ['correction-window-schedule-unavailable:2026:regular:1'],
    });
  });
});
