import { describe, expect, it } from 'vitest';
import type { MatchupsData, NflGame } from './types';
import { projectionSyncCadence, projectionSyncCadenceForSchedule } from './projection-window';

function dataWithGame(game: NflGame): MatchupsData {
  return {
    league: { season: '2026', week: 1, maxWeek: 18, rosterPositions: ['QB'] },
    teams: [{
      id: 1, name: 'One', ownerName: 'Owner', wins: 0, losses: 0, ties: 0,
      avatar: null, pointsFor: 0, pointsAgainst: 0,
    }],
    week: 1,
    updatedAt: '2026-09-10T00:00:00.000Z',
    matchups: [{
      id: '1',
      status: 'upcoming',
      sides: [{
        team: {
          id: 1, name: 'One', ownerName: 'Owner', wins: 0, losses: 0, ties: 0,
          avatar: null, pointsFor: 0, pointsAgainst: 0,
        },
        points: 0,
        projectedPoints: null,
        starters: [{
          id: '1', name: 'Player', position: 'QB', nflTeam: 'DAL', injuryStatus: null,
          game, slot: 'QB', points: 0, projectedPoints: null,
        }],
      }],
    }],
  };
}

describe('projectionSyncCadence', () => {
  const scheduled = {
    kind: 'scheduled',
    opponent: 'PHI',
    location: 'away',
    date: '2026-09-10',
    kickoffAt: '2026-09-11T00:20:00.000Z',
  } as const;

  it('runs every invocation around kickoff', () => {
    expect(projectionSyncCadence(dataWithGame(scheduled), new Date('2026-09-10T23:00:00.000Z')))
      .toBe('live-window');
    expect(projectionSyncCadence(dataWithGame(scheduled), new Date('2026-09-11T06:00:00.000Z')))
      .toBe('live-window');
  });

  it('runs hourly away from games and otherwise stays idle', () => {
    expect(projectionSyncCadence(dataWithGame(scheduled), new Date('2026-09-08T14:00:00.000Z')))
      .toBe('hourly');
    expect(projectionSyncCadence(dataWithGame(scheduled), new Date('2026-09-08T14:01:00.000Z')))
      .toBe('idle');
  });

  it('supports a force run and a conservative missing-kickoff fallback', () => {
    const missingKickoff = { ...scheduled, kickoffAt: null } as NflGame;
    expect(projectionSyncCadence(dataWithGame(scheduled), new Date('2026-09-08T14:01:00.000Z'), true))
      .toBe('forced');
    expect(projectionSyncCadence(dataWithGame(missingKickoff), new Date('2026-09-10T16:02:00.000Z')))
      .toBe('live-window');
    expect(projectionSyncCadence(dataWithGame(missingKickoff), new Date('2026-09-10T16:03:00.000Z')))
      .toBe('idle');
  });

  it('uses the full slate even when a game has no displayed starter', () => {
    expect(projectionSyncCadenceForSchedule({ DAL: scheduled }, new Date('2026-09-10T23:00:00.000Z')))
      .toBe('live-window');
  });
});
