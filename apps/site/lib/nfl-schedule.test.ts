import { describe, expect, it } from 'vitest';
import {
  addScheduleToMatchups,
  addScheduleToPlayers,
  formatNflGame,
  normalizeSleeperSeasonSchedule,
  normalizeSleeperScores,
  resolveSleeperSchedule,
} from './nfl-schedule';
import type { Matchup, NflGame, Player, Team } from './types';

const score = (overrides: Record<string, unknown> = {}) => ({
  status: 'pre_game',
  date: '2026-09-13',
  metadata: { home_team: 'LAC', away_team: 'ARI', canceled: false },
  start_time: Date.parse('2026-09-13T20:25:00Z'),
  week: 1,
  season_type: 'regular',
  season: '2026',
  ...overrides,
});

const teamPairs = [
  ['CAR', 'KC'], ['LAC', 'ARI'], ['IND', 'HOU'], ['ATL', 'BAL'],
  ['BUF', 'CHI'], ['CIN', 'CLE'], ['DAL', 'DEN'], ['DET', 'GB'],
  ['JAX', 'LAR'], ['LV', 'MIA'], ['MIN', 'NE'], ['NO', 'NYG'],
  ['NYJ', 'PHI'], ['PIT', 'SEA'], ['SF', 'TB'], ['TEN', 'WAS'],
] as const;

function pairsForWeek(week: number) {
  return week >= 3 ? teamPairs.filter((_, index) => index !== week - 3) : teamPairs;
}

const completeWeekScores = (week = 1) => pairsForWeek(week).map(([home, away]) => score({
  metadata: { home_team: home, away_team: away, canceled: false },
  week,
}));

const completeSeasonSchedule = () => Array.from({ length: 18 }, (_, index) => index + 1)
  .flatMap((week) => pairsForWeek(week).map(([home, away]) => ({
    status: 'pre_game', date: '2026-09-13', home, away, week, game_id: `${week}-${home}-${away}`,
  })));

