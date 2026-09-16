import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LEAGUE_SITES } from '../lib/leagues';
import type { MyTeamScheduleData } from '../lib/my-team-schedule';
import type { Team } from '../lib/types';
import { LeagueSiteProvider } from './league-context';
import { MyTeamScheduleView } from './my-team-schedule-view';

const mocks = vi.hoisted(() => ({ selected: null as number | null, select: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('./team-preference', () => ({ useTeamPreference: () => mocks }));
vi.mock('./use-site-week-rollover', () => ({ useSiteWeekRollover: vi.fn() }));

const teams: Team[] = ['Alpha', 'Beta'].map((name, index) => ({
  id: index + 1, name, managerName: name + ' owner', avatar: null,
  wins: 1, losses: 0, ties: 0, pointsFor: 100, pointsAgainst: 90,
}));
const data: MyTeamScheduleData = {
  league: { season: '2026', week: 2, maxWeek: 18, rosterPositions: [] },
  teams, updatedAt: '2026-09-15T20:00:00.000Z',
  weeks: Array.from({ length: 15 }, (_, index) => ({
    week: index + 1, status: index === 0 ? 'final' : 'upcoming',
    matchups: [{ id: String(index), sides: [{ team: teams[0], points: 123.45 }, { team: teams[1], points: 98.76 }] }],
  })),
};
function render(leagueKey: 'league1' | 'league2' = 'league1', input = data) {
  return renderToStaticMarkup(<LeagueSiteProvider site={LEAGUE_SITES[leagueKey]}>
    <MyTeamScheduleView data={input} />
  </LeagueSiteProvider>);
}
describe('My Team schedule display', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.selected = null; });
  it.each(['league1', 'league2'] as const)('shows 15 weeks and only completed results in %s', leagueKey => {
    const html = render(leagueKey);
    expect(html.match(/data-schedule-week=/gu)).toHaveLength(15);
    expect(html).not.toContain('Week 16');
    expect(html).toContain('Final · Win');
    expect(html).toContain('123.45 – 98.76');
    expect(html.match(/123.45/gu)).toHaveLength(1);
    expect(html).toContain('Upcoming');
    expect(html).toContain('role="tablist"');
    expect(html).not.toContain('<select');
    expect(mocks.select).not.toHaveBeenCalled();
  });
  it('keeps the selected team and score on the left for every week', () => {
    mocks.selected = 2;
    const html = render();
    expect(html.match(/data-schedule-side="my-team">Beta/gu)).toHaveLength(15);
    expect(html).toContain('98.76 – 123.45');
    expect(html).toContain('Final · Loss');
    expect(mocks.select).not.toHaveBeenCalled();
  });
  it('retains a missing week without inventing an opponent or result', () => {
    const html = render('league1', { ...data, weeks: data.weeks.map(week => ({ ...week, matchups: [] })) });
    expect(html.match(/data-schedule-week=/gu)).toHaveLength(15);
    expect(html).toContain('Opponent unavailable');
    expect(html).not.toContain('Final ·');
    expect(html).not.toContain('123.45');
  });
});
