import { expect, test, type Page } from '@playwright/test';
import { LEAGUE_IDS } from '../lib/config';
import type { MyTeamScheduleData, MyTeamScheduleWeek } from '../lib/my-team-schedule';
import { contextFixture, snapshotFixture, SNAPSHOT_TIME } from '../test-support/matchup-snapshot-fixtures';

import { LEAGUE_SITES, leagueSiteForPathname, type LeagueKey } from '../lib/leagues';
const preferenceKey = (league: LeagueKey) => `league-one:my-team:${LEAGUE_IDS[league]}`;
const prefixFor = (league: LeagueKey) => LEAGUE_SITES[league].prefix;
const teamName = (league: LeagueKey, side: 'Alpha' | 'Beta') => `${league} Fixture ${side}`;

function scheduleFixture(league: LeagueKey): MyTeamScheduleData {
  const base = snapshotFixture(4);
  const teams = base.teams.map((team, index) => ({ ...team, name: teamName(league, index ? 'Beta' : 'Alpha') }));
  const weeks: MyTeamScheduleWeek[] = Array.from({ length: 16 }, (_, index) => {
    const week = index + 1;
    const status = week <= 3 || week === 7 || week === 16 ? 'final' : week === 4 ? 'unknown' : 'upcoming';
    const points = week === 1 ? [90, 110] : week === 2 ? [100, 80] : week === 3 ? [0, 0]
      : week === 7 ? [null, 72] : [999, 888];
    return { week, status, matchups: week === 6 ? [] : [{ id: `week-${week}`, sides: [
      { team: teams[0], points: points[0] }, { team: teams[1], points: points[1] },
    ] }] };
  });
  // Equal official standings deliberately arrive in reverse alphabetical order.
  // The unsaved display default must match the existing My Team selection rule.
  return { league: base.league, teams: [...teams].reverse(), updatedAt: SNAPSHOT_TIME, weeks };
}

