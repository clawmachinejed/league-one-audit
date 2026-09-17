import { expect, test, type Page } from '@playwright/test';
import { LEAGUE_IDS } from '../lib/config';
import { LEAGUE_SITES, leagueSiteForPathname, type LeagueKey } from '../lib/leagues';
import type { MyTeamScheduleData, MyTeamScheduleWeek } from '../lib/my-team-schedule';
import type { Team } from '../lib/types';
import { snapshotFixture, SNAPSHOT_TIME } from '../test-support/matchup-snapshot-fixtures';

const preferenceKey = (league: LeagueKey) => `league-one:my-team:${LEAGUE_IDS[league]}`;
const teamName = (league: LeagueKey, side: 'Alpha' | 'Beta') => `${league} Fixture ${side}`;

function scheduleFixture(league: LeagueKey): MyTeamScheduleData & { team: Team } {
  const base = snapshotFixture(4);
  const teams = base.teams.map((team, index) => ({ ...team, name: teamName(league, index ? 'Beta' : 'Alpha') }));
  const weeks: MyTeamScheduleWeek[] = Array.from({ length: 16 }, (_, index) => {
    const week = index + 1;
    const status = week <= 3 || week === 7 || week >= 15 ? 'final' : week === 4 ? 'unknown' : 'upcoming';
    const points = week === 1 ? [90, 110] : week === 2 ? [100, 80] : week === 3 ? [0, 0]
      : week === 7 ? [72, null] : [999, 888];
    const sides: MyTeamScheduleWeek['matchups'][number]['sides'] = [
      { team: teams[0], points: points[0] }, { team: teams[1], points: points[1] },
    ];
    // The viewed owner deliberately arrives on alternating sides of the source.
    if (week % 2 === 0) sides.reverse();
    return { week, status, matchups: week === 6 ? [] : [{ id: `week-${week}`, sides }] };
  });
  return { league: base.league, teams, team: teams[1], updatedAt: SNAPSHOT_TIME, weeks };
}

