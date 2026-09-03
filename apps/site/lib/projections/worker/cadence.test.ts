import { describe, expect, it } from 'vitest';
import type { LeagueCadenceState, NflWeekSchedule } from '../domain/contracts';
import { externalLeagueRef } from '../shared/provider-identity';
import {
  activityWindowsForSchedule,
  allowsHourlyFallback,
  highestCadence,
  hourBoundary,
  isCurrentNflPeriod,
  minuteBoundary,
  workerCadence,
} from './cadence';

const kickoffAt = '2026-09-13T17:00:00.000Z';
const schedule: NflWeekSchedule = {
  KC: { kind: 'scheduled', opponent: 'LAC', location: 'home', date: '2026-09-13', kickoffAt },
  LAC: { kind: 'scheduled', opponent: 'KC', location: 'away', date: '2026-09-13', kickoffAt },
  BUF: { kind: 'bye' },
};

function cadenceState(overrides: Partial<LeagueCadenceState> = {}): LeagueCadenceState {
  const configuration = {
    key: 'league', displayName: 'League',
    leagueRef: externalLeagueRef('official-source', 'league-1'),
  };
  return {
    configuration,
    period: { season: 2026, seasonType: 'regular', week: 1 },
    periodAuthority: {
      configuration,
      defaultDisplayPeriod: { season: 2026, seasonType: 'regular', week: 1 },
      activeScoringPeriod: { season: 2026, seasonType: 'regular', week: 1 },
      lifecycle: 'active', nflPhase: 'regular', source: configuration.leagueRef.provider,
      sourceRevision: 'period-revision', observedAt: '2026-09-13T16:00:00.000Z',
      verifiedAt: '2026-09-13T16:00:00.000Z',
    },
    currentPeriod: { season: 2026, week: 1, seasonType: 'regular' },
    schedule,
    ...overrides,
  };
}

describe('canonical worker cadence', () => {
  it('preserves forced, kickoff-window, and first-five-minute hourly behavior', () => {
    expect(workerCadence(schedule, new Date('2026-01-01T12:37:00Z'), true, false)).toBe('forced');
    expect(workerCadence(schedule, new Date('2026-09-13T15:00:00Z'), false, false))
      .toBe('live-window');
    expect(workerCadence(schedule, new Date('2026-09-13T14:59:59Z'), false, true))
      .toBe('idle');
    expect(workerCadence(schedule, new Date('2026-09-01T12:04:59Z'), false, true)).toBe('hourly');
    expect(workerCadence(schedule, new Date('2026-09-01T12:05:00Z'), false, true)).toBe('idle');
    expect(workerCadence(schedule, new Date('2026-09-01T12:00:00Z'), false, false)).toBe('idle');
  });

  it('preserves degraded missing-kickoff polling on even UTC minutes of the Eastern game date', () => {
    const missingKickoff: NflWeekSchedule = {
      KC: { kind: 'scheduled', opponent: 'LAC', location: 'home', date: '2026-09-13', kickoffAt: null },
    };
    expect(workerCadence(missingKickoff, new Date('2026-09-13T04:02:00Z'), false, false))
      .toBe('live-window');
    expect(workerCadence(missingKickoff, new Date('2026-09-13T04:03:00Z'), false, false))
      .toBe('idle');
  });

  it('preserves period and seven-day hourly-fallback decisions', () => {
    const current = cadenceState();
    expect(isCurrentNflPeriod(current)).toBe(true);
    expect(allowsHourlyFallback(current, new Date('2026-01-01T00:00:00Z'))).toBe(true);

    const future = cadenceState({
      currentPeriod: { season: null, week: null, seasonType: null },
      schedule: {
        KC: {
          kind: 'scheduled',
          opponent: 'LAC',
          location: 'home',
          date: '2026-09-13',
          kickoffAt: '2026-09-08T12:00:00.000Z',
        },
      },
    });
    expect(allowsHourlyFallback(future, new Date('2026-09-01T12:00:00Z'))).toBe(true);
    expect(allowsHourlyFallback(future, new Date('2026-08-31T11:59:59Z'))).toBe(false);
  });

  it('deduplicates shared kickoffs and preserves exact activity windows and boundaries', () => {
    expect(activityWindowsForSchedule(schedule)).toEqual([{
      startsAt: '2026-09-13T15:00:00.000Z',
      endsAt: '2026-09-14T00:00:00.000Z',
    }]);
    const time = new Date('2026-09-13T17:14:59.123Z');
    expect(minuteBoundary(time)).toBe('2026-09-13T17:14:00.000Z');
    expect(hourBoundary(time)).toBe('2026-09-13T17:00:00.000Z');
    expect(highestCadence(['idle', 'hourly', 'live-window'])).toBe('live-window');
    expect(highestCadence(['idle', 'forced'])).toBe('forced');
  });
});
