import { expect, test, type Page } from '@playwright/test';
import { LEAGUE_IDS } from '../lib/config';
import type { RostersData } from '../lib/types';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

async function visibility(page: Page, value: 'visible' | 'hidden') {
  await page.evaluate((state) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
    document.dispatchEvent(new Event('visibilitychange'));
  }, value);
}

function rosterWeek(page: Page) {
  return page.getByRole('combobox', { name: 'Roster week', exact: true });
}

async function openRosters(page: Page, league: 'league1' | 'league2' = 'league1', weekly = false) {
  const state = {
    requests: [] as number[], points: 4.1, status: 200, rosterSuffix: '',
    observedAt: '2026-09-12T16:00:00.000Z' as string | null,
    responseLeague: league as string, responseSeason: '2026', responseWeek: null as number | null,
    activeWeek: undefined as number | null | 'unknown' | undefined,
    refreshAt: weekly ? '2026-09-15T08:00:00.000Z' : undefined as string | undefined,
    hold: null as Promise<void> | null, currentWeek: null as number | null,
  };
  await page.clock.install({ time: new Date(weekly ? '2026-09-15T07:58:00.000Z' : '2026-09-13T15:58:00.000Z') });
  await page.addInitScript((key) => localStorage.setItem(key, '2'), `league-one:my-team:${LEAGUE_IDS[league]}`);
  await page.route('**/api/rosters/*?week=*', async (route) => {
    const week = Number(new URL(route.request().url()).searchParams.get('week'));
    state.requests.push(week);
    state.currentWeek ??= week;
    const payload: RostersData = {
      league: { season: state.responseSeason, week: state.currentWeek, maxWeek: 18, rosterPositions: ['WR', 'BN'] },
      week: state.responseWeek ?? week, currentWeek: state.currentWeek, rostersAvailable: true,
      updatedAt: '2026-09-13T17:02:00.000Z',
      playerMetrics: { status: state.observedAt === null ? 'unavailable' : 'provisional', observedAt: state.observedAt, throughWeek: week },
      teams: [1, 2].map((id) => ({
        id, name: `${league} Team ${id}${state.rosterSuffix}`, managerName: `Manager ${id}`, avatar: null,
        wins: 0, losses: 0, ties: 0, pointsFor: 0,
        waiverOrder: null, waiverBudgetRemaining: null, standingsRank: null,
        averagePpg: null, averagePpgRank: null, rosterAvailable: true,
        sections: [{ name: 'Starters', players: [{
          id: '5859', name: 'A.J. Brown', position: 'WR', nflTeam: 'PHI', injuryStatus: null,
          game: null, slot: 'WR', byeWeek: 9, positionRank: 1, ppg: state.observedAt === null ? null : state.points,
        }] }, { name: 'Bench', players: [{
          id: '7527', name: 'Mac Jones', position: 'QB', nflTeam: 'SF', injuryStatus: null,
          game: null, slot: 'BN', byeWeek: 14, positionRank: null, ppg: null,
        }] }],
      })),
    };
    const status = state.status;
    const responseLeague = state.responseLeague;
    const activeWeek = state.activeWeek === undefined ? state.currentWeek : state.activeWeek;
    const provisionalWeek = state.refreshAt !== undefined ? (state.refreshAt === 'unknown' ? 'unknown' : 'none')
      : activeWeek === 'unknown' ? 'unknown'
      : activeWeek !== null && week >= activeWeek ? String(activeWeek) : 'none';
    if (state.hold) await state.hold;
    await route.fulfill({ status, headers: { 'X-Roster-League': responseLeague, 'X-Roster-Provisional-Week': provisionalWeek,
      ...(state.refreshAt === undefined ? {} : { 'X-Roster-Metrics-Refresh-At': state.refreshAt }) },
      json: status === 200 ? payload : { error: 'Roster service unavailable.' } });
  });
  await page.goto(`${league === 'league2' ? '/league2' : ''}/standings`, { waitUntil: 'networkidle' });
  await expect(page.getByRole('tab', { name: 'Rosters', exact: true })).toBeVisible({ timeout: 30_000 });
  await page.clock.pauseAt(new Date(weekly ? '2026-09-15T07:59:00.000Z' : '2026-09-13T15:59:00.000Z'));
  await page.getByRole('tab', { name: 'Rosters', exact: true }).click();
  await expect(page.locator('[data-roster-card]')).toHaveCount(2);
  await expect(rosterWeek(page)).toHaveCount(1);
  return state;
}

