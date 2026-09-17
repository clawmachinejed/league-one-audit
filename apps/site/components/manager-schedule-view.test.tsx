import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LEAGUE_SITES } from '../lib/leagues';
import type { MyTeamScheduleData } from '../lib/my-team-schedule';
import type { Team } from '../lib/types';
import { LeagueSiteProvider } from './league-context';
import { ManagerScheduleView } from './manager-schedule-view';

const mocks = vi.hoisted(() => ({ selected: 1, select: vi.fn(), storageWarning: null }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('./team-preference', () => ({
  useTeamPreference: () => mocks,
  useTeamPreferenceContext: () => mocks,
}));
vi.mock('./use-site-week-rollover', () => ({ useSiteWeekRollover: vi.fn() }));

const teams: Team[] = ['Alpha', 'Beta'].map((name, index) => ({
  id: index + 1, name, managerName: name + ' owner', avatar: null,
  wins: 1, losses: 0, ties: 0, pointsFor: 100, pointsAgainst: 90,
}));
const data: MyTeamScheduleData & { team: Team } = {
  league: { season: '2026', week: 2, maxWeek: 18, rosterPositions: [] },
  teams, team: teams[1], updatedAt: '2026-09-16T20:00:00.000Z',
  weeks: Array.from({ length: 15 }, (_, index) => ({
    week: index + 1, status: index === 0 ? 'final' : 'upcoming',
    matchups: [{ id: String(index), sides: [{ team: teams[0], points: 123.45 }, { team: teams[1], points: 98.76 }] }],
  })),
};
describe('manager schedule display', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it.each(['league1', 'league2', 'dynasty'] as const)('shows the viewed owner for only Weeks 1–14 with scoped tabs in %s', leagueKey => {
    const site = LEAGUE_SITES[leagueKey];
    const html = renderToStaticMarkup(<LeagueSiteProvider site={site}><ManagerScheduleView data={data} /></LeagueSiteProvider>);
    expect(html.match(/data-schedule-week=/gu)).toHaveLength(14);
    expect(html).not.toContain('Week 15');
    expect(html.match(/data-schedule-side="my-team">Beta/gu)).toHaveLength(14);
    expect(html).toContain('98.76 – 123.45');
    expect(html).toContain('Final · Loss');
    expect(html.match(/98.76/gu)).toHaveLength(1);
    expect(html).toContain('Upcoming');
    expect(html).toContain(`href="${site.prefix}/managers/2"`);
    expect(html).toContain(`href="${site.prefix}/managers/2/transactions"`);
    const scheduleLink = html.match(/<a\b[^>]*>Schedule<\/a>/u)?.[0];
    expect(scheduleLink).toContain(`href="${site.prefix}/managers/2/schedule"`);
    expect(scheduleLink).toContain('aria-current="page"');
    expect(html.indexOf('>Roster</a>')).toBeLessThan(html.indexOf('>Transactions</a>'));
    expect(html.indexOf('>Transactions</a>')).toBeLessThan(html.indexOf('>Schedule</a>'));
    expect(mocks.select).not.toHaveBeenCalled();
  });
});