async function installFixtures(page: Page, selected: Partial<Record<LeagueKey, number>> = {}) {
  const state = { scheduleLoads: { league1: 0, league2: 0, dynasty: 0 }, providerRequests: [] as string[] };
  await page.addInitScript(({ ids, choices }) => {
    for (const league of ['league1', 'league2', 'dynasty'] as const) {
      const key = `league-one:my-team:${ids[league]}`;
      const id = choices[league];
      if (id === undefined) localStorage.removeItem(key);
      else localStorage.setItem(key, String(id));
    }
  }, { ids: LEAGUE_IDS, choices: selected });
  page.on('request', request => {
    if (/api\.sleeper\.|tank01/iu.test(new URL(request.url()).hostname)) state.providerRequests.push(request.url());
  });
  // Replace only client props in real RSC navigation, as in the projected
  // standings browser tests. No fixture route or alternate application is used.
  await page.route(/\/(?:(?:league2|dynasty)\/)?my-team(?:\?|$)/u, async route => {
    if (route.request().headers().rsc !== '1') return route.continue();
    if (route.request().headers()['next-router-prefetch'] === '1') return route.abort();
    const url = new URL(route.request().url());
    const league = leagueSiteForPathname(url.pathname).key;
    const schedule = scheduleFixture(league);
    const isSchedule = url.searchParams.get('view') === 'schedule';
    const response = await route.fetch();
    let replaced = 0;
    const replaceProps = (value: unknown): void => {
      if (!value || typeof value !== 'object') return;
      if (!Array.isArray(value)) {
        const object = value as Record<string, unknown>;
        const data = object.data as Record<string, unknown> | undefined;
        if (data && typeof data === 'object' && (isSchedule ? 'weeks' in data : object.mode === 'my-team')) {
          if (isSchedule) object.data = schedule;
          else {
            const week = Number(url.searchParams.get('week') ?? '4');
            const matchups = snapshotFixture(week);
            matchups.teams = schedule.teams;
            for (const side of matchups.matchups[0].sides) side.team = schedule.teams.find(team => team.id === side.team.id)!;
            object.data = matchups;
            object.periodContext = contextFixture(url.searchParams.has('week') ? 'past' : 'active', week);
            object.snapshotRevision = null;
            object.verifiedAt = null;
          }
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
    expect(replaced, 'The real navigation must include exactly one expected client prop set').toBe(1);
    if (isSchedule) state.scheduleLoads[league] += replaced;
    await route.fulfill({ response, body });
  });
  return state;
}

async function openMyTeam(page: Page, league: LeagueKey) {
  await page.goto(`${prefixFor(league)}/managers`, { waitUntil: 'networkidle' });
  await page.getByRole('navigation', { name: 'Mobile navigation' }).getByRole('link', { name: 'My Team', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'My Team', exact: true })).toHaveAttribute('aria-selected', 'true');
}

for (const league of ['league1', 'league2', 'dynasty'] as const) {
  test(`${league} Schedule shows only Weeks 1–15, official results and selected team left, with keyboard return to the exact week`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const state = await installFixtures(page, { [league]: 2 });
    await openMyTeam(page, league);
    await expect(page.locator('[data-team-name]').first()).toHaveText(teamName(league, 'Beta'));
    const path = `${prefixFor(league)}/my-team`;
    const picker = page.getByRole('combobox', { name: 'Matchup week', exact: true });
    await picker.selectOption('5');
    await expect(page).toHaveURL(new RegExp(`${path}\\?week=5$`, 'u'));
    await expect(picker).toHaveValue('5');
    expect(state.scheduleLoads[league], 'My Team does not request the Schedule route until selected').toBe(0);

    const tabs = page.getByRole('tablist', { name: 'My Team views' });
    const myTeamTab = tabs.getByRole('tab', { name: 'My Team', exact: true });
    const scheduleTab = tabs.getByRole('tab', { name: 'Schedule', exact: true });
    await myTeamTab.focus();
    await page.keyboard.press('ArrowRight');
    await expect(page).toHaveURL(new RegExp(`${path}\\?view=schedule&week=5$`, 'u'));
    await expect(scheduleTab).toHaveAttribute('aria-selected', 'true');
    await expect(scheduleTab).toBeFocused();
    await expect(page.getByRole('tabpanel', { name: 'Schedule', exact: true })).toBeVisible();
    await expect(picker).toHaveCount(0);
    const rows = page.locator('[data-schedule-week]');
    await expect(rows).toHaveCount(15);
    await expect(rows.getByRole('heading', { level: 2 })).toHaveText(Array.from({ length: 15 }, (_, index) => `Week ${index + 1}`));
    for (const row of await rows.all()) {
      await expect(row.locator('[data-schedule-side="my-team"]')).toContainText(teamName(league, 'Beta'));
      const own = await row.locator('[data-schedule-side="my-team"]').boundingBox();
      const opponent = await row.locator('[data-schedule-side="opponent"]').boundingBox();
      expect(own!.x).toBeLessThan(opponent!.x);
    }
    await expect(rows.nth(0).getByText('Final · Win', { exact: true })).toBeVisible();
    await expect(rows.nth(0).getByText('110.00 – 90.00', { exact: true })).toBeVisible();
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
    for (const width of [320, 390, 760]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
      // Match the existing League section tabs' compact 32px minimum.
      for (const tab of [myTeamTab, scheduleTab]) expect((await tab.boundingBox())!.height).toBeGreaterThanOrEqual(32);
    }

    await scheduleTab.focus();
    await page.keyboard.press('Home');
    await expect(page).toHaveURL(new RegExp(`${path}\\?week=5$`, 'u'));
    await expect(myTeamTab).toHaveAttribute('aria-selected', 'true');
    await expect(myTeamTab).toBeFocused();
    await expect(picker).toHaveValue('5');
    await expect(rows).toHaveCount(0);
    expect(await page.evaluate(key => localStorage.getItem(key), preferenceKey(league))).toBe('2');
    expect(state.providerRequests).toEqual([]);
  });
}

test('Schedule uses the same alphabetical standings default as My Team without saving a preference', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await installFixtures(page);
  await openMyTeam(page, 'league1');
  await expect(page.locator('[data-team-name]').first()).toHaveText(teamName('league1', 'Alpha'));
  await page.getByRole('tab', { name: 'Schedule', exact: true }).click();
  await expect(page).toHaveURL(/\/my-team\?view=schedule$/u);
  await expect(page.getByRole('list', { name: 'league1 Fixture Alpha schedule, Weeks 1–15', exact: true })).toBeVisible();
  const rows = page.locator('[data-schedule-week]');
  await expect(rows.locator('[data-schedule-side="my-team"]')).toHaveCount(15);
  for (const row of await rows.all()) await expect(row.locator('[data-schedule-side="my-team"]')).toContainText(teamName('league1', 'Alpha'));
  await expect(rows.first().getByText('Final · Loss', { exact: true })).toBeVisible();
  await expect(rows.first().getByText('90.00 – 110.00', { exact: true })).toBeVisible();
  expect(await page.evaluate(key => localStorage.getItem(key), preferenceKey('league1'))).toBeNull();
  await page.getByRole('tab', { name: 'My Team', exact: true }).click();
  await expect(page).toHaveURL(/\/my-team$/u);
  await expect(page.getByRole('tab', { name: 'My Team', exact: true })).toHaveAttribute('aria-selected', 'true');
  expect(state.providerRequests).toEqual([]);
});

test('Schedule keeps saved teams isolated when switching leagues', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await installFixtures(page, { league1: 2, league2: 1 });
  await openMyTeam(page, 'league1');
  await page.getByRole('tab', { name: 'Schedule', exact: true }).click();
  await expect(page.getByRole('list', { name: 'league1 Fixture Beta schedule, Weeks 1–15', exact: true })).toBeVisible();
  const navigation = page.getByRole('navigation', { name: 'Mobile navigation' });
  await navigation.getByRole('button', { name: 'Choose league, current League One' }).click();
  await navigation.getByRole('link', { name: 'View League Two' }).click();
  await expect(page).toHaveURL(/\/league2\/my-team$/u);
  await expect(page.getByRole('tab', { name: 'My Team', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', { name: 'Schedule', exact: true }).click();
  await expect(page).toHaveURL(/\/league2\/my-team\?view=schedule$/u);
  await expect(page.getByRole('list', { name: 'league2 Fixture Alpha schedule, Weeks 1–15', exact: true })).toBeVisible();
  await expect(page.locator('[data-schedule-week]').first().getByText('Final · Loss', { exact: true })).toBeVisible();
  expect(await page.evaluate(keys => keys.map(key => localStorage.getItem(key)),
    [preferenceKey('league1'), preferenceKey('league2')])).toEqual(['2', '1']);
  expect(state.providerRequests).toEqual([]);
});
