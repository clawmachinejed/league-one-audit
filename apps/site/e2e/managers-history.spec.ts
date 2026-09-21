import { expect, test, type Page } from '@playwright/test';
import { LEAGUE_IDS } from '../lib/config';
import { LEAGUE_SITES, leagueSiteForPathname, type LeagueKey } from '../lib/leagues';
import type { ManagersData } from '../lib/types';

const leagues = ['league1', 'league2', 'dynasty'] as const;
const name = (league: LeagueKey, manager: string) => `${league} ${manager}`;
const preferenceKey = (league: LeagueKey) => `league-one:my-team:${LEAGUE_IDS[league]}`;

function fixture(league: LeagueKey, history: boolean, unavailable: boolean): ManagersData {
  const data: ManagersData = {
    league: { season: '2026', week: 2, maxWeek: 18, rosterPositions: [] }, updatedAt: '2026-09-20T12:00:00Z',
    teams: [
      { id: 1, name: name(league, 'Team Alpha'), managerName: name(league, 'Current Alpha'), avatar: null,
        wins: 1, losses: 0, ties: 0, pointsFor: 100, pointsAgainst: 90,
        championshipYears: [2025], promotionChampionshipYears: [2023] },
      { id: 2, name: name(league, 'Team Beta'), managerName: name(league, 'Current Beta'), avatar: null,
        wins: 0, losses: 1, ties: 0, pointsFor: 90, pointsAgainst: 100,
        championshipYears: [], promotionChampionshipYears: [] },
    ],
  };
  if (history) data.history = { label: `${league === 'league1' ? 2024 : 2025}–2026 · Regular season · Weeks 1–14`,
    ...(unavailable ? { warning: '2025 history is incomplete. Verify the missing official results.' } : {}),
    managers: [
      { ownerId: 'alpha', currentTeamId: 1, managerName: name(league, 'Current Alpha'), avatar: null,
        wins: unavailable ? null : league === 'league1' ? 19 : 11, losses: unavailable ? null : league === 'league1' ? 9 : 3, ties: unavailable ? null : 1,
        seasons: league === 'league1' ? [2024, 2025, 2026] : [2025, 2026], championshipYears: [2025], promotionChampionshipYears: [2023] },
      { ownerId: 'former', currentTeamId: null, managerName: name(league, 'Former Gamma'), avatar: null,
        wins: unavailable ? null : 8, losses: unavailable ? null : 6, ties: unavailable ? null : 0,
        seasons: [league === 'league1' ? 2024 : 2025], championshipYears: [2019], promotionChampionshipYears: [2020] },
    ] };
  return data;
}

async function installFixtures(page: Page, unavailable = false) {
  const state = { providerRequests: [] as string[], historyLoads: 0 };
  await page.addInitScript(ids => {
    for (const league of ['league1', 'league2', 'dynasty'] as const) {
      localStorage.setItem(`league-one:my-team:${ids[league]}`, '1');
    }
  }, LEAGUE_IDS);
  page.on('request', request => {
    if (/api\.sleeper\.|tank01/iu.test(new URL(request.url()).hostname)) state.providerRequests.push(request.url());
  });
  // Use the actual directory routes and components; replace only the RSC props
  // in browser navigation, following the existing manager Schedule regression.
  await page.route(/\/(?:(?:league2|dynasty)\/)?managers(?:\?|$)/u, async route => {
    if (route.request().headers().rsc !== '1') return route.continue();
    if (route.request().headers()['next-router-prefetch'] === '1') return route.abort();
    const url = new URL(route.request().url());
    const league = leagueSiteForPathname(url.pathname).key;
    const history = url.searchParams.get('view') === 'history';
    const response = await route.fetch();
    let replaced = 0;
    const replaceProps = (value: unknown): void => {
      if (!value || typeof value !== 'object') return;
      if (!Array.isArray(value)) {
        const object = value as Record<string, unknown>;
        const data = object.data as Record<string, unknown> | undefined;
        if (data && Array.isArray(data.teams) && 'league' in data && 'updatedAt' in data
          && !('team' in data) && !('matchups' in data)) {
          object.data = fixture(league, history, unavailable);
          object.rollover = null;
          replaced += 1;
          return;
        }
      }
      for (const child of Object.values(value)) replaceProps(child);
    };
    const body = (await response.text()).split('\n').map(line => {
      const split = line.indexOf(':');
      if (split < 0) return line;
      try {
        const value: unknown = JSON.parse(line.slice(split + 1));
        replaceProps(value);
        return `${line.slice(0, split + 1)}${JSON.stringify(value)}`;
      } catch { return line; }
    }).join('\n');
    expect(replaced, 'The real manager directory must contain exactly one client prop set').toBe(1);
    if (history) state.historyLoads += replaced;
    await route.fulfill({ response, body });
  });
  return state;
}

async function expectNoOverflow(page: Page) {
  for (const width of [360, 390]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
  }
}

