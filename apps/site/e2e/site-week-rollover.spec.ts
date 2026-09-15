import { expect, test, type Page } from '@playwright/test';
import type { MatchupPeriodContext } from '../lib/matchup-period';
import type { RostersData, StandingsData } from '../lib/types';
import { snapshotFixture, snapshotHeaders, SNAPSHOT_A } from '../test-support/matchup-snapshot-fixtures';

const CUTOFF = '2026-09-15T16:00:00.000Z';
const BEFORE = '2026-09-15T15:59:58.000Z';

async function visibility(page: Page, visible: boolean) {
  await page.evaluate(value => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => value ? 'visible' : 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  }, visible);
}

async function openCalendar(page: Page, league: 'league1' | 'league2', target: 'matchups' | 'standings') {
  await page.setViewportSize({ width: 390, height: 844 });
  const prefix = league === 'league2' ? '/league2' : '';
  const state = { currentWeek: 1, navigations: [] as Array<{ path: string; week: number | null }>, rosterRequests: [] as number[] };
  const context = (week: number): MatchupPeriodContext => ({ defaultSeason: 2026, defaultWeek: state.currentWeek,
    activeSeason: 2026, activeWeek: state.currentWeek, lifecycle: 'active', nflPhase: 'regular',
    temporalState: week < state.currentWeek ? 'past' : week > state.currentWeek ? 'future' : 'active', refreshDue: false });
  const rollover = () => ({ week: state.currentWeek,
    nextRolloverAt: state.currentWeek === 1 ? CUTOFF : state.currentWeek === 2 ? '2026-09-22T16:00:00.000Z' : '2026-09-29T16:00:00.000Z',
    evaluatedAt: state.currentWeek === 1 ? BEFORE : state.currentWeek === 2 ? CUTOFF : '2026-09-22T16:00:00.000Z' });
  await page.clock.install({ time: new Date(Date.parse(BEFORE) - 60_000) });
  // Existing application modules, with controlled RSC transport only. No test route,
  // server clock override, provider request or production data mutation is introduced.
  await page.route(/\/(?:league2\/)?(?:matchups|standings)(?:\?|$)/u, async route => {
    if (route.request().headers().rsc !== '1') return route.continue();
    if (route.request().headers()['next-router-prefetch'] === '1') return route.abort();
    const url = new URL(route.request().url());
    const requested = url.searchParams.get('week');
    const week = requested === null ? state.currentWeek : Number(requested);
    state.navigations.push({ path: url.pathname, week: requested === null ? null : week });
    const response = await route.fetch();
    let replacements = 0;
    function replaceProps(value: unknown): void {
      if (!value || typeof value !== 'object') return;
      if (!Array.isArray(value)) {
        const props = value as Record<string, unknown>;
        if ('snapshotRevision' in props && 'periodContext' in props && 'data' in props) {
          const data = snapshotFixture(week);
          data.updatedAt = state.currentWeek === 1 ? BEFORE : CUTOFF;
          Object.assign(props, { data, periodContext: context(week), snapshotRevision: SNAPSHOT_A,
            verifiedAt: data.updatedAt, followCurrent: requested === null, rollover: rollover() });
          replacements += 1;
          return;
        }
        if ('projectionSource' in props && 'data' in props) {
          const source = snapshotFixture(state.currentWeek);
          const data: StandingsData = { ...source, teams: source.teams.map(team => ({ ...team,
            waiverOrder: null, waiverBudgetRemaining: null })), projectionBasis: { kind: 'unavailable', reason: 'Fixture history unavailable.' } };
          Object.assign(props, { data, projectionSource: null, rollover: rollover() });
          replacements += 1;
          return;
        }
      }
      Object.values(value).forEach(replaceProps);
    }
    const body = (await response.text()).split('\n').map(line => {
      const separator = line.indexOf(':');
      if (separator < 0) return line;
      try {
        const value: unknown = JSON.parse(line.slice(separator + 1));
        replaceProps(value);
        return `${line.slice(0, separator + 1)}${JSON.stringify(value)}`;
      } catch { return line; }
    }).join('\n');
    expect(replacements, 'Expected one real page component to receive calendar fixture props').toBe(1);
    await route.fulfill({ response, body });
  });
  await page.route('**/api/matchups/**', async route => {
    const url = new URL(route.request().url());
    const week = Number(url.searchParams.get('week'));
    const data = snapshotFixture(week);
    data.updatedAt = state.currentWeek === 1 ? BEFORE : CUTOFF;
    const headers = Object.fromEntries(snapshotHeaders(SNAPSHOT_A, data.updatedAt, context(week)));
    await route.fulfill({ status: 200, headers, json: url.pathname.endsWith('/revision')
      ? { status: 'ok', revision: SNAPSHOT_A, verifiedAt: data.updatedAt } : data });
  });
  await page.route('**/api/rosters/*?week=*', async route => {
    const week = Number(new URL(route.request().url()).searchParams.get('week'));
    state.rosterRequests.push(week);
    const source = snapshotFixture(state.currentWeek);
    const payload: RostersData = { league: source.league, week, currentWeek: state.currentWeek,
      updatedAt: CUTOFF, rostersAvailable: true,
      playerMetrics: { status: 'unavailable', observedAt: null, throughWeek: null },
      teams: source.teams.map(team => ({ ...team, waiverOrder: null, waiverBudgetRemaining: null,
        standingsRank: null, averagePpg: null, averagePpgRank: null, rosterAvailable: true, sections: [] })) };
    await route.fulfill({ status: 200, headers: { 'X-Roster-League': league,
      'X-Roster-Provisional-Week': week < state.currentWeek ? 'none' : String(state.currentWeek) }, json: payload });
  });
  await page.goto(`${prefix}/managers`, { waitUntil: 'networkidle' });
  await page.getByRole('navigation', { name: 'Mobile navigation' }).getByRole('link', {
    name: target === 'matchups' ? 'Matchups' : 'League', exact: true,
  }).click();
  if (target === 'standings') await page.getByRole('tab', { name: 'Rosters', exact: true }).click();
  await expect(page.getByRole('combobox', { name: target === 'matchups' ? 'Matchup week' : 'Roster week', exact: true })).toHaveValue('1');
  await page.clock.pauseAt(new Date(BEFORE));
  return state;
}