describe('Sleeper NFL schedule', () => {
  const liveGame = {
    kind: 'scheduled', opponent: 'TEN', location: 'away', date: '2026-09-13',
    kickoffAt: '2026-09-13T20:25:00.000Z',
  } as const;

  it.each([
    { phase: 'q1', clockSeconds: 900, expected: '15:00 1st 23-10 @ TEN' },
    { phase: 'q2', clockSeconds: 5, expected: '00:05 2nd 23-10 @ TEN' },
    { phase: 'q3', clockSeconds: 165, expected: '02:45 3rd 23-10 @ TEN' },
    { phase: 'q4', clockSeconds: 0, expected: '00:00 4th 23-10 @ TEN' },
    { phase: 'halftime', clockSeconds: null, expected: 'Half 23-10 @ TEN' },
    { phase: 'overtime', clockSeconds: 165, expected: '02:45 OT 23-10 @ TEN' },
    { phase: 'overtime', clockSeconds: null, expected: 'OT 23-10 @ TEN' },
  ] as const)('formats the observed live game as $expected', ({ phase, clockSeconds, expected }) => {
    expect(formatNflGame({ ...liveGame, liveScore: { teamScore: 23, opponentScore: 10, phase, clockSeconds } })).toBe(expected);
  });

  it('uses the requested home-team halftime format without a clock or win/loss', () => {
    expect(formatNflGame({ ...liveGame, opponent: 'NYJ', location: 'home',
      liveScore: { teamScore: 10, opponentScore: 24, phase: 'halftime', clockSeconds: null } })).toBe('Half 10-24 vs NYJ');
  });

  it('retains legitimate zero scores and a zero game clock', () => {
    expect(formatNflGame({ ...liveGame,
      liveScore: { teamScore: 0, opponentScore: 0, phase: 'q2', clockSeconds: 0 } })).toBe('00:00 2nd 0-0 @ TEN');
  });

  it.each([null, NaN, Infinity, -1, 1.5, 901])('retains the schedule for an unusable regulation clock %s', (clockSeconds) => {
    expect(formatNflGame({ ...liveGame,
      liveScore: { teamScore: 23, opponentScore: 10, phase: 'q3', clockSeconds } })).toBe('Sun 4:25 PM @ TEN');
  });

  it.each([NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])('retains the schedule for an invalid live score %s', (invalid) => {
    for (const scores of [{ teamScore: invalid, opponentScore: 10 }, { teamScore: 23, opponentScore: invalid }]) {
      expect(formatNflGame({ ...liveGame,
        liveScore: { ...scores, phase: 'halftime', clockSeconds: null } })).toBe('Sun 4:25 PM @ TEN');
    }
  });

  it('does not render an unknown live phase', () => {
    const malformed = { ...liveGame, liveScore: { teamScore: 23, opponentScore: 10,
      phase: 'unknown', clockSeconds: 165 } } as unknown as NflGame;
    expect(formatNflGame(malformed)).toBe('Sun 4:25 PM @ TEN');
  });

  it('gives a final result priority over a retained live value', () => {
    expect(formatNflGame({ ...liveGame,
      finalScore: { teamScore: 23, opponentScore: 10 },
      liveScore: { teamScore: 20, opponentScore: 10, phase: 'q4', clockSeconds: 165 } })).toBe('Final W 23-10 @ TEN');
  });

  it.each([
    { teamScore: 23, opponentScore: 10, location: 'away', opponent: 'TEN', expected: 'Final W 23-10 @ TEN' },
    { teamScore: 10, opponentScore: 24, location: 'home', opponent: 'NYJ', expected: 'Final L 10-24 vs NYJ' },
    { teamScore: 17, opponentScore: 17, location: 'home', opponent: 'NYJ', expected: 'Final T 17-17 vs NYJ' },
    { teamScore: 0, opponentScore: 14, location: 'away', opponent: 'TEN', expected: 'Final L 0-14 @ TEN' },
  ] as const)('formats a final result as $expected', ({ teamScore, opponentScore, location, opponent, expected }) => {
    expect(formatNflGame({ kind: 'scheduled', opponent, location, date: '2026-09-13',
      kickoffAt: '2026-09-13T20:25:00.000Z', finalScore: { teamScore, opponentScore } })).toBe(expected);
  });

  it.each([NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])('does not display an invalid final score %s', (teamScore) => {
    expect(formatNflGame({ kind: 'scheduled', opponent: 'ARI', location: 'home', date: '2026-09-13',
      kickoffAt: '2026-09-13T20:25:00.000Z', finalScore: { teamScore, opponentScore: 10 } })).toBe('Sun 4:25 PM vs ARI');
  });

  it('normalizes both sides of a game with the verified kickoff timestamp', () => {
    const schedule = normalizeSleeperScores([score()], '2026', 1);
    expect(schedule.LAC).toEqual({
      kind: 'scheduled', opponent: 'ARI', location: 'home', date: '2026-09-13', kickoffAt: '2026-09-13T20:25:00.000Z',
    });
    expect(schedule.ARI).toEqual({
      kind: 'scheduled', opponent: 'LAC', location: 'away', date: '2026-09-13', kickoffAt: '2026-09-13T20:25:00.000Z',
    });
    expect(formatNflGame(schedule.LAC)).toBe('Sun 4:25 PM vs ARI');
    expect(formatNflGame(schedule.ARI)).toBe('Sun 4:25 PM @ LAC');
  });

  it('keeps the opponent when kickoff is pending and normalizes team aliases', () => {
    const schedule = normalizeSleeperScores([score({
      start_time: null,
      metadata: { home_team: 'WSH', away_team: 'JAC', canceled: false },
    })], '2026', 1);
    expect(formatNflGame(schedule.WAS)).toBe('Sun TBD vs JAX');
    expect(formatNflGame(schedule.JAX)).toBe('Sun TBD @ WAS');
  });

  it('rejects canceled, malformed, wrong-week, and wrong-season games', () => {
    const schedule = normalizeSleeperScores([
      score({ metadata: { home_team: 'LAC', away_team: 'ARI', canceled: true } }),
      score({ week: 2 }),
      score({ season: '2025' }),
      score({ metadata: { home_team: 'LAC', away_team: '???', canceled: false } }),
    ], '2026', 1);
    expect(schedule).toEqual({});
  });

  it('rejects a feed where one team appears in more than one game', () => {
    const schedule = normalizeSleeperScores([
      score(),
      score({ metadata: { home_team: 'LAC', away_team: 'IND', canceled: false } }),
    ], '2026', 1);
    expect(schedule).toEqual({});
  });

  it('validates the full season schedule before using absence to identify byes', () => {
    const season = completeSeasonSchedule();
    expect(Object.keys(normalizeSleeperSeasonSchedule(season, 1))).toHaveLength(32);
    expect(normalizeSleeperSeasonSchedule(season.slice(1), 1)).toEqual({});
    expect(Object.keys(normalizeSleeperSeasonSchedule([
      ...season,
      { status: 'canceled', date: '2026-10-15', home: 'DAL', away: 'SEA', week: 6, game_id: 'canceled' },
    ], 1))).toHaveLength(32);
  });

  it('uses the season schedule as a safe fallback when weekly kickoff rows are partial', () => {
    const result = resolveSleeperSchedule(completeSeasonSchedule(), completeWeekScores().slice(0, 13), '2026', 1);
    expect(result.complete).toBe(false);
    expect(result.canIdentifyByes).toBe(true);
    expect(formatNflGame(result.schedule.TEN)).toBe('Sun TBD vs WAS');
    expect(formatNflGame(result.schedule.LAC)).toBe('Sun 4:25 PM vs ARI');
  });
});

