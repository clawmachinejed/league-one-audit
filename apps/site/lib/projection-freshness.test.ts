import { describe, expect, it } from 'vitest';
import type { MatchupPeriodContext } from './matchup-period';
import type { StoredProjectionSnapshot } from './projection-store';
import { selectStoredMatchups } from './projection-freshness';
import type { MatchupsData } from './types';

function payload(week = 1): MatchupsData {
  return {
    league: { season: '2026', rosterPositions: ['QB'], week, maxWeek: 18 },
    teams: [], updatedAt: '2026-09-13T18:00:00.000Z', week,
    matchups: [],
  };
}

function snapshot(week = 1, verifiedAt = '2026-09-13T18:00:00.000Z'): StoredProjectionSnapshot {
  return {
    snapshotId: `snapshot-${week}`, leagueSeasonId: 'season-1', week,
    modelVersion: 'clock-v1', revisionKey: `revision-${week}`,
    calculatedAt: verifiedAt, publishedAt: verifiedAt, verifiedAt,
    activityWindows: [{
      startsAt: '2026-09-13T15:00:00.000Z',
      endsAt: '2026-09-14T00:00:00.000Z',
    }],
    isCurrent: true, payload: payload(week),
  };
}

function context(
  temporalState: MatchupPeriodContext['temporalState'],
  defaultWeek = 1,
): MatchupPeriodContext {
  return {
    defaultSeason: 2026, defaultWeek, activeSeason: 2026, activeWeek: 1,
    lifecycle: 'active', nflPhase: 'regular', temporalState, refreshDue: false,
  };
}

describe('period-aware projection freshness', () => {
  it('strictly rejects an active game-window snapshot after three minutes', () => {
    expect(selectStoredMatchups(
      snapshot(), context('active'), new Date('2026-09-13T18:03:01.000Z'),
    )).toEqual({ kind: 'stale', context: { ...context('active'), refreshDue: true } });
  });

  it('accepts and advances the visible verification time for a fresh active snapshot', () => {
    const stored = snapshot(1, '2026-09-13T18:01:00.000Z');
    const result = selectStoredMatchups(stored, context('active'), new Date('2026-09-13T18:03:30.000Z'));
    expect(result).toEqual({
      kind: 'usable', historical: false,
      context: context('active'),
      payload: { ...stored.payload, updatedAt: stored.verifiedAt },
    });
  });

  it('keeps a stale future snapshot as last-known-good and marks refresh due', () => {
    const stored = snapshot(2, '2026-09-01T00:00:00.000Z');
    const result = selectStoredMatchups(
      stored, context('future', 2), new Date('2026-09-13T18:00:00.000Z'),
    );
    expect(result).toEqual({
      kind: 'usable', historical: false,
      context: { ...context('future', 2), refreshDue: true },
      payload: stored.payload,
    });
  });

  it('keeps past snapshots indefinitely without rewriting their target week', () => {
    const stored = snapshot(1, '2026-09-01T00:00:00.000Z');
    const result = selectStoredMatchups(
      stored, context('past', 2), new Date('2027-01-01T00:00:00.000Z'),
    );
    expect(result).toEqual({
      kind: 'usable', historical: true, context: context('past', 2), payload: stored.payload,
    });
    if (result.kind === 'usable') expect(result.payload.league.week).toBe(1);
  });

  it('rejects missing or period-mismatched payloads', () => {
    expect(selectStoredMatchups(null, context('active'))).toEqual({ kind: 'missing' });
    const stored = snapshot();
    expect(selectStoredMatchups(
      { ...stored, payload: payload(2) }, context('active'),
    )).toEqual({ kind: 'missing' });
  });
});
