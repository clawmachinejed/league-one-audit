import { describe, expect, it } from 'vitest';
import type { StoredProjectionSnapshot } from './projection-store';
import { selectStoredMatchups } from './projection-freshness';
import type { Matchup, MatchupsData } from './types';

function payload(overrides: Partial<MatchupsData> = {}, matchups?: Matchup[]): MatchupsData {
  const team = {
    id: 1, managerName: 'Manager', name: 'Team', avatar: null,
    wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0,
  };
  return {
    league: { season: '2026', rosterPositions: ['QB'], week: 1, maxWeek: 18 },
    teams: [team],
    updatedAt: '2026-09-13T17:00:00.000Z',
    week: 1,
    matchups: matchups ?? [{
      id: '1', status: 'upcoming', sides: [{
        team, points: 0, projectedPoints: 12,
        starters: [{
          id: 'player-1', name: 'Player', position: 'QB', nflTeam: 'LAC', injuryStatus: null,
          game: {
            kind: 'scheduled', opponent: 'KC', location: 'away', date: '2026-09-13',
            kickoffAt: '2026-09-13T17:00:00.000Z',
          },
          slot: 'QB', points: 0, projectedPoints: 12,
        }],
      }],
    }],
    ...overrides,
  };
}

function snapshot(
  data = payload(),
  overrides: Partial<StoredProjectionSnapshot> = {},
): StoredProjectionSnapshot {
  return {
    snapshotId: `snapshot-${data.week}`,
    leagueSeasonId: 'season-1',
    week: data.week,
    modelVersion: 'clock-v1',
    revisionKey: 'revision-1',
    calculatedAt: data.updatedAt,
    publishedAt: data.updatedAt,
    verifiedAt: data.updatedAt,
    activityWindows: [{
      startsAt: '2026-09-13T15:00:00.000Z',
      endsAt: '2026-09-14T00:00:00.000Z',
    }],
    isCurrent: true,
    payload: data,
    ...overrides,
  };
}

describe('selectStoredMatchups', () => {
  it('uses verifiedAt for a current live-window snapshot and exposes that successful check', () => {
    const stored = snapshot(payload(), { verifiedAt: '2026-09-13T18:01:00.000Z' });
    const result = selectStoredMatchups(stored, stored, 1, new Date('2026-09-13T18:03:30.000Z'));
    expect(result).toEqual({
      kind: 'usable', historical: false,
      payload: { ...stored.payload, updatedAt: '2026-09-13T18:01:00.000Z' },
    });
  });

  it('rejects a current live-window snapshot after three minutes without a verified sync', () => {
    const stored = snapshot(payload(), { verifiedAt: '2026-09-13T18:00:00.000Z' });
    expect(selectStoredMatchups(stored, stored, 1, new Date('2026-09-13T18:03:01.000Z')))
      .toEqual({ kind: 'stale' });
  });

  it('uses the full-slate activity window even when no displayed starter is in that game', () => {
    const data = payload({ updatedAt: '2026-09-10T23:00:00.000Z' }, []);
    const stored = snapshot(data, {
      verifiedAt: '2026-09-10T23:00:00.000Z',
      activityWindows: [{
        startsAt: '2026-09-10T22:20:00.000Z',
        endsAt: '2026-09-11T07:20:00.000Z',
      }],
    });
    expect(selectStoredMatchups(stored, stored, 1, new Date('2026-09-10T23:03:01.000Z')))
      .toEqual({ kind: 'stale' });
  });

  it('allows the hourly worker window away from games but eventually rejects a stopped worker', () => {
    const data = payload({ updatedAt: '2026-09-08T13:00:00.000Z' });
    const stored = snapshot(data, { verifiedAt: '2026-09-08T13:00:00.000Z' });
    expect(selectStoredMatchups(stored, stored, 1, new Date('2026-09-08T14:14:59.000Z')).kind)
      .toBe('usable');
    expect(selectStoredMatchups(stored, stored, 1, new Date('2026-09-08T14:15:01.000Z')))
      .toEqual({ kind: 'stale' });
  });

  it('keeps a historical week and updates its current-week navigation from the latest snapshot', () => {
    const prior = snapshot(payload({
      league: { season: '2026', rosterPositions: ['QB'], week: 1, maxWeek: 18 },
      week: 1,
    }), { verifiedAt: '2026-09-01T00:00:00.000Z' });
    const currentData = payload({
      league: { season: '2026', rosterPositions: ['QB'], week: 4, maxWeek: 18 },
      week: 4,
    });
    const latest = snapshot(currentData, {
      snapshotId: 'snapshot-4', week: 4, verifiedAt: '2026-09-30T00:00:00.000Z',
    });
    const result = selectStoredMatchups(prior, latest, 1, new Date('2026-10-01T00:00:00.000Z'));
    expect(result.kind).toBe('usable');
    if (result.kind === 'usable') {
      expect(result.historical).toBe(true);
      expect(result.payload.week).toBe(1);
      expect(result.payload.league.week).toBe(4);
      expect(result.payload.updatedAt).toBe(prior.payload.updatedAt);
    }
  });

  it('does not treat final status alone as historical while Sleeper still reports the same week', () => {
    const finalData = payload({}, [{
      ...payload().matchups[0], status: 'final',
    }]);
    const stored = snapshot(finalData, { verifiedAt: '2026-09-01T00:00:00.000Z' });
    expect(selectStoredMatchups(stored, stored, 1, new Date('2026-09-14T00:00:00.000Z')))
      .toEqual({ kind: 'stale' });
  });

  it('rejects missing, mismatched, invalid, or implausibly future verification values', () => {
    const stored = snapshot();
    expect(selectStoredMatchups(null, null, 1)).toEqual({ kind: 'missing' });
    expect(selectStoredMatchups(stored, stored, 2)).toEqual({ kind: 'missing' });
    expect(selectStoredMatchups({ ...stored, verifiedAt: 'invalid' }, stored, 1))
      .toEqual({ kind: 'stale' });
    expect(selectStoredMatchups(
      { ...stored, verifiedAt: '2026-09-13T18:10:01.000Z' }, stored, 1,
      new Date('2026-09-13T18:05:00.000Z'),
    )).toEqual({ kind: 'stale' });
  });
});