async function installFixtures(page: Page) {
  const state = { scheduleLoads: { league1: 0, league2: 0, dynasty: 0 }, providerRequests: [] as string[] };
  await page.addInitScript(ids => {
    for (const league of ['league1', 'league2', 'dynasty'] as const) {
      // Every profile in this test belongs to Beta; the saved My Team is Alpha.
      localStorage.setItem(`league-one:my-team:${ids[league]}`, '1');
    }
  }, LEAGUE_IDS);
  page.on('request', request => {
    if (/api\.sleeper\.|tank01/iu.test(new URL(request.url()).hostname)) state.providerRequests.push(request.url());
  });
  // Exercise the real manager routes and client components, replacing only the
  // RSC client props, as in the existing My Team Schedule browser regression.
  await page.route(/\/(?:(?:league2|dynasty)\/)?managers\/2(?:\/(?:schedule|transactions))?(?:\?|$)/u, async route => {
    if (route.request().headers().rsc !== '1') return route.continue();
    if (route.request().headers()['next-router-prefetch'] === '1') return route.abort();
    const url = new URL(route.request().url());
    const league = leagueSiteForPathname(url.pathname).key;
    const fixture = scheduleFixture(league);
    const isSchedule = url.pathname.endsWith('/schedule');
    const isTransactions = url.pathname.endsWith('/transactions');
    const response = await route.fetch();
    let replaced = 0;
    const replaceProps = (value: unknown): void => {
      if (!value || typeof value !== 'object') return;
      if (!Array.isArray(value)) {
        const object = value as Record<string, unknown>;
        const data = object.data as Record<string, unknown> | undefined;
        const expectedField = isSchedule ? 'weeks' : isTransactions ? 'transactions' : 'starters';
        if (data && typeof data === 'object' && 'team' in data && expectedField in data) {
          const { weeks, ...profile } = fixture;
          object.data = isSchedule ? { ...profile, weeks }
            : isTransactions ? { ...profile, transactions: [] }
              : { ...profile, starters: [], bench: [], reserve: [] };
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
    expect(replaced, 'The manager route must include exactly one expected client prop set').toBe(1);
    if (isSchedule) state.scheduleLoads[league] += replaced;
    await route.fulfill({ response, body });
  });
  return state;
}

for (const league of ['league1', 'league2', 'dynasty'] as const) {
  test(`${league} manager Schedule keeps the viewed owner left for Weeks 1–14 and returns through the scoped profile tabs`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const state = await installFixtures(page);
    const prefix = LEAGUE_SITES[league].prefix;
    const profilePath = `${prefix}/managers/2`;
    await page.goto(`${prefix}/managers`, { waitUntil: 'networkidle' });
    await page.locator(`.manager-card-link[href="${profilePath}"]`).click();
    await expect(page).toHaveURL(new RegExp(`${profilePath}$`, 'u'));
    await expect(page.getByRole('heading', { name: teamName(league, 'Beta'), exact: true })).toBeVisible();
    const tabs = page.getByRole('navigation', { name: 'Team pages' });
    await expect(tabs.getByRole('link')).toHaveText(['Roster', 'Transactions', 'Schedule']);
    const rosterTab = tabs.getByRole('link', { name: 'Roster', exact: true });
    const transactionsTab = tabs.getByRole('link', { name: 'Transactions', exact: true });
    const scheduleTab = tabs.getByRole('link', { name: 'Schedule', exact: true });
    await expect(rosterTab).toHaveAttribute('aria-current', 'page');
    await expect(scheduleTab).toHaveAttribute('href', `${profilePath}/schedule`);
    expect(state.scheduleLoads[league], 'Roster navigation does not load the schedule until it is opened').toBe(0);
    await scheduleTab.click();
    await expect(page).toHaveURL(new RegExp(`${profilePath}/schedule$`, 'u'));
    await expect(scheduleTab).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('list', { name: `${teamName(league, 'Beta')} schedule, Weeks 1–14`, exact: true })).toBeVisible();

    const rows = page.locator('[data-schedule-week]');
    await expect(rows).toHaveCount(14);
    await expect(rows.getByRole('heading', { level: 2 })).toHaveText(Array.from({ length: 14 }, (_, index) => `Week ${index + 1}`));
    for (const row of await rows.all()) {
      const own = row.locator('[data-schedule-side="my-team"]');
      const opponent = row.locator('[data-schedule-side="opponent"]');
      await expect(own).toContainText(teamName(league, 'Beta'));
      expect((await own.boundingBox())!.x).toBeLessThan((await opponent.boundingBox())!.x);
    }
    await expect(rows.first().getByText('Final · Win', { exact: true })).toBeVisible();
    await expect(rows.first().getByText('110.00 – 90.00', { exact: true })).toBeVisible();
    // Result arithmetic and all states are shared with My Team. One manager
    // route additionally confirms that its owner orientation reaches them.
    if (league === 'league1') {
      await expect(rows.nth(1).getByText('Final · Loss', { exact: true })).toBeVisible();
      await expect(rows.nth(1).getByText('80.00 – 100.00', { exact: true })).toBeVisible();
      await expect(rows.nth(2).getByText('Final · Tie', { exact: true })).toBeVisible();
      await expect(rows.nth(2).getByText('0.00 – 0.00', { exact: true })).toBeVisible();
      await expect(rows.nth(3).getByText('Not final', { exact: true })).toBeVisible();
      await expect(rows.nth(4).getByText('Upcoming', { exact: true })).toBeVisible();
      await expect(rows.nth(5).getByText('Matchup unavailable', { exact: true })).toBeVisible();
      await expect(rows.nth(6).getByText('Result unavailable', { exact: true })).toBeVisible();
      await expect(rows.locator('[data-result]')).toHaveCount(3);
      await expect(rows.getByText(/999\.00|888\.00|72\.00/u)).toHaveCount(0);
    }
    for (const width of [320, 390, 760]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
      for (const tab of [rosterTab, transactionsTab, scheduleTab]) {
        expect((await tab.boundingBox())!.height).toBeGreaterThanOrEqual(32);
      }
    }

    await transactionsTab.click();
    await expect(page).toHaveURL(new RegExp(`${profilePath}/transactions$`, 'u'));
    await expect(transactionsTab).toHaveAttribute('aria-current', 'page');
    await expect(rows).toHaveCount(0);
    await expect(tabs.getByRole('link')).toHaveText(['Roster', 'Transactions', 'Schedule']);
    await scheduleTab.click();
    await expect(rows).toHaveCount(14);
    await expect(rows.first().locator('[data-schedule-side="my-team"]')).toContainText(teamName(league, 'Beta'));
    await rosterTab.click();
    await expect(page).toHaveURL(new RegExp(`${profilePath}$`, 'u'));
    await expect(rosterTab).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('heading', { name: 'Starting lineup', exact: true })).toBeVisible();
    await expect(rows).toHaveCount(0);
    expect(await page.evaluate(key => localStorage.getItem(key), preferenceKey(league))).toBe('1');
    expect(state.providerRequests).toEqual([]);
  });
}
