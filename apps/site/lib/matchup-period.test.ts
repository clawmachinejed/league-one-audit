import { describe, expect, it } from 'vitest';
import type { LeaguePeriodAuthority } from './projections/domain/contracts';
import { externalLeagueRef } from './projections/shared/provider-identity';
import {
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
