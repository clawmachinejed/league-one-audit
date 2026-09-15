import { expect, test, type Page } from '@playwright/test';
import { LEAGUE_IDS } from '../lib/config';
import type { MatchupPeriodContext } from '../lib/matchup-period';
import type { MatchupBoxScores } from '../lib/matchup-box-score-types';
import { isMatchupsData } from '../lib/matchups-response';
import { contextFixture, snapshotFixture, snapshotHeaders, SNAPSHOT_A, SNAPSHOT_B, SNAPSHOT_C } from '../test-support/matchup-snapshot-fixtures';

type League = 'league1' | 'league2';
// These keys identify source sides. Saved roster 2 renders on the left, so its
// receiver/defense display left and the source-left quarterback displays right.
const LEFT = 'player:fixture-player-0';
const RIGHT = 'player:fixture-player-1';
const UNKNOWN = 'player:fixture-missing';
const DEFENSE = 'defense:BAL';
const FRESH_LINEAGE = '2099-09-03T12:00:00.000Z';
const quarterbackSummary = (yards = 209) => `17/27 CMP, ${yards} YD, 1 TD, 1 INT, 5 CAR, 29 YD`;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function boardFixture(week = 1) {
  const data = snapshotFixture(week);
  data.league.rosterPositions = ['QB', 'FLEX', 'FLEX'];
  const matchup = data.matchups[0];
  matchup.status = 'live';
  const [left, right] = matchup.sides;
  left.starters[0] = { ...left.starters[0], name: 'Fixture Quarterback One', position: 'QB', slot: 'QB',
    game: { kind: 'scheduled', opponent: 'TEN', location: 'away', date: '2026-09-13', kickoffAt: '2026-09-13T17:00:00.000Z',
      liveScore: { teamScore: 7, opponentScore: 3, phase: 'q2', clockSeconds: 300 } } };
  right.starters[0] = { ...right.starters[0], name: 'Fixture Receiver Two', position: 'WR', slot: 'WR',
    game: { kind: 'scheduled', opponent: 'NYJ', location: 'home', date: '2026-09-13', kickoffAt: '2026-09-13T17:00:00.000Z',
      finalScore: { teamScore: 24, opponentScore: 17 } } };
  left.starters.push({ ...left.starters[0], id: 'fixture-missing', name: 'Fixture Missing Statistics', slot: 'FLEX' },
    { ...left.starters[0], id: 'fixture-bye', name: 'Fixture Bye Player', slot: 'FLEX', game: { kind: 'bye' } });
  right.starters.push({ ...right.starters[0], id: 'fixture-upcoming', name: 'Fixture Upcoming Player', slot: 'FLEX',
    game: { kind: 'scheduled', opponent: 'KC', location: 'away', date: '2026-09-14', kickoffAt: '2026-09-15T00:15:00.000Z' } },
  { ...right.starters[0], id: 'BAL', name: 'Baltimore Ravens', position: 'DEF', nflTeam: 'BAL', slot: 'FLEX' });
  expect(isMatchupsData(data), 'the intercepted board must pass the real snapshot boundary').toBe(true);
  return data;
}

