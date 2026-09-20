import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LEAGUE_SITES, type LeagueKey } from '../lib/leagues';
import type { ManagersData } from '../lib/types';
import { LeagueSiteProvider } from './league-context';
import { ManagersView } from './managers-view';

const mocks = vi.hoisted(() => ({ selected: 1, select: vi.fn(), storageWarning: '' }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('./team-preference', () => ({ useTeamPreference: () => mocks, useTeamPreferenceContext: () => mocks }));
vi.mock('./use-site-week-rollover', () => ({ useSiteWeekRollover: vi.fn() }));

function fixture(history = false): ManagersData {
  const data: ManagersData = {
    league: { season: '2026', week: 2, maxWeek: 18, rosterPositions: [] }, updatedAt: '2026-09-20T12:00:00Z',
    teams: [
      { id: 1, name: 'Current Team Alpha', managerName: 'Current Alpha', avatar: null,
        wins: 1, losses: 0, ties: 0, pointsFor: 110, pointsAgainst: 90,
        championshipYears: [2025], promotionChampionshipYears: [2023] },
      { id: 2, name: 'Current Team Beta', managerName: 'Current Beta', avatar: null,
        wins: 0, losses: 1, ties: 0, pointsFor: 90, pointsAgainst: 110,
        championshipYears: [], promotionChampionshipYears: [] },
    ],
  };
  if (history) data.history = { label: '2025–2026 · Regular season · Weeks 1–14', managers: [
    { ownerId: 'owner-alpha', currentTeamId: 1, managerName: 'Current Alpha', avatar: null,
      wins: 11, losses: 3, ties: 1, seasons: [2025, 2026], championshipYears: [2025], promotionChampionshipYears: [2023] },
    { ownerId: 'owner-former', currentTeamId: null, managerName: 'Former Gamma', avatar: null,
      wins: 8, losses: 6, ties: 0, seasons: [2025], championshipYears: [2019], promotionChampionshipYears: [2020] },
  ] };
  return data;
}
const render = (league: LeagueKey, data: ManagersData) => renderToStaticMarkup(
  <LeagueSiteProvider site={LEAGUE_SITES[league]}><ManagersView data={data} /></LeagueSiteProvider>,
);

describe('manager directory season and history tabs', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(['league1', 'league2', 'dynasty'] as const)('preserves current names, profile links and selection in %s', league => {
    const html = render(league, fixture());
    expect(html).toContain('role="tablist" aria-label="Manager views"');
    expect(html.indexOf('>History</button>')).toBeLessThan(html.indexOf('>2026</button>'));
    expect(html).toContain('id="managers-season-tab" aria-controls="managers-view-panel" aria-selected="true" tabindex="0"');
    expect(html).toContain('aria-labelledby="managers-season-tab"');
    expect(html).toContain('Current Team Alpha');
    expect(html).toContain('Current Team Beta');
    expect(html).toContain('Current Alpha');
    expect(html).not.toContain('Former Gamma');
    expect(html).toContain(`href="${LEAGUE_SITES[league].prefix}/managers/1"`);
    expect(html).toContain('selected-manager');
    expect(html).toContain('1–0<small>RECORD</small>');
    expect(html).toContain('1 League One championship: 2025');
    expect(html).toContain('1 League Two championship: 2023');
    expect(mocks.select).not.toHaveBeenCalled();
  });

  it.each(['league1', 'league2', 'dynasty'] as const)('shows combined records and both honor types without team names in %s History', league => {
    const html = render(league, fixture(true));
    expect(html).toContain('id="managers-history-tab" aria-controls="managers-view-panel" aria-selected="true" tabindex="0"');
    expect(html).toContain('aria-labelledby="managers-history-tab"');
    expect(html).not.toContain('Current Team Alpha');
    expect(html).not.toContain('Current Team Beta');
    expect(html).not.toContain('manager-card-team');
    expect(html).toContain('Current Alpha');
    expect(html).toContain('Former Gamma');
    expect(html).toContain('11–3–1<small>RECORD</small>');
    expect(html).toContain('8–6<small>RECORD</small>');
    expect(html).toContain('2025–2026 · Regular season · Weeks 1–14');
    expect(html.match(/data-championship-league="league1"/gu)).toHaveLength(2);
    expect(html.match(/data-championship-league="league2"/gu)).toHaveLength(2);
    expect(html).toContain('1 League One championship: 2019');
    expect(html).toContain('1 League Two championship: 2020');
    const former = html.match(/<article[^>]*>[^]*?Former Gamma[^]*?<\/article>/u)?.[0]?.split('<article').at(-1);
    expect(former).toBeDefined();
    expect(former).not.toContain('href=');
    expect(html.match(/href=/gu)).toHaveLength(1);
    expect(html).toContain(`href="${LEAGUE_SITES[league].prefix}/managers/1"`);
    expect(mocks.select).not.toHaveBeenCalled();
  });

  it('shows unavailable combined records as a dash with the source warning, never a zero record', () => {
    const data = fixture(true);
    data.history!.warning = '2025 history is incomplete. Verify the missing official results.';
    data.history!.managers = data.history!.managers.map(manager => ({ ...manager, wins: null, losses: null, ties: null }));
    const html = render('league1', data);
    expect(html.match(/>—<small>RECORD<\/small>/gu)).toHaveLength(2);
    expect(html).not.toContain('0–0');
    expect(html).toContain('role="status"');
    expect(html).toContain('2025 history is incomplete. Verify the missing official results.');
    expect(html).toContain('title="Complete history unavailable"');
    expect(mocks.select).not.toHaveBeenCalled();
  });
});
