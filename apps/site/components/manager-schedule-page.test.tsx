import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Team } from '../lib/types';

const mocks = vi.hoisted(() => ({
  getManagerHonors: vi.fn(async () => null), getOverview: vi.fn(), getMyTeamSchedule: vi.fn(), getSiteWeekRollover: vi.fn(),
  resolveCurrentLeagueId: vi.fn(async (id: string) => id),
}));
vi.mock('server-only', () => ({}));
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NEXT_NOT_FOUND'); } }));
vi.mock('@/lib/league-administration/registry', () => ({ resolveCurrentLeagueId: mocks.resolveCurrentLeagueId }));
vi.mock('@/lib/projection-reader', () => ({ readStoredMatchups: vi.fn() }));
vi.mock('@/lib/sleeper', () => ({
  ...mocks, getCurrentMatchupPeriodContext: vi.fn(), getOfficialMatchups: vi.fn(),
  getManager: vi.fn(), getStandings: vi.fn(), getTransactions: vi.fn(),
}));
vi.mock('./matchups-view', () => ({ MatchupsView: () => null }));
vi.mock('./manager-view', () => ({ ManagerView: () => null }));
vi.mock('./managers-view', () => ({ ManagersView: () => null }));
vi.mock('./standings-view', () => ({ StandingsView: () => null }));
vi.mock('./transactions-view', () => ({ TransactionsView: () => null }));
vi.mock('./my-team-schedule-view', () => ({ MyTeamScheduleView: () => null }));
vi.mock('./manager-schedule-view', () => ({ ManagerScheduleView: () => null }));

import { LeagueManagerSchedulePage as loadManagerSchedulePage } from './league-pages';
const LeagueManagerSchedulePage = async (props: Parameters<typeof loadManagerSchedulePage>[0]) => (await loadManagerSchedulePage(props)).props.children;
const team: Team = { id: 2, name: 'Viewed owner', managerName: 'Owner', avatar: null,
  wins: 1, losses: 0, ties: 0, pointsFor: 100, pointsAgainst: 80 };
const data = { league: { season: '2026', week: 2, maxWeek: 18, rosterPositions: [] },
  teams: [team], updatedAt: '2026-09-16T20:00:00.000Z', weeks: [] };
describe('manager schedule page composition', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveCurrentLeagueId.mockImplementation(async id => id);
    mocks.getOverview.mockResolvedValue(data);
    mocks.getMyTeamSchedule.mockResolvedValue(data);
    mocks.getSiteWeekRollover.mockResolvedValue(null);
  });
  it.each(['league1', 'league2', 'dynasty'])('loads fourteen weeks for the exact %s owner using its current source binding', async key => {
    mocks.resolveCurrentLeagueId.mockResolvedValue(`current-${key}`);
    const result = await LeagueManagerSchedulePage({ leagueId: `bootstrap-${key}`, params: Promise.resolve({ id: '2' }) }) as ReactElement<{data: typeof data & {team: Team}}>;
    expect(mocks.getOverview).toHaveBeenCalledWith(`current-${key}`);
    expect(mocks.getMyTeamSchedule).toHaveBeenCalledExactlyOnceWith(`current-${key}`, 14);
    expect(result.props.data.team).toEqual(team);
    expect(result.props.data.teams).toEqual([team]);
  });
  it.each(['no-owner', '999', '0', '-1'])('shows not found for %s without loading a season schedule', async id => {
    await expect(LeagueManagerSchedulePage({ leagueId: 'league1', params: Promise.resolve({ id }) })).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.getMyTeamSchedule).not.toHaveBeenCalled();
  });
});
