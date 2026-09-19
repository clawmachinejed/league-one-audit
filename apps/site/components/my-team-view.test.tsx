import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MatchupPeriodContext } from '../lib/matchup-period';
import type { CurrentStandings } from '../lib/current-standings';
import type { MatchupsData, Player, Team } from '../lib/types';
import { LEAGUE_SITES } from '../lib/leagues';
import { LeagueSiteProvider } from './league-context';
import { MatchupsView } from './matchups-view';

const mocks = vi.hoisted(() => ({ selected: null as number | null,
  currentSnapshot: null as MatchupsData | null,
  select: vi.fn(), board: vi.fn(), boxScores: vi.fn(), snapshot: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('./team-preference', () => ({ useTeamPreference: () => ({ selected: mocks.selected, select: mocks.select }) }));
vi.mock('./matchup-board', () => ({ MatchupBoard: (props: unknown) => { mocks.board(props); return <div data-test-board />; } }));
vi.mock('./use-matchup-box-scores', () => ({ useMatchupBoxScores: (options: unknown) => {
  mocks.boxScores(options); return { data: null, loading: false, request: vi.fn() };
} }));
vi.mock('./use-matchup-snapshot', () => ({ useMatchupSnapshot: (options: { data: MatchupsData; periodContext: MatchupPeriodContext }) => {
  mocks.snapshot(options); return { ...options, data: mocks.currentSnapshot ?? options.data,
    updatedAt: (mocks.currentSnapshot ?? options.data).updatedAt, refreshing: false };
} }));

const context: MatchupPeriodContext = { defaultSeason: 2026, defaultWeek: 1, activeSeason: 2026, activeWeek: 2,
  lifecycle: 'active', nflPhase: 'regular', temporalState: 'active', refreshDue: false };
const team = (id: number, pointsFor = 100): Team => ({ id, name: `Team ${id}`, managerName: `Manager ${id}`,
  avatar: null, wins: 1, losses: 0, ties: 0, pointsFor, pointsAgainst: 90 });
const player = (id: string): Player => ({ id, name: id, position: 'QB', slot: 'QB', nflTeam: 'BUF',
  injuryStatus: null, game: null, points: 0, projectedPoints: 15 });
const teams = [team(1), team(2, 200), team(3), team(4)];
const data: MatchupsData = { league: { season: '2026', rosterPositions: ['QB'], week: 2, maxWeek: 18 },
  teams, week: 2, updatedAt: '2026-09-15T20:00:00.000Z', matchups: [
    { id: 'one', status: 'upcoming', sides: [
      { team: teams[0], points: 0, projectedPoints: 15, starters: [player('starter1')], bench: [player('bench1')] },
      { team: teams[1], points: 0, projectedPoints: 15, starters: [player('starter2')], bench: [player('bench2')] },
    ] },
    { id: 'two', status: 'upcoming', sides: [
      { team: teams[2], points: 0, projectedPoints: 15, starters: [player('starter3')] },
      { team: teams[3], points: 0, projectedPoints: 15, starters: [player('starter4')] },
    ] },
  ] };

function render(mode: 'matchups' | 'my-team', leagueKey: 'league1' | 'league2' | 'dynasty' = 'league1',
  standings?: CurrentStandings, payload = data) {
  return renderToStaticMarkup(<LeagueSiteProvider site={LEAGUE_SITES[leagueKey]}>
    <MatchupsView mode={mode} data={payload} periodContext={context} snapshotRevision={'a'.repeat(64)}
      verifiedAt={payload.updatedAt} followCurrent standings={standings} />
  </LeagueSiteProvider>);
}

describe('My Team shared matchup view', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.selected = null; mocks.currentSnapshot = null; });

  it.each(['matchups', 'my-team'] as const)('keeps the corrected manager after snapshot updates in %s without changing source scores or identity', mode => {
    const initial = structuredClone(data);
    initial.teams[0].managerName = 'eneerg';
    initial.matchups[0].sides[0].team.managerName = 'eneerg';
    const sourceBefore = JSON.stringify(initial);
    mocks.selected = 1;
    render(mode, 'league2', undefined, initial);
    expect(mocks.board.mock.lastCall?.[0].matchups[0].sides[0].team).toEqual({ ...initial.teams[0], managerName: 'tylerawildman' });
    expect(mocks.snapshot.mock.lastCall?.[0].data).toBe(initial);

    const update = structuredClone(initial);
    update.matchups[0].sides[0].points = 37.5;
    mocks.currentSnapshot = update;
    render(mode, 'league2', undefined, initial);
    const shown = mocks.board.mock.lastCall?.[0].matchups[0].sides[0];
    expect(shown.team.managerName).toBe('tylerawildman');
    expect(shown.points).toBe(37.5);
    expect(shown.starters).toBe(update.matchups[0].sides[0].starters);
    expect(shown.bench).toBe(update.matchups[0].sides[0].bench);
    expect(update.matchups[0].sides[0].team.managerName).toBe('eneerg');
    expect(JSON.stringify(initial)).toBe(sourceBefore);
    expect(mocks.select).not.toHaveBeenCalled();
  });

  it.each([
    ['league1', '2026', 1, 'eneerg'], ['dynasty', '2026', 1, 'eneerg'],
    ['league2', '2025', 1, 'eneerg'], ['league2', '2027', 1, 'eneerg'],
    ['league2', '2026', 5, 'eneerg'], ['league2', '2026', 1, 'New manager'],
  ] as const)('preserves an unrelated snapshot manager in %s, season %s, roster %i, name %s', (leagueKey, season, rosterId, managerName) => {
    const payload = structuredClone(data);
    payload.league.season = season;
    const displayedTeam = payload.matchups[0].sides[0].team;
    displayedTeam.id = rosterId;
    displayedTeam.managerName = managerName;
    render('matchups', leagueKey, undefined, payload);
    expect(mocks.board.mock.lastCall?.[0].matchups[0].sides[0].team).toBe(displayedTeam);
  });

  it.each(['matchups', 'my-team'] as const)('keeps current standings independent of snapshot order and selected-team reversal in %s', mode => {
    const standings: CurrentStandings = { leagueId: 'official', season: '2026', playoffTeams: 6, places: { 1: 12, 2: 8, 3: 1, 4: 6 } };
    mocks.selected = 4;
    render(mode, 'league1', standings);
    expect(mocks.board.mock.calls[0][0].standings).toBe(standings);
    expect(mocks.board.mock.calls[0][0].matchups[0].sides[0].team.id).toBe(4);
    expect(mocks.snapshot.mock.calls[0][0]).not.toHaveProperty('standings');
  });

  it('does not attach current standings from a different season', () => {
    render('matchups', 'league1', { leagueId: 'official', season: '2027', playoffTeams: 6, places: { 1: 1 } });
    expect(mocks.board.mock.calls[0][0].standings).toBeNull();
  });

  it.each(['league1', 'league2'] as const)('uses the current snapshot and bench-enabled board in %s without saving the default', leagueKey => {
    const html = render('my-team', leagueKey);
    expect(html).toContain('<h1>My Team</h1>');
    expect(html).toContain('<select');
    expect(html).toContain('>Week 2 · Current</option>');
    expect(html).toContain(`href="${LEAGUE_SITES[leagueKey].prefix}/my-team?week=3"`);
    expect(mocks.board.mock.calls[0][0]).toMatchObject({ selected: 2, showBench: true,
      matchups: [{ id: 'one', sides: [{ team: { id: 2 } }, { team: { id: 1 } }] }] });
    expect(mocks.board.mock.calls[0][0].matchups).toHaveLength(1);
    expect(mocks.snapshot.mock.calls[0][0]).toMatchObject({ leagueKey, data, periodContext: context,
      snapshotRevision: 'a'.repeat(64), verifiedAt: data.updatedAt });
    expect(mocks.boxScores.mock.calls[0][0]).toMatchObject({ leagueKey, week: 2, season: '2026', refreshAutomatically: true });
    expect(mocks.boxScores.mock.calls[0][0].lineupKey).toContain('bench1');
    expect(mocks.boxScores.mock.calls[0][0].lineupKey).toContain('bench2');
    expect(mocks.select).not.toHaveBeenCalled();
  });

  it('honors an existing selection rather than the automatic first-place display', () => {
    mocks.selected = 4;
    render('my-team');
    expect(mocks.board.mock.calls[0][0]).toMatchObject({ selected: 4, showBench: true,
      matchups: [{ id: 'two', sides: [{ team: { id: 4 } }, { team: { id: 3 } }] }] });
    expect(mocks.select).not.toHaveBeenCalled();
  });

  it.each(['league1', 'league2'] as const)('puts the saved team first and left on Matchups in %s without changing source data', leagueKey => {
    mocks.selected = 4;
    const original = JSON.stringify(data);
    const html = render('matchups', leagueKey);
    expect(html).toContain('<h1>Matchups</h1>');
    expect(html).toContain('<select');
    const board = mocks.board.mock.calls[0][0];
    expect(board).toMatchObject({ selected: 4, showBench: false, matchups: [
      { id: 'two', sides: [{ team: { id: 4 } }, { team: { id: 3 } }] }, data.matchups[0],
    ] });
    expect(board.matchups).toHaveLength(data.matchups.length);
    expect(board.matchups[0].sides[0]).toBe(data.matchups[1].sides[1]);
    expect(JSON.stringify(data)).toBe(original);
    expect(mocks.select).not.toHaveBeenCalled();
    expect(mocks.boxScores.mock.calls[0][0].lineupKey).not.toContain('bench');
  });

  it('keeps every Matchups card in source order when no team is selected', () => {
    render('matchups');
    expect(mocks.board.mock.calls[0][0]).toMatchObject({ selected: null, showBench: false, matchups: data.matchups });
    expect(mocks.select).not.toHaveBeenCalled();
  });
});