for (const league of ['league1', 'league2'] as const) {
  test(`${league} follows Current at noon without pinning a numeric week`, async ({ page }) => {
    const state = await openCalendar(page, league, 'matchups');
    const initialRequests = state.navigations.length;
    state.currentWeek = 2;
    await page.clock.runFor(1_999);
    expect(state.navigations).toHaveLength(initialRequests);
    await page.clock.runFor(1);
    await expect(page.getByRole('combobox', { name: 'Matchup week', exact: true })).toHaveValue('2');
    expect(new URL(page.url()).searchParams.has('week')).toBe(false);
    expect(state.navigations.at(-1)?.week).toBeNull();
    await expect(page.getByRole('combobox', { name: 'Matchup week' }).locator('option:checked')).toContainText('Current');
  });
}

test('an explicit future matchup stays selected through rollover and Current returns to the unpinned route', async ({ page }) => {
  const state = await openCalendar(page, 'league1', 'matchups');
  await page.getByRole('combobox', { name: 'Matchup week' }).selectOption('3');
  await expect(page).toHaveURL(/\/matchups\?week=3/u);
  state.currentWeek = 2;
  await page.clock.runFor(2_000);
  await expect(page.getByRole('combobox', { name: 'Matchup week' })).toHaveValue('3');
  await expect(page.getByRole('combobox', { name: 'Matchup week' }).locator('option[value="2"]')).toContainText('Current');
  await expect(page.getByRole('link', { name: 'Back to current', exact: true })).toHaveAttribute('href', '/matchups');
  await page.getByRole('link', { name: 'Back to current', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Matchup week' })).toHaveValue('2');
  expect(new URL(page.url()).searchParams.has('week')).toBe(false);
});

test('hidden Rosters catches up on return without waiting for hourly statistics capture', async ({ page }) => {
  const state = await openCalendar(page, 'league2', 'standings');
  const initialRequests = state.navigations.length;
  state.currentWeek = 2;
  await visibility(page, false);
  await page.clock.runFor(2_000);
  expect(state.navigations).toHaveLength(initialRequests);
  expect(state.rosterRequests).toEqual([1]);
  await visibility(page, true);
  await expect(page.getByRole('combobox', { name: 'Roster week' })).toHaveValue('2');
  await expect.poll(() => state.rosterRequests).toEqual([1, 2]);
  await expect(page.getByRole('tab', { name: 'Rosters', exact: true })).toHaveAttribute('aria-selected', 'true');
});

test('an explicitly selected roster week stays pinned when it becomes current and later becomes historical', async ({ page }) => {
  const state = await openCalendar(page, 'league1', 'standings');
  const picker = page.getByRole('combobox', { name: 'Roster week' });
  await picker.selectOption('2');
  await expect.poll(() => state.rosterRequests).toEqual([1, 2]);
  state.currentWeek = 2;
  await page.clock.runFor(2_000);
  await expect(picker.locator('option[value="2"]')).toContainText('Current');
  await expect(picker).toHaveValue('2');
  state.currentWeek = 3;
  await visibility(page, false);
  await page.clock.setSystemTime(new Date('2026-09-22T16:00:01.000Z'));
  await visibility(page, true);
  await expect(picker.locator('option[value="3"]')).toContainText('Current');
  await expect(picker).toHaveValue('2');
});
