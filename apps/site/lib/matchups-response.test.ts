import { describe, expect, it } from 'vitest';
import { isMatchupsData } from './matchups-response';

const validSnapshot = {
  league: { season: '2026', rosterPositions: ['QB'], week: 1, maxWeek: 18 },
  teams: [{
    id: 1, ownerName: 'Owner', name: 'Team', avatar: null, wins: 0, losses: 0,
    ties: 0, pointsFor: 0, pointsAgainst: null,
  }],
  updatedAt: '2026-09-10T00:00:00.000Z',
  week: 1,
  matchups: [{
    id: '1',
    status: 'live',
    sides: [{
      team: {
        id: 1, ownerName: 'Owner', name: 'Team', avatar: null, wins: 0, losses: 0,
        ties: 0, pointsFor: 0, pointsAgainst: null,
      },
      points: 10,
      projectedPoints: 20.125,
      starters: [{
        id: 'player', name: 'Player', position: 'QB', nflTeam: 'IND', injuryStatus: null,
        game: { kind: 'scheduled', opponent: 'HOU', location: 'home', date: 'Sun 1:00 PM', kickoffAt: null },
        slot: 'QB', points: 10, projectedPoints: 20.125,
      }],
    }],
  }],
};

describe('matchup response validation', () => {
  it('accepts a complete matchup snapshot', () => {
    expect(isMatchupsData(validSnapshot)).toBe(true);
  });

  it('rejects a partial nested snapshot instead of replacing valid screen state', () => {
    expect(isMatchupsData({ ...validSnapshot, matchups: [{ ...validSnapshot.matchups[0], sides: null }] }))
      .toBe(false);
    expect(isMatchupsData({ ...validSnapshot, teams: [{ ...validSnapshot.teams[0], id: Number.NaN }] }))
      .toBe(false);
  });
});