for (const league of ['league1', 'league2'] as const) {
  test(`${league} refreshes weekly metrics at 4 AM Eastern and keeps roster metadata fresh between boundaries`, async ({ page }) => {
    const state = await openRosters(page, league, true);
    const cards = page.locator('[data-roster-card]');
    await expect(cards.first()).toHaveAttribute('data-team-id', '2');
    await cards.first().locator('[data-roster-toggle]').click();
    await cards.nth(1).locator('[data-roster-toggle]').click();
    const selectedWeek = await rosterWeek(page).inputValue();
    await expect(page.locator('[data-player-stats-updated]')).toContainText(`PPG and Pos Rank through Week ${selectedWeek} · Updated weekly`);
    state.points = 7.3;
    state.refreshAt = '2026-09-22T08:00:00.000Z';
    await page.clock.runFor(59_999);
    expect(state.requests).toHaveLength(1);
    await page.clock.runFor(1);
    await expect.poll(() => state.requests.length).toBe(2);
    await expect(cards.locator('[data-player-ppg]')).toHaveText(['7.3', '—', '7.3', '—']);
    await expect(cards.locator('[data-roster-toggle][aria-expanded="true"]')).toHaveCount(2);
    await expect(cards.first()).toHaveAttribute('data-team-id', '2');
    await expect(rosterWeek(page)).toHaveValue(selectedWeek);
    await page.clock.runFor(3 * 3_600_000);
    expect(state.requests).toHaveLength(2);
    await expect(cards.locator('[data-player-ppg]')).toHaveText(['7.3', '—', '7.3', '—']);
    state.rosterSuffix = ' Updated';
    await page.clock.runFor(5 * 3_600_000 + 180_000);
    await expect.poll(() => state.requests.length).toBe(3);
    await expect(cards.first().getByText(`${league} Team 2 Updated`, { exact: true })).toBeVisible();
    await expect(cards.locator('[data-player-ppg]')).toHaveText(['7.3', '—', '7.3', '—']);
    await expect(cards.locator('[data-roster-toggle][aria-expanded="true"]')).toHaveCount(2);
  });
}

test('weekly refresh stays quiet while hidden or off-tab and refreshes selected past and future weeks at the next boundary', async ({ page }) => {
  const state = await openRosters(page, 'league1', true);
  await page.locator('[data-roster-toggle]').first().click();
  await visibility(page, 'hidden');
  await page.clock.runFor(60_000);
  expect(state.requests).toHaveLength(1);
  state.refreshAt = '2026-09-22T08:00:00.000Z';
  state.points = 5.2;
  await visibility(page, 'visible');
  await expect.poll(() => state.requests.length).toBe(2);
  await expect(page.locator('[data-player-ppg]')).toHaveText(['5.2', '—', '5.2', '—']);
  await expect(page.locator('[data-roster-toggle][aria-expanded="true"]')).toHaveCount(1);
  state.points = 5.8;
  await rosterWeek(page).selectOption('18');
  await expect.poll(() => state.requests.length).toBe(3);
  await expect(page.locator('[data-player-ppg]')).toHaveText(['5.8', '—', '5.8', '—']);
  await expect(rosterWeek(page)).toHaveValue('18');
  await page.getByRole('tab', { name: 'Standings', exact: true }).click();
  await page.clock.fastForward(7 * 24 * 3_600_000);
  expect(state.requests).toHaveLength(3);
  state.refreshAt = '2026-09-29T08:00:00.000Z';
  state.points = 6.4;
  await page.getByRole('tab', { name: 'Rosters', exact: true }).click();
  await expect.poll(() => state.requests.length).toBe(4);
  await expect(page.locator('[data-player-ppg]')).toHaveText(['6.4', '—', '6.4', '—']);
  await expect(rosterWeek(page)).toHaveValue('18');
  state.points = 7;
  await rosterWeek(page).selectOption('1');
  await expect.poll(() => state.requests.length).toBe(5);
  await expect(page.locator('[data-player-ppg]')).toHaveText(['7.0', '—', '7.0', '—']);
  await expect(rosterWeek(page)).toHaveValue('1');
  state.points = 8.5;
  state.refreshAt = '2026-10-06T08:00:00.000Z';
  await page.clock.fastForward(7 * 24 * 3_600_000);
  await expect.poll(() => state.requests.length).toBe(6);
  await expect(page.locator('[data-player-ppg]')).toHaveText(['8.5', '—', '8.5', '—']);
  expect(state.requests.at(-1)).toBe(1);
});