const team: Team = {
  id: 1, managerName: 'Manager', name: 'Team', avatar: null,
  wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0,
};

function player(id: string, nflTeam: string | null): Player {
  return { id, name: id, position: 'RB', nflTeam, injuryStatus: null, game: null, slot: 'RB', points: null, projectedPoints: null };
}

describe('matchup schedule decoration', () => {
  const matchup: Matchup = {
    id: '1', status: 'upcoming', sides: [{ team, points: null, projectedPoints: null, starters: [
      player('scheduled', 'LAC'), player('bye', 'KC'), player('free-agent', null),
    ] }],
  };

  it('attaches scheduled games, marks real NFL bye teams, and leaves players without a team blank', () => {
    const result = resolveSleeperSchedule(completeSeasonSchedule(), completeWeekScores(3), '2026', 3);
    const starters = addScheduleToMatchups([matchup], result.schedule, result.canIdentifyByes)[0].sides[0].starters;
    expect(formatNflGame(starters[0].game!)).toBe('Sun 4:25 PM vs ARI');
    expect(starters[1].game).toEqual({ kind: 'bye' });
    expect(formatNflGame(starters[1].game!)).toBe('BYE');
    expect(starters[2].game).toBeNull();
  });

  it('never fabricates a bye when authoritative schedule coverage is unavailable', () => {
    expect(addScheduleToMatchups([matchup], {})[0].sides[0].starters.every((starter) => starter.game === null)).toBe(true);
    const partial = normalizeSleeperScores([score()], '2026', 1);
    const starters = addScheduleToMatchups([matchup], partial)[0].sides[0].starters;
    expect(starters[0].game).toEqual(partial.LAC);
    expect(starters[1].game).toBeNull();
  });

  it('uses the same schedule rules for rostered bench players', () => {
    const result = resolveSleeperSchedule(completeSeasonSchedule(), completeWeekScores(3), '2026', 3);
    const players = addScheduleToPlayers([
      player('scheduled', 'LAC'), player('bye', 'KC'), player('free-agent', null),
    ], result.schedule, result.canIdentifyByes);
    expect(players[0].game).toEqual(result.schedule.LAC);
    expect(players[1].game).toEqual({ kind: 'bye' });
    expect(players[2].game).toBeNull();
  });
});