test('Managers History and current season preserve records, honors, profile identity and preferences in all three leagues', async ({ page }) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await installFixtures(page);
  for (const league of leagues) {
    const path = `${LEAGUE_SITES[league].prefix}/managers`;
    await page.goto(path, { waitUntil: 'networkidle' });
    const tabs = page.getByRole('tablist', { name: 'Manager views' });
    await expect(tabs.getByRole('tab')).toHaveText(['2026', 'History']);
    const historyTab = tabs.getByRole('tab', { name: 'History', exact: true });
    const seasonTab = tabs.getByRole('tab', { name: '2026', exact: true });
    await expect(seasonTab).toHaveAttribute('aria-selected', 'true');
    await historyTab.click();
    await expect(page).toHaveURL(new RegExp(`${path}\\?view=history$`, 'u'));
    await expect(historyTab).toHaveAttribute('aria-selected', 'true');
    const history = page.getByRole('tabpanel', { name: 'History', exact: true });
    await expect(history).toBeVisible();
    await expect(history.getByText(`${league === 'league1' ? 2024 : 2025}–2026 · Regular season · Weeks 1–14`, { exact: true })).toBeVisible();
    await expect(history.locator('.manager-card-team')).toHaveCount(0);
    await expect(history.getByText(name(league, 'Team Alpha'), { exact: true })).toHaveCount(0);
    await expect(history.getByText(name(league, 'Team Beta'), { exact: true })).toHaveCount(0);
    const current = history.locator('.manager-card').filter({ has: page.getByText(name(league, 'Current Alpha'), { exact: true }) });
    const former = history.locator('.manager-card').filter({ has: page.getByText(name(league, 'Former Gamma'), { exact: true }) });
    await expect(current.locator('.manager-card-record')).toContainText(league === 'league1' ? '19–9–1' : '11–3–1');
    await expect(former.locator('.manager-card-record')).toContainText('8–6');
    await expect(current.getByRole('link')).toHaveAttribute('href', `${path}/1`);
    await expect(current).toHaveClass(/selected-manager/u);
    await expect(former.getByRole('link')).toHaveCount(0);
    await expect(former.getByRole('img', { name: '1 League One championship: 2019', exact: true })).toBeVisible();
    await expect(former.getByRole('img', { name: '1 League Two championship: 2020', exact: true })).toBeVisible();
    await expect(current.getByRole('img', { name: '1 League One championship: 2025', exact: true })).toBeVisible();
    await expect(current.getByRole('img', { name: '1 League Two championship: 2023', exact: true })).toBeVisible();
    await expectNoOverflow(page);
    await seasonTab.click();
    await expect(page).toHaveURL(new RegExp(`${path}$`, 'u'));
    await expect(seasonTab).toHaveAttribute('aria-selected', 'true');
    const season = page.getByRole('tabpanel', { name: '2026', exact: true });
    await expect(season.getByText(name(league, 'Team Alpha'), { exact: true })).toBeVisible();
    await expect(season.getByText(name(league, 'Team Beta'), { exact: true })).toBeVisible();
    await expect(season.getByText(name(league, 'Former Gamma'), { exact: true })).toHaveCount(0);
    await expect(season.locator('.manager-card').first().getByRole('link')).toHaveAttribute('href', `${path}/1`);
    await expectNoOverflow(page);
    expect(await page.evaluate(key => localStorage.getItem(key), preferenceKey(league))).toBe('1');
  }
  expect(state.historyLoads).toBe(3);
  expect(state.providerRequests).toEqual([]);
});

test('Managers tabs preserve keyboard focus and show incomplete historical records honestly in all three leagues', async ({ page }) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 360, height: 844 });
  const state = await installFixtures(page, true);
  for (const league of leagues) {
    const path = `${LEAGUE_SITES[league].prefix}/managers`;
    await page.goto(path, { waitUntil: 'networkidle' });
    const tabs = page.getByRole('tablist', { name: 'Manager views' });
    const historyTab = tabs.getByRole('tab', { name: 'History', exact: true });
    const seasonTab = tabs.getByRole('tab', { name: '2026', exact: true });
    await seasonTab.focus();
    await page.keyboard.press('End');
    await expect(historyTab).toHaveAttribute('aria-selected', 'true');
    await expect(historyTab).toBeFocused();
    const history = page.getByRole('tabpanel', { name: 'History', exact: true });
    await expect(history.getByText('2025 history is incomplete. Verify the missing official results.', { exact: true })).toBeVisible();
    await expect(history.locator('.manager-card-record')).toHaveText(['—RECORD', '—RECORD']);
    await expect(history.getByText('0–0', { exact: false })).toHaveCount(0);
    await page.keyboard.press('Home');
    await expect(seasonTab).toHaveAttribute('aria-selected', 'true');
    await expect(seasonTab).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(historyTab).toHaveAttribute('aria-selected', 'true');
    await expect(historyTab).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(seasonTab).toHaveAttribute('aria-selected', 'true');
    await expect(seasonTab).toBeFocused();
    await expect(page).toHaveURL(new RegExp(`${path}$`, 'u'));
    expect(await page.evaluate(key => localStorage.getItem(key), preferenceKey(league))).toBe('1');
  }
  expect(state.providerRequests).toEqual([]);
});