test('failed, unknown and expired weekly boundaries retain saved metrics and retry at most hourly, then stop at season end', async ({ page }) => {
  const state = await openRosters(page, 'league1', true);
  state.status = 503;
  await page.clock.runFor(60_000);
  await expect.poll(() => state.requests.length).toBe(2);
  await expect(page.getByText(/Showing the last saved roster/u)).toBeVisible();
  await expect(page.locator('[data-player-ppg]')).toHaveText(['4.1', '—', '4.1', '—']);
  await page.clock.runFor(3_599_999);
  expect(state.requests).toHaveLength(2);
  state.status = 200;
  state.points = 6.4;
  state.refreshAt = 'unknown';
  await page.clock.runFor(1);
  await expect.poll(() => state.requests.length).toBe(3);
  await expect(page.locator('[data-player-ppg]')).toHaveText(['6.4', '—', '6.4', '—']);
  state.refreshAt = '2026-09-15T08:00:00.000Z';
  state.points = 6.8;
  await page.clock.runFor(3_600_000);
  await expect.poll(() => state.requests.length).toBe(4);
  await expect(page.locator('[data-player-ppg]')).toHaveText(['6.8', '—', '6.8', '—']);
  await page.clock.runFor(3_599_999);
  expect(state.requests).toHaveLength(4);
  state.refreshAt = 'none';
  state.points = 7.3;
  await page.clock.runFor(1);
  await expect.poll(() => state.requests.length).toBe(5);
  await expect(page.locator('[data-player-ppg]')).toHaveText(['7.3', '—', '7.3', '—']);
  await page.clock.runFor(24 * 3_600_000);
  await visibility(page, 'hidden');
  await visibility(page, 'visible');
  expect(state.requests).toHaveLength(5);
});

test('roster polling pauses while hidden or on another tab and catches up once on return; other weeks do not poll', async ({ page }) => {
  const state = await openRosters(page);
  await page.locator('[data-roster-toggle]').first().click();
  await visibility(page, 'hidden');
  await page.clock.runFor(3 * 3_600_000);
  expect(state.requests).toHaveLength(1);
  await visibility(page, 'visible');
  await expect.poll(() => state.requests.length).toBe(2);
  await expect(page.locator('[data-roster-toggle][aria-expanded="true"]')).toHaveCount(1);
  await page.getByRole('tab', { name: 'Standings', exact: true }).click();
  await page.clock.runFor(2 * 3_600_000);
  expect(state.requests).toHaveLength(2);
  await page.getByRole('tab', { name: 'Rosters', exact: true }).click();
  await expect.poll(() => state.requests.length).toBe(3);
  await expect(page.locator('[data-roster-toggle][aria-expanded="true"]')).toHaveCount(1);
  const otherWeek = state.currentWeek === 1 ? 2 : state.currentWeek! - 1;
  await rosterWeek(page).selectOption(String(otherWeek));
  await expect.poll(() => state.requests.length).toBe(4);
  await page.clock.runFor(3 * 3_600_000);
  expect(state.requests).toHaveLength(4);
  await visibility(page, 'hidden');
  await visibility(page, 'visible');
  expect(state.requests).toHaveLength(4);
});

test('a delayed current-week refresh cannot overwrite a newly selected week', async ({ page }) => {
  const state = await openRosters(page);
  const delayed = deferred();
  state.hold = delayed.promise;
  state.points = 99;
  await page.clock.runFor(240_000);
  await expect.poll(() => state.requests.length).toBe(2);
  state.hold = null;
  state.points = 18;
  await rosterWeek(page).selectOption('18');
  await expect.poll(() => state.requests.length).toBe(3);
  await expect(page.locator('[data-player-ppg]')).toHaveText(['18.0', '—', '18.0', '—']);
  delayed.resolve();
  await page.clock.runFor(1);
  await expect(rosterWeek(page)).toHaveValue('18');
  await expect(page.locator('[data-player-ppg]')).toHaveText(['18.0', '—', '18.0', '—']);
});

