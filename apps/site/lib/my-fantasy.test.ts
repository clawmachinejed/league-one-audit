import { describe, expect, it } from 'vitest';
import type { MatchupPeriodContext } from './matchup-period';
import { getMyFantasyLeagueSummary, myFantasyStandingsEvidence } from './my-fantasy';
import { buildCompletedStandingsBasis } from './projected-standings';
import type { MatchupsData, Player, StandingsData, StandingsTeam } from './types';

const now = new Date('2026-09-20T12:00:00Z');
const context: MatchupPeriodContext = {
  defaultSeason: 2026, defaultWeek: 2, activeSeason: 2026, activeWeek: 2,
  lifecycle: 'active', nflPhase: 'regular', temporalState: 'active', refreshDue: false,
};

function player(id: string, slot = 'QB', fields: Partial<Player> = {}): Player {
  return { id, name: `Player ${id}`, slot, position: slot, nflTeam: 'KC', injuryStatus: null,
    points: 0, projectedPoints: 10,
    game: { kind: 'scheduled', opponent: 'DEN', location: 'home', date: '2026-09-20', kickoffAt: '2026-09-20T17:00:00Z' },
    ...fields };
}

function fixture() {
  const teams: StandingsTeam[] = [1, 2, 3, 4].map(id => ({ id, name: `Team ${id}`, managerName: `Manager ${id}`,
    avatar: null, wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0, waiverOrder: id, waiverBudgetRemaining: 100 }));
  const basis = buildCompletedStandingsBasis(teams, 2, [[100, 80, 70, 90].map((points, index) => ({
    roster_id: index + 1, matchup_id: Math.floor(index / 2) + 1, points,
  }))]);
  if (basis.kind !== 'ready') throw new Error(basis.reason);
  const standings: StandingsData = {
    league: { season: '2026', week: 2, maxWeek: 18, rosterPositions: ['QB', 'RB', 'BN', 'IR', 'TAXI'] },
    updatedAt: now.toISOString(), teams: basis.teams, projectionBasis: basis,
  };
  const scores = [110, 120, 100, 100];
  const data: MatchupsData = {
    league: standings.league, teams: structuredClone(basis.teams), updatedAt: now.toISOString(), week: 2,
    matchups: [0, 1].map(index => ({ id: `matchup-${index}`, status: 'upcoming', sides: [index * 2 + 1, index * 2 + 2].map(id => ({
      team: structuredClone(basis.teams.find(candidate => candidate.id === id)!), points: 0,
      projectedPoints: scores[id - 1], starters: [player(`${id}-qb`), player(`${id}-rb`, 'RB')],
      bench: [player(`${id}-bench`, 'BN', { injuryStatus: 'Out' })],
    })) })),
  };
  return { data, standings, own: data.matchups[0].sides[0] };
}