async function openFixture(page: Page, league: League = 'league1') {
  const state = {
    passingYards: 209, boxStatus: 200, observedAt: '2026-09-13T16:00:00.000Z',
    leftPlayerId: 'fixture-player-0', snapshotRevision: SNAPSHOT_B,
    boxRequests: [] as Array<{ league: string; season: string | null; week: number; queryKeys: string[] }>,
    compactCount: 0, fullCount: 0, documentCount: 0,
    holdBox: null as Promise<void> | null, completedBoxes: 0, abortedBoxes: [] as string[], providerRequests: [] as string[],
  };
  await page.clock.install({ time: new Date('2026-09-13T16:00:00.000Z') });
  // Pause before hydration starts its interval. Advancing an existing interval
  // here could start a request that the next clock jump immediately times out.
  await page.clock.pauseAt(new Date('2026-09-13T16:01:00.000Z'));
  await page.addInitScript((keys) => keys.forEach((key) => localStorage.setItem(key, '2')),
    [LEAGUE_IDS.league1, LEAGUE_IDS.league2].map((id) => `league-one:my-team:${id}`));
  page.on('request', (request) => {
    if (/api\.sleeper\.|tank01/iu.test(new URL(request.url()).hostname)) state.providerRequests.push(request.url());
  });
  page.on('requestfailed', (request) => {
    if (new URL(request.url()).pathname.endsWith('/box-scores')) state.abortedBoxes.push(request.url());
  });
  // Real local SSR markup and data; only serialized lineage/period are controlled,
  // matching the established snapshot-polling fixture. No application test route.
  await page.route(/\/(?:league2\/)?matchups(?:\?|$)/u, async (route) => {
    if (route.request().resourceType() !== 'document') return route.continue();
    const response = await route.fetch();
    const html = await response.text();
    const dates = [...html.matchAll(/\\"updatedAt\\":\\"([^"\\]+)\\"/gu)];
    const lineage = /\\"snapshotRevision\\":(?:null|\\"[a-f0-9]{64}\\"),\\"verifiedAt\\":(?:null|\\"[^"\\]+\\")/gu;
    expect(dates.length).toBeGreaterThan(0);
    expect([...html.matchAll(lineage)]).toHaveLength(1);
    let body = html.replace(lineage, `\\"snapshotRevision\\":\\"${SNAPSHOT_A}\\",\\"verifiedAt\\":\\"${dates[0][1]}\\"`);
    const period = /\\"periodContext\\":(\{[^{}]*\})/gu;
    expect([...body.matchAll(period)]).toHaveLength(1);
    body = body.replace(period, (_match, serialized: string) => {
      const original = JSON.parse(serialized.replace(/\\"/gu, '"')) as MatchupPeriodContext;
      return `\\"periodContext\\":${JSON.stringify({ ...original, ...contextFixture('active', 1) }).replace(/"/gu, '\\"')}`;
    });
    if (!body.includes('class="refresh-note"')) body = body.replace(/(<p class="updated"[^>]*>[\s\S]*?<\/p>)/u,
      '$1<p class="refresh-note">Checks for a newer matchup snapshot every minute while this page is open.</p>');
    state.documentCount += 1;
    await route.fulfill({ response, body });
  });
  await page.route('**/api/matchups/**', async (route) => {
    const url = new URL(route.request().url());
    const requestedLeague = url.pathname.split('/')[3];
    const week = Number(url.searchParams.get('week'));
    if (url.pathname.endsWith('/box-scores')) {
      state.boxRequests.push({ league: requestedLeague, season: url.searchParams.get('season'), week,
        queryKeys: [...url.searchParams.keys()].sort() });
      const payload: MatchupBoxScores = { leagueKey: requestedLeague, season: '2026', week, status: 'available',
        observedAt: state.observedAt, revision: `box-${state.passingYards}`, players: {
          [`player:${state.leftPlayerId}`]: { stats: { pass_cmp: 17, pass_att: 27, pass_yd: state.passingYards, pass_td: 1,
            pass_int: 1, rush_att: 5, rush_yd: 29 }, gamePhase: 'live' },
          [RIGHT]: { stats: { rec: 5, rec_yd: 61, rec_td: 1 }, gamePhase: 'final' },
          [DEFENSE]: { stats: { sack: 2, int: 1, pts_allow: 17 }, gamePhase: 'final' },
        } };
      const status = state.boxStatus;
      if (state.holdBox) await state.holdBox;
      await route.fulfill({ status, json: status === 200 ? payload : { error: 'Statistics unavailable' } });
      state.completedBoxes += 1;
      return;
    }
    const headers = Object.fromEntries(snapshotHeaders(state.snapshotRevision, FRESH_LINEAGE, contextFixture('active', week)));
    if (url.pathname.endsWith('/revision')) {
      state.compactCount += 1;
      await route.fulfill({ headers, json: { status: 'ok', revision: state.snapshotRevision, verifiedAt: FRESH_LINEAGE } });
    } else {
      state.fullCount += 1;
      const payload = boardFixture(week);
      payload.matchups[0].sides[0].starters[0].id = state.leftPlayerId;
      await route.fulfill({ headers, json: payload });
    }
  });
  await page.goto(`${league === 'league2' ? '/league2' : ''}/matchups?week=1`, { waitUntil: 'networkidle' });
  expect(state.documentCount).toBe(1);
  await page.clock.runFor(61_000);
  await expect(page.getByText('Fixture Alpha', { exact: true })).toBeVisible();
  await expect(page.locator('[data-matchup-toggle]').first().locator('[data-team-name]'))
    .toHaveText(['Fixture Beta', 'Fixture Alpha']);
  await page.clock.setSystemTime(new Date('2026-09-13T16:02:00.000Z'));
  expect(state.fullCount).toBe(1);
  expect(state.boxRequests).toHaveLength(0);
  await page.locator('[data-matchup-toggle]').first().click();
  return state;
}

function toggle(page: Page, index = 0) {
  return page.locator(`[data-starter-box-score-toggle][data-starter-index="${index}"]`);
}
function panel(page: Page, key: string, side: 'left' | 'right') {
  return page.locator(`[data-player-box-score][data-box-score-key="${key}"][data-player-side="${side}"]`);
}
async function visibility(page: Page, value: 'visible' | 'hidden') {
  await page.evaluate((state) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
    document.dispatchEvent(new Event('visibilitychange'));
  }, value);
}

for (const league of ['league1', 'league2'] as const) {
  test(`${league} expands both teams from the whole starter row and fits supported widths`, async ({ page }) => {
    const state = await openFixture(page, league);
    const row = toggle(page);
    const details = page.locator('[data-starter-box-score-row][data-starter-index="0"]');
    await expect(row).toHaveAccessibleName('WR row 1 game statistics for both teams');
    await expect(row).toHaveAttribute('aria-expanded', 'false');
    await expect(row).toHaveAttribute('aria-controls', (await details.getAttribute('id'))!);
    await expect(page.locator('[data-player-box-score-toggle]')).toHaveCount(0);
    await expect(page.locator('[data-player-name] svg')).toHaveCount(0);
    expect(state.boxRequests).toHaveLength(0);
    // Hit the actual score positions, not just the old name/disclosure area.
    const leftScore = await row.locator('..').locator('[data-player-score-side="left"]').boundingBox();
    expect(leftScore).not.toBeNull();
    await page.mouse.click(leftScore!.x + leftScore!.width / 2, leftScore!.y + leftScore!.height / 2);
    await expect(panel(page, LEFT, 'right').locator('[data-box-score-summary]')).toHaveText(quarterbackSummary());
    await expect(panel(page, RIGHT, 'left').locator('[data-box-score-summary]')).toHaveText('5 REC, 61 YD, 1 TD');
    await expect(row).toHaveAttribute('aria-expanded', 'true');
    const rightScore = await row.locator('..').locator('[data-player-score-side="right"]').boundingBox();
    expect(rightScore).not.toBeNull();
    await page.mouse.click(rightScore!.x + rightScore!.width / 2, rightScore!.y + rightScore!.height / 2);
    await expect(panel(page, RIGHT, 'left')).toBeHidden();
    await expect(panel(page, LEFT, 'right')).toBeHidden();
    const center = await row.boundingBox();
    await row.click({ position: { x: center!.width / 2, y: center!.height / 2 } });
    await expect(panel(page, RIGHT, 'left')).toBeVisible();
    await expect(panel(page, LEFT, 'right')).toBeVisible();
    await row.focus();
    await row.press('Space');
    await expect(panel(page, RIGHT, 'left')).toBeHidden();
    await expect(panel(page, LEFT, 'right')).toBeHidden();
    await row.press('Enter');
    await expect(panel(page, RIGHT, 'left')).toBeVisible();
    await expect(panel(page, LEFT, 'right')).toBeVisible();
    await toggle(page, 1).click();
    await expect(panel(page, UNKNOWN, 'right')).toHaveText('Statistics not available yet.');
    await expect(toggle(page, 1)).toHaveAccessibleName('FLEX row 2 game statistics for both teams');
    await expect(toggle(page, 2)).toHaveAttribute('aria-expanded', 'false');
    await toggle(page, 2).click();
    await expect(toggle(page, 2)).toHaveAccessibleName('FLEX row 3 game statistics for both teams');
    await expect(toggle(page, 1)).toHaveAttribute('aria-expanded', 'true');
    await expect(panel(page, DEFENSE, 'left').locator('[data-box-score-summary]')).toHaveText('2 SACK, 1 INT, 17 PA');
    await expect(panel(page, 'player:fixture-upcoming', 'left')).toHaveCount(0);
    await expect(panel(page, 'player:fixture-bye', 'right')).toHaveCount(0);
    await expect(page.locator('[data-box-score-source]')).toHaveCount(1);
    expect(state.boxRequests).toEqual([{ league, season: '2026', week: 1, queryKeys: ['season', 'week'] }]);

    for (const width of [360, 390, 430, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await expect.poll(async () => page.locator('[data-player-box-score]:visible').evaluateAll((panels) => (
        panels.every((node) => node.scrollWidth <= node.clientWidth + 1)
      )), `open box-score panels should fit at ${width}px`).toBe(true);
      const heights = await page.locator('[data-player-game]').evaluateAll((nodes) => nodes.map((node) => (
        node.closest<HTMLElement>('div[class*="playerRow"]')?.getBoundingClientRect().height ?? 0
      )));
      for (const height of heights) expect(height).toBeCloseTo(52, 0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
      const target = await row.boundingBox();
      expect(target?.height).toBeGreaterThanOrEqual(44);
      if (league === 'league1' && width === 390) {
        await page.screenshot({ path: '../../test-results/starter-row-box-score-mobile.png', fullPage: true });
      }
    }
    await toggle(page, 2).click();
    await expect(panel(page, DEFENSE, 'left')).toBeHidden();
    await expect(panel(page, UNKNOWN, 'right')).toBeVisible();
    await expect(row).toHaveAttribute('aria-expanded', 'true');
    expect(state.boxRequests).toHaveLength(1);
    expect(state.providerRequests).toEqual([]);

    state.passingYards = 247;
    state.observedAt = '2026-09-13T16:02:00.000Z';
    await page.clock.runFor(59_999);
    expect(state.boxRequests).toHaveLength(1);
    await page.clock.runFor(1);
    await expect(panel(page, LEFT, 'right').locator('[data-box-score-summary]')).toHaveText(quarterbackSummary(247));
    expect(state.boxRequests).toHaveLength(2);
    expect(state.fullCount).toBe(1);
    await expect(row).toHaveAttribute('aria-expanded', 'true');
    await expect(panel(page, RIGHT, 'left')).toBeVisible();
    state.boxStatus = 503;
    await page.clock.fastForward(3_600_000);
    await expect.poll(() => state.completedBoxes).toBe(3);
    await expect(panel(page, LEFT, 'right').locator('[data-box-score-summary]')).toHaveText(quarterbackSummary(247));
    await expect(page.locator('[data-box-score-source]')).toContainText('12:02 PM ET');
    await expect(row).toHaveAttribute('aria-expanded', 'true');
    expect(state.fullCount).toBe(1);
    expect(state.providerRequests).toEqual([]);

    // A changed accepted lineup keeps this position row open for its new player.
    state.leftPlayerId = 'fixture-replacement';
    state.snapshotRevision = SNAPSHOT_C;
    state.boxStatus = 200;
    state.observedAt = '2026-09-13T17:03:00.000Z';
    await visibility(page, 'hidden');
    await visibility(page, 'visible');
    await expect(panel(page, 'player:fixture-replacement', 'right').locator('[data-box-score-summary]'))
      .toHaveText(quarterbackSummary(247));
    await expect(panel(page, LEFT, 'right')).toHaveCount(0);
    await expect(panel(page, RIGHT, 'left')).toBeVisible();
    await expect(row).toHaveAttribute('aria-expanded', 'true');
    await expect(toggle(page, 1)).toHaveAttribute('aria-expanded', 'true');
    await expect(toggle(page, 2)).toHaveAttribute('aria-expanded', 'false');
    expect(state.fullCount).toBe(2);
    expect(state.boxRequests).toHaveLength(4);
  });
}

test('hidden boards abort an outstanding box-score refresh and catch up once when visible', async ({ page }) => {
  const state = await openFixture(page);
  await toggle(page).click();
  await expect(panel(page, LEFT, 'right').locator('[data-box-score-summary]')).toHaveText(quarterbackSummary());
  const held = deferred();
  state.holdBox = held.promise;
  state.passingYards = 999;
  await page.clock.runFor(60_000);
  await expect.poll(() => state.boxRequests.length).toBe(2);
  await visibility(page, 'hidden');
  held.resolve();
  state.holdBox = null;
  await expect.poll(() => state.abortedBoxes.length).toBe(1);
  await page.clock.runFor(3_600_000);
  expect(state.boxRequests).toHaveLength(2);
  await expect(panel(page, LEFT, 'right').locator('[data-box-score-summary]')).toHaveText(quarterbackSummary());
  state.passingYards = 258;
  await visibility(page, 'visible');
  await expect(panel(page, LEFT, 'right').locator('[data-box-score-summary]')).toHaveText(quarterbackSummary(258));
  expect(state.boxRequests).toHaveLength(3);
  await expect(toggle(page)).toHaveAttribute('aria-expanded', 'true');
});

for (const destination of ['league', 'week'] as const) {
  test(`a delayed old box-score response is aborted during ${destination} navigation`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const state = await openFixture(page);
    const held = deferred();
    state.holdBox = held.promise;
    state.passingYards = 987654321;
    await toggle(page).click();
    await expect.poll(() => state.boxRequests.length).toBe(1);
    if (destination === 'league') {
      await page.getByRole('navigation', { name: 'Mobile navigation' })
        .getByRole('button', { name: 'Choose league, current League One' }).click();
      await page.getByRole('link', { name: 'View League Two' }).click();
      await expect(page).toHaveURL(/\/league2\/matchups$/u);
      await expect(page.getByRole('link', { name: 'League Two home' })).toBeVisible();
    } else {
      const picker = page.getByLabel('Matchup week');
      // Current deliberately uses the unpinned route. This race exercises an
      // explicit different week, independently of the live calendar's default.
      const targetWeek = (await picker.locator('option[value="2"]').textContent())?.includes('Current') ? '3' : '2';
      await picker.selectOption(targetWeek);
      await expect(page).toHaveURL(new RegExp(`/matchups\\?week=${targetWeek}$`, 'u'));
      await expect(picker).toHaveValue(targetWeek);
    }
    held.resolve();
    state.holdBox = null;
    await expect.poll(() => state.abortedBoxes.length).toBe(1);
    await page.clock.runFor(1);
    await expect(panel(page, LEFT, 'right')).toHaveCount(0);
    await expect(page.getByText(/987654321/u)).toHaveCount(0);
    expect(state.boxRequests).toEqual([{ league: 'league1', season: '2026', week: 1, queryKeys: ['season', 'week'] }]);
  });
}