for (const mismatch of ['league', 'season', 'week'] as const) {
  test(`a refreshed roster with the wrong ${mismatch} is rejected without replacing saved metrics`, async ({ page }) => {
    const state = await openRosters(page);
    if (mismatch === 'league') state.responseLeague = 'league2';
    if (mismatch === 'season') state.responseSeason = '2027';
    if (mismatch === 'week') state.responseWeek = 18;
    state.points = 99;
    await page.clock.runFor(240_000);
    await expect.poll(() => state.requests.length).toBe(2);
    await expect(page.getByText(/did not match this league, season, and week/u)).toBeVisible();
    await expect(page.locator('[data-player-ppg]')).toHaveText(['4.1', '—', '4.1', '—']);
  });
}

test('an overdue roster request times out without erasing saved data or causing an immediate retry', async ({ page }) => {
  const state = await openRosters(page);
  const delayed = deferred();
  state.hold = delayed.promise;
  state.points = 99;
  await page.clock.runFor(240_000);
  await expect.poll(() => state.requests.length).toBe(2);
  await page.clock.runFor(15_000);
  await expect(page.getByText(/roster refresh timed out/u)).toBeVisible();
  await expect(page.locator('[data-player-ppg]')).toHaveText(['4.1', '—', '4.1', '—']);
  delayed.resolve();
  await page.clock.runFor(60_000);
  expect(state.requests).toHaveLength(2);
  await expect(page.locator('[data-player-ppg]')).toHaveText(['4.1', '—', '4.1', '—']);
});

test('an unavailable or older metric read preserves the saved statistics and their source time', async ({ page }) => {
  const state = await openRosters(page);
  state.observedAt = null;
  state.points = 99;
  await page.clock.runFor(240_000);
  await expect.poll(() => state.requests.length).toBe(2);
  await expect(page.getByText(/Updated player statistics are temporarily unavailable/u)).toBeVisible();
  await expect(page.locator('[data-player-ppg]')).toHaveText(['4.1', '—', '4.1', '—']);
  await expect(page.locator('[data-player-stats-updated]')).toHaveAttribute('title', 'Player stats saved Sep 12, 12:00 PM ET');
  state.observedAt = '2026-09-11T16:00:00.000Z';
  await page.clock.runFor(3_600_000);
  await expect.poll(() => state.requests.length).toBe(3);
  await expect(page.getByText(/Updated player statistics are temporarily unavailable/u)).toBeVisible();
  await expect(page.locator('[data-player-ppg]')).toHaveText(['4.1', '—', '4.1', '—']);
});

test('an open current roster follows validated week rollover and keeps refreshing even when prior-week scoring is unavailable', async ({ page }) => {
  const state = await openRosters(page);
  const priorWeek = state.currentWeek!;
  const newWeek = priorWeek + 1;
  state.currentWeek = newWeek;
  state.observedAt = null;
  await page.clock.runFor(240_000);
  await expect.poll(() => state.requests.length).toBe(3);
  expect(state.requests).toEqual([priorWeek, priorWeek, newWeek]);
  await expect(rosterWeek(page)).toHaveValue(String(newWeek));
  await expect(rosterWeek(page).locator('option:checked')).toContainText('Current');
  await expect(page.locator('[data-roster-card]').first()).toHaveAttribute('data-team-id', '2');
  state.points = 8.5;
  state.observedAt = '2026-09-13T17:02:40.000Z';
  await page.clock.runFor(3_600_000);
  await expect.poll(() => state.requests.length).toBe(4);
  expect(state.requests.at(-1)).toBe(newWeek);
  await expect(page.locator('[data-player-ppg]')).toHaveText(['8.5', '—', '8.5', '—']);
  // An old authority response cannot move the selector back after advancement.
  state.currentWeek = priorWeek;
  state.points = 99;
  await page.clock.runFor(3_600_000);
  await expect.poll(() => state.requests.length).toBe(5);
  await expect(page.getByText(/contained an older current week/u)).toBeVisible();
  await expect(rosterWeek(page)).toHaveValue(String(newWeek));
  await expect(page.locator('[data-player-ppg]')).toHaveText(['8.5', '—', '8.5', '—']);
});

