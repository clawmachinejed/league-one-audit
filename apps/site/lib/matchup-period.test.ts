import { describe, expect, it } from 'vitest';
import type { LeaguePeriodAuthority } from './projections/domain/contracts';
import { externalLeagueRef } from './projections/shared/provider-identity';
import {
  currentMatchupWeek,
  matchupPeriodContext,
  matchupPeriodContextFromHeaders,
  matchupPeriodHeaders,
} from './matchup-period';

function authority(
  lifecycle: LeaguePeriodAuthority['lifecycle'] = 'active',
): LeaguePeriodAuthority {
  const leagueRef = externalLeagueRef('sleeper', 'league-id');
  return {
    configuration: {
      key: 'league1', displayName: 'League One', leagueRef,
      matchupWeekRange: { firstWeek: 1, lastWeek: 18 },
    },
    defaultDisplayPeriod: { season: 2026, seasonType: 'regular', week: 2 },
    activeScoringPeriod: lifecycle === 'active'
      ? { season: 2026, seasonType: 'regular', week: 1 } : null,
    lifecycle,
    nflPhase: lifecycle === 'preseason' ? 'preseason'
      : lifecycle === 'complete' ? 'postseason' : 'regular',
    source: leagueRef.provider, sourceRevision: 'revision',
    observedAt: '2026-09-13T18:00:00.000Z',
    verifiedAt: '2026-09-13T18:00:01.000Z',
  };
}

describe('matchup period context', () => {
  it.each([
    { name: 'lagging display', defaultWeek: 1, activeWeek: 2, expected: 2 },
    { name: 'leading display', defaultWeek: 3, activeWeek: 2, expected: 2 },
    { name: 'unavailable active week', defaultWeek: 3, activeWeek: null, expected: 3 },
    { name: 'zero active week', defaultWeek: 3, activeWeek: 0, expected: 3 },
    { name: 'out-of-range active week', defaultWeek: 3, activeWeek: 19, expected: 3 },
    { name: 'fractional active week', defaultWeek: 3, activeWeek: 2.5, expected: 3 },
  ])('selects an honest Current week with $name', ({ defaultWeek, activeWeek, expected }) => {
    const context = { ...matchupPeriodContext(authority(), 1), defaultWeek, activeWeek };
    expect(currentMatchupWeek(context)).toBe(expected);
    expect(context.defaultWeek).toBe(defaultWeek);
  });

  it('keeps the display fallback outside the matching active season', () => {
    expect(currentMatchupWeek({ ...matchupPeriodContext(authority(), 1), activeSeason: 2027 })).toBe(2);
    expect(currentMatchupWeek(matchupPeriodContext(authority('preseason'), 1))).toBe(2);
    expect(currentMatchupWeek(matchupPeriodContext(authority('complete'), 18))).toBe(2);
  });

  it('classifies explicit weeks against active scoring rather than the display default', () => {
    expect(matchupPeriodContext(authority(), 1).temporalState).toBe('active');
    expect(matchupPeriodContext(authority(), 2).temporalState).toBe('future');
  });

  it('classifies every preseason week as future and every completed-season week as past', () => {
    expect(matchupPeriodContext(authority('preseason'), 1).temporalState).toBe('future');
    expect(matchupPeriodContext(authority('complete'), 18).temporalState).toBe('past');
  });

  it('round-trips the public period headers without changing private lifecycle context', () => {
    const original = matchupPeriodContext(authority(), 2, true);
    const parsed = matchupPeriodContextFromHeaders(matchupPeriodHeaders(original), {
      ...original, lifecycle: 'complete', nflPhase: 'unknown', refreshDue: false,
    });
    expect(parsed).toEqual({ ...original, lifecycle: 'complete', nflPhase: 'unknown' });
  });

  it('falls back atomically when any required header is malformed', () => {
    const fallback = matchupPeriodContext(authority(), 1);
    const headers = matchupPeriodHeaders(matchupPeriodContext(authority(), 2));
    headers.set('X-League-Default-Week', '19');
    expect(matchupPeriodContextFromHeaders(headers, fallback)).toBe(fallback);
  });
});