describe('My Fantasy league summary', () => {
  it('reuses official standings and current-week projections without changing source data', () => {
    const { data, standings } = fixture();
    const before = structuredClone({ data, standings });
    expect(getMyFantasyLeagueSummary(data, context, standings, 1, now)).toMatchObject({
      team: { id: 1, wins: 1, losses: 0 }, currentRank: 1, projectedRank: 2, projectedRankStatus: 'available',
      projectedRankReason: null, projectedOutcome: 'loss', attention: { status: 'verified', issues: [] },
    });
    expect({ data, standings }).toEqual(before);
  });

  it('uses the league-scoped selected team and keeps its complete matchup side first', () => {
    const { data, standings } = fixture();
    const result = getMyFantasyLeagueSummary(data, context, standings, 2, now);
    expect(result.team?.id).toBe(2);
    expect(result.matchup?.sides[0]).toBe(data.matchups[0].sides[1]);
    expect(result.projectedOutcome).toBe('win');
    expect(getMyFantasyLeagueSummary(data, context, standings, 999, now).team?.id).toBe(1);
  });

  it('takes current record from official standings instead of an older immutable matchup', () => {
    const { data, standings } = fixture();
    standings.teams = standings.teams.map(team => team.id === 1 ? { ...team, wins: 2 } : team);
    expect(getMyFantasyLeagueSummary(data, context, standings, 1, now).team?.wins).toBe(2);
    expect(data.matchups[0].sides[0].team.wins).toBe(1);
  });

  it('flags only confirmed starter problems and never makes a start/sit recommendation', () => {
    const { data, standings, own } = fixture();
    own.starters[0].injuryStatus = 'Out';
    own.starters[1].injuryStatus = 'Questionable';
    expect(getMyFantasyLeagueSummary(data, context, standings, 1, now).attention).toEqual({
      status: 'verified', reason: null, issues: [{ kind: 'out', playerId: '1-qb', playerName: 'Player 1-qb', slot: 'QB',
        message: 'Player 1-qb is OUT and in the starting lineup.' }],
    });
    own.starters[0].injuryStatus = 'Questionable';
    expect(getMyFantasyLeagueSummary(data, context, standings, 1, now).attention).toMatchObject({ status: 'verified', issues: [] });
  });

  it('recognizes known empty slots and exact-week byes independently of projected points', () => {
    const { data, standings, own } = fixture();
    own.starters = [player('empty-QB-0', 'QB', { name: 'Empty slot', game: null, projectedPoints: null }),
      player('1-rb', 'RB', { game: { kind: 'bye' }, projectedPoints: 0 })];
    const attention = getMyFantasyLeagueSummary(data, context, standings, 1, now).attention;
    expect(attention.status).toBe('verified');
    expect(attention.issues.map(issue => issue.kind)).toEqual(['empty', 'bye']);
  });

  it.each(['live', 'final', 'kickoff'] as const)('does not call current OUT metadata actionable after %s', state => {
    const { data, standings, own } = fixture();
    own.starters[0].injuryStatus = 'Out';
    const game = own.starters[0].game;
    if (game?.kind !== 'scheduled') throw new Error('Expected scheduled fixture');
    if (state === 'live') game.liveScore = { teamScore: 0, opponentScore: 0, phase: 'q1', clockSeconds: 900 };
    if (state === 'final') game.finalScore = { teamScore: 20, opponentScore: 10 };
    if (state === 'kickoff') game.kickoffAt = now.toISOString();
    expect(getMyFantasyLeagueSummary(data, context, standings, 1, now).attention.issues).toEqual([]);
  });

  it('never treats today’s injury information as historical evidence or completed lineups as actionable', () => {
    const { data, standings, own } = fixture();
    own.starters[0].injuryStatus = 'Out';
    const historical = getMyFantasyLeagueSummary(data, { ...context, temporalState: 'past' }, standings, 1, now);
    expect(historical.attention).toMatchObject({ status: 'completed', issues: [] });
    expect(historical.projectedOutcome).toBe('unavailable');
    data.matchups[0].status = 'final';
    expect(getMyFantasyLeagueSummary(data, context, standings, 1, now).attention).toMatchObject({ status: 'completed', issues: [] });
  });

  it.each([
    { temporalState: 'future' as const }, { refreshDue: true }, { activeWeek: 3 }, { activeSeason: 2027 },
  ])('keeps unavailable current-period evidence out of attention and projections: %j', overrides => {
    const { data, standings, own } = fixture();
    own.starters[0].injuryStatus = 'Out';
    const summary = getMyFantasyLeagueSummary(data, { ...context, ...overrides }, standings, 1, now);
    expect(summary.attention).toMatchObject({ status: 'unknown', issues: [] });
    expect(summary.projectedOutcome).toBe('unavailable');
    expect(summary.projectedRank).toBeNull();
  });

  it.each(['missing', 'invalid-kickoff', 'missing-kickoff'] as const)('does not claim all clear with %s game information', state => {
    const { data, standings, own } = fixture();
    own.starters[0].injuryStatus = 'Out';
    own.starters[1].game = state === 'missing' ? null : {
      kind: 'scheduled', opponent: 'DEN', location: 'home', date: '2026-09-20',
      kickoffAt: state === 'invalid-kickoff' ? 'bad-date' : null,
    };
    const attention = getMyFantasyLeagueSummary(data, context, standings, 1, now).attention;
    expect(attention.status).toBe('unknown');
    expect(attention.issues.map(issue => issue.kind)).toEqual(['out']);
  });

  it('does not convert missing starters or a missing matchup into an empty position or all clear', () => {
    const { data, standings, own } = fixture();
    own.starters = [];
    expect(getMyFantasyLeagueSummary(data, context, standings, 1, now).attention).toMatchObject({ status: 'unknown', issues: [] });
    data.matchups = [];
    const summary = getMyFantasyLeagueSummary(data, context, standings, 1, now);
    expect(summary).toMatchObject({ team: { id: 1 }, matchup: null, projectedOutcome: 'unavailable', projectedRank: null });
    expect(summary.attention).toMatchObject({ status: 'unknown', issues: [] });
  });

  it('retains confirmed issues but withholds all clear when the source reports incomplete metadata', () => {
    const { data, standings, own } = fixture();
    data.warning = 'Some player information is temporarily unavailable.';
    expect(getMyFantasyLeagueSummary(data, context, standings, 1, now).attention).toMatchObject({ status: 'unknown', issues: [] });
    own.starters[0].injuryStatus = 'Out';
    expect(getMyFantasyLeagueSummary(data, context, standings, 1, now).attention).toMatchObject({
      status: 'unknown', issues: [{ kind: 'out' }],
    });
  });

  it('withholds projected results for unknown and unpaired matchups', () => {
    const { data, standings } = fixture();
    data.matchups[0].status = 'unknown';
    expect(getMyFantasyLeagueSummary(data, context, standings, 1, now)).toMatchObject({
      projectedOutcome: 'unavailable', projectedRank: null, attention: { status: 'unknown', issues: [] },
    });
    data.matchups[0].status = 'upcoming';
    data.matchups[0].sides = data.matchups[0].sides.slice(0, 1);
    expect(getMyFantasyLeagueSummary(data, context, standings, 1, now)).toMatchObject({
      projectedOutcome: 'unavailable', projectedRank: null,
    });
  });

  it('withholds projected rank when any league matchup is unresolved while keeping the known own result', () => {
    const { data, standings } = fixture();
    data.matchups[1].sides[0].projectedPoints = null;
    expect(getMyFantasyLeagueSummary(data, context, standings, 1, now)).toMatchObject({
      currentRank: 1, projectedRank: null, projectedRankStatus: 'unavailable', projectedOutcome: 'loss',
      projectedRankReason: 'Projected results do not cover every league matchup.',
    });
  });

  it.each([null, Number.NaN, Number.POSITIVE_INFINITY])('never turns missing or invalid projection %s into a result', value => {
    const { data, standings, own } = fixture();
    own.projectedPoints = value;
    expect(getMyFantasyLeagueSummary(data, context, standings, 1, now)).toMatchObject({ projectedOutcome: 'unavailable', projectedRank: null });
  });

  it('matches displayed two-decimal projected ties and permits explicit zero and negative scores', () => {
    const { data, standings, own } = fixture();
    own.projectedPoints = 0;
    data.matchups[0].sides[1].projectedPoints = -1;
    expect(getMyFantasyLeagueSummary(data, context, standings, 1, now).projectedOutcome).toBe('win');
    own.projectedPoints = 100.001;
    data.matchups[0].sides[1].projectedPoints = 100.002;
    expect(getMyFantasyLeagueSummary(data, context, standings, 1, now).projectedOutcome).toBe('tie');
  });

  it('never invents standings rank from missing, invalid or different-season standings', () => {
    const { data, standings } = fixture();
    expect(getMyFantasyLeagueSummary(data, context, null, 1, now)).toMatchObject({ currentRank: null, projectedRank: null });
    expect(getMyFantasyLeagueSummary(data, context, { ...standings, league: { ...standings.league, season: '2025' } }, 1, now))
      .toMatchObject({ currentRank: null, projectedRank: null });
    standings.teams[0].pointsFor = Number.NaN;
    expect(getMyFantasyLeagueSummary(data, context, standings, 1, now)).toMatchObject({ currentRank: null, projectedRank: null });
  });

  it('does not present a rank from an incomplete official league table', () => {
    const { data, standings } = fixture();
    standings.teams = standings.teams.filter(team => team.id !== 4);
    expect(getMyFantasyLeagueSummary(data, context, standings, 1, now)).toMatchObject({ currentRank: null, projectedRank: null });
  });
});

describe('My Fantasy official standings refresh evidence', () => {
  it('ignores ordinary live points, projections and source ordering so minute polls do not refresh the whole page', () => {
    const { data } = fixture();
    const initial = myFantasyStandingsEvidence(data);
    data.matchups[0].sides[0].points = 42;
    data.matchups[0].sides[0].projectedPoints = 140;
    data.matchups[0].status = 'live';
    data.updatedAt = '2026-09-20T18:00:00Z';
    data.teams.reverse();
    data.matchups.reverse();
    expect(myFantasyStandingsEvidence(data)).toBe(initial);
  });

  it('detects official record changes and a completed result even before the aggregate record advances', () => {
    const { data } = fixture();
    const initial = myFantasyStandingsEvidence(data);
    data.matchups[0].status = 'final';
    const complete = myFantasyStandingsEvidence(data);
    expect(complete).not.toBe(initial);
    data.teams[0].wins += 1;
    const recordChanged = myFantasyStandingsEvidence(data);
    expect(recordChanged).not.toBe(complete);
    expect(myFantasyStandingsEvidence(structuredClone(data))).toBe(recordChanged);
  });
});