test('fresh current-week authority preserves an explicit other-week selection and Back to current starts its polling', async ({ page }) => {
  const state = await openRosters(page);
  const newWeek = state.currentWeek! + 1;
  state.currentWeek = newWeek;
  await rosterWeek(page).selectOption('18');
  await expect.poll(() => state.requests.length).toBe(2);
  await expect(rosterWeek(page)).toHaveValue('18');
  await expect(rosterWeek(page).locator(`option[value="${newWeek}"]`)).toContainText('Current');
  await page.clock.runFor(240_000);
  expect(state.requests).toHaveLength(2);
  await page.getByRole('button', { name: 'Back to current', exact: true }).click();
  await expect.poll(() => state.requests.length).toBe(3);
  await expect(rosterWeek(page)).toHaveValue(String(newWeek));
  state.points = 7.3;
  await page.clock.runFor(3_600_000);
  await expect.poll(() => state.requests.length).toBe(4);
  expect(state.requests.at(-1)).toBe(newWeek);
  await expect(page.locator('[data-player-ppg]')).toHaveText(['7.3', '—', '7.3', '—']);
});

test('a selected active week keeps refreshing behind the display week, survives unknown authority, and stops when proved historical', async ({ page }) => {
  const state = await openRosters(page);
  const activeWeek = state.currentWeek!;
  state.currentWeek = activeWeek + 1;
  state.activeWeek = activeWeek;
  await page.clock.runFor(240_000);
  await expect.poll(() => state.requests.length).toBe(3);
  await expect(rosterWeek(page)).toHaveValue(String(activeWeek + 1));
  await rosterWeek(page).selectOption(String(activeWeek));
  await expect(page.locator('[data-roster-card]')).toHaveCount(2);
  state.points = 6.4;
  await page.clock.runFor(3_600_000);
  await expect.poll(() => state.requests.length).toBe(4);
  expect(state.requests.at(-1)).toBe(activeWeek);
  await expect(rosterWeek(page)).toHaveValue(String(activeWeek));
  await expect(page.locator('[data-player-ppg]')).toHaveText(['6.4', '—', '6.4', '—']);

  state.activeWeek = 'unknown';
  state.observedAt = null;
  await page.clock.runFor(3_600_000);
  await expect.poll(() => state.requests.length).toBe(5);
  await expect(page.getByText(/Updated player statistics are temporarily unavailable/u)).toBeVisible();
  state.activeWeek = activeWeek;
  state.observedAt = '2026-09-13T19:02:00.000Z';
  state.points = 7.3;
  await page.clock.runFor(3_600_000);
  await expect.poll(() => state.requests.length).toBe(6);
  await expect(page.locator('[data-player-ppg]')).toHaveText(['7.3', '—', '7.3', '—']);

  state.activeWeek = activeWeek + 1;
  await page.clock.runFor(3_600_000);
  await expect.poll(() => state.requests.length).toBe(7);
  await expect(rosterWeek(page)).toHaveValue(String(activeWeek));
  await page.clock.runFor(2 * 3_600_000);
  expect(state.requests).toHaveLength(7);
});

test('a proved completed display week stops automatic roster requests', async ({ page }) => {
  const state = await openRosters(page);
  state.activeWeek = null;
  state.points = 6.4;
  await page.clock.runFor(240_000);
  await expect.poll(() => state.requests.length).toBe(2);
  // Request counts advance before the response is adopted. Prove the completed
  // response reached the UI before advancing through future polling deadlines.
  await expect(page.locator('[data-player-ppg]')).toHaveText(['6.4', '—', '6.4', '—']);
  await page.clock.runFor(3 * 3_600_000);
  expect(state.requests).toHaveLength(2);
  await visibility(page, 'hidden');
  await visibility(page, 'visible');
  expect(state.requests).toHaveLength(2);
});
