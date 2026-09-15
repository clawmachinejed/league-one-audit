import { describe, expect, it, vi } from 'vitest';
import capture from '../../../../test-support/fixtures/sleeper-week-two-rollover.json';
import { classifyLineupWatchPeriod } from '../../domain/period-classification';
import { externalLeagueRef } from '../../shared/provider-identity';
import {
  assertMatchupCompleteness,
  assertProjectionMatchupReadiness,
  parseRawSleeperMatchups,
} from './raw-matchups';

vi.mock('server-only', () => ({}));

describe('captured September 15 Week 2 rollover', () => {
  it.each(capture.leagues)('accepts independent display/scoring weeks for $leagueId', (league) => {
    const now = new Date(capture.requestGroupStartedAt);
    const leagueRef = externalLeagueRef('sleeper', league.leagueId);
    const range = { firstWeek: 1, lastWeek: 18 };
    const period = { season: Number(league.season), seasonType: 'regular' as const, week: league.week };
    const authority = {
      configuration: { key: league.leagueId, displayName: league.leagueId, leagueRef, matchupWeekRange: range },
      defaultDisplayPeriod: { ...period, week: capture.state.display_week },
      activeScoringPeriod: { ...period, week: capture.state.leg },
      lifecycle: 'active' as const, nflPhase: 'regular' as const, source: leagueRef.provider,
      sourceRevision: 'captured-rollover', observedAt: now.toISOString(), verifiedAt: now.toISOString(),
    };
    expect(classifyLineupWatchPeriod(authority, period, { now, range, expectedLeagueRef: leagueRef }))
      .toEqual({ kind: 'classified', watchClass: 'current', materializationLane: 'current' });
  });

  it.each(capture.leagues)('isolates the captured missing lineup without copying current starters for $leagueId', (league) => {
    const rows = parseRawSleeperMatchups(league.weekly, `/league/${league.leagueId}/matchups/2`);
    expect(rows).toHaveLength(12);
    expect(() => assertMatchupCompleteness(rows, league.currentRosters, true)).not.toThrow();
    const incomplete = rows.filter((row) => row.starters === null);
    expect(incomplete.map((row) => row.roster_id))
      .toEqual(league.leagueId === '1378850182409490432' ? [2] : [10]);
    expect(league.currentRosters.find((row) => row.roster_id === incomplete[0].roster_id)?.starters)
      .toHaveLength(9);
    expect(() => assertProjectionMatchupReadiness(rows, league.currentRosters, league.rosterPositions))
      .not.toThrow();
    expect(rows).toEqual(league.weekly);
  });
});
