import { expect, test, type Locator, type Page } from '@playwright/test';
import { LEAGUE_IDS } from '../lib/config';
import type { MatchupPeriodContext } from '../lib/matchup-period';
import type { MatchupBoxScores } from '../lib/matchup-box-score-types';
import { contextFixture, snapshotFixture, snapshotHeaders, SNAPSHOT_A, SNAPSHOT_B } from '../test-support/matchup-snapshot-fixtures';

type League = 'league1' | 'league2';
const LEFT = 'player:fixture-player-0';
const RIGHT = 'player:fixture-player-1';
const UNKNOWN = 'player:fixture-missing';
const DEFENSE = 'defense:BAL';
const FRESH_LINEAGE = '2099-09-03T12:00:00.000Z';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function boardFixture(week = 1) {
  const data = snapshotFixture(week);
  data.league.rosterPositions = ['WR', 'RB', 'FLEX'];
  const matchup = data.matchups[0];
  matchup.status = 'live';
  const [left, right] = matchup.sides;
  left.starters[0] = { ...left.starters[0], name: 'Fixture Receiver One', position: 'WR', slot: 'WR',
    game: { kind: 'scheduled', opponent: 'TEN', location: 'away', date: '2026-09-13', kickoffAt: '2026-09-13T17:00:00.000Z',
      liveScore: { teamScore: 7, opponentScore: 3, phase: 'q2', clockSeconds: 300 } } };
  right.starters[0] = { ...right.starters[0], name: 'Fixture Receiver Two', position: 'WR', slot: 'WR',
    game: { kind: 'scheduled', opponent: 'NYJ', location: 'home', date: '2026-09-13', kickoffAt: '2026-09-13T17:00:00.000Z',
      finalScore: { teamScore: 24, opponentScore: 17 } } };
  left.starters.push({ ...left.starters[0], id: 'fixture-missing', name: 'Fixture Missing Statistics', slot: 'RB' },
    { ...left.starters[0], id: 'fixture-bye', name: 'Fixture Bye Player', slot: 'FLEX', game: { kind: 'bye' } });
  right.starters.push({ ...right.starters[0], id: 'fixture-upcoming', name: 'Fixture Upcoming Player', slot: 'RB',
    game: { kind: 'scheduled', opponent: 'KC', location: 'away', date: '2026-09-14', kickoffAt: '2026-09-15T00:15:00.000Z' } },
  { ...right.starters[0], id: 'BAL', name: 'Baltimore Ravens', position: 'DEF', nflTeam: 'BAL', slot: 'FLEX' });
  return data;
}

async function openFixture(page: Page, league: League = 'league1') {
  const state = {
    receptions: 3, boxStatus: 200, observedAt: '2026-09-13T16:00:00.000Z',
    boxRequests: [] as Array<{ league: string; season: string | null; week: number; queryKeys: string[] }>,
    compactCount: 0, fullCount: 0, documentCount: 0,
    holdBox: null as Promise<void> | null, completedBoxes: 0, abortedBoxes: [] as string[], providerRequests: [] as string[],
  };
  await page.clock.install({ time: new Date('2026-09-13T16:00:00.000Z') });
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
        observedAt: state.observedAt, revision: `box-${state.receptions}`, players: {
          [LEFT]: { stats: { rec: state.receptions, rec_tgt: 5, rec_yd: 26, rec_td: 0 }, gamePhase: 'live' },
          [RIGHT]: { stats: { rec: 5, rec_yd: 61, rec_td: 1 }, gamePhase: 'final' },
          [DEFENSE]: { stats: { sack: 2, int: 1, pts_allow: 17 }, gamePhase: 'final' },
        } };
      const status = state.boxStatus;
      if (state.holdBox) await state.holdBox;
      await route.fulfill({ status, json: status === 200 ? payload : { error: 'Statistics unavailable' } });
      state.completedBoxes += 1;
      return;
    }
    const headers = Object.fromEntries(snapshotHeaders(SNAPSHOT_B, FRESH_LINEAGE, contextFixture('active', week)));
    if (url.pathname.endsWith('/revision')) {
      state.compactCount += 1;
      await route.fulfill({ headers, json: { status: 'ok', revision: SNAPSHOT_B, verifiedAt: FRESH_LINEAGE } });
    } else {
      state.fullCount += 1;
      await route.fulfill({ headers, json: boardFixture(week) });
    }
  });
  await page.goto(`${league === 'league2' ? '/league2' : ''}/matchups?week=1`, { waitUntil: 'networkidle' });
  expect(state.documentCount).toBe(1);
  await page.clock.pauseAt(new Date('2026-09-13T16:01:00.000Z'));
  await page.clock.runFor(60_000);
  await expect(page.getByText('Fixture Alpha', { exact: true })).toBeVisible();
  expect(state.fullCount).toBe(1);
  expect(state.boxRequests).toHaveLength(0);
  await page.locator('[data-matchup-toggle]').first().click();
  return state;
}

function toggle(page: Page, key: string, side: 'left' | 'right') {
  return page.locator(`[data-player-box-score-toggle][data-box-score-key="${key}"][data-player-side="${side}"]`);
}
function panel(page: Page, key: string, side: 'left' | 'right') {
  return page.locator(`[data-player-box-score][data-box-score-key="${key}"][data-player-side="${side}"]`);
}
function stat(panel: Locator, label: string) {
  return panel.locator('dl > div').filter({ has: panel.page().getByText(label, { exact: true }) }).locator('dd');
}
async function visibility(page: Page, value: 'visible' | 'hidden') {
  await page.evaluate((state) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
    document.dispatchEvent(new Event('visibilitychange'));
  }, value);
}

for (const league of ['league1', 'league2'] as const) {
  test(`${league} loads box scores once on expansion, keeps each side independent, and fits supported widths`, async ({ page }) => {
    const state = await openFixture(page, league);
    const left = toggle(page, LEFT, 'left');
    const right = toggle(page, RIGHT, 'right');
    await expect(left).toHaveAccessibleName('Fixture Receiver One game statistics');
    await expect(right).toHaveAccessibleName('Fixture Receiver Two game statistics');
    await expect(left).toHaveAttribute('aria-expanded', 'false');
    await expect(right).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByRole('button', { name: 'Fixture Upcoming Player game statistics' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Fixture Bye Player game statistics' })).toHaveCount(0);
    expect(state.boxRequests).toHaveLength(0);
    await left.click();
    await expect(stat(panel(page, LEFT, 'left'), 'Receptions')).toHaveText('3');
    await expect(right).toHaveAttribute('aria-expanded', 'false');
    await right.focus();
    await right.press('Enter');
    await expect(stat(panel(page, RIGHT, 'right'), 'Receptions')).toHaveText('5');
    await expect(left).toHaveAttribute('aria-expanded', 'true');
    await right.press('Space');
    await expect(panel(page, RIGHT, 'right')).toBeHidden();
    await expect(panel(page, LEFT, 'left')).toBeVisible();
    await right.press('Enter');
    await toggle(page, UNKNOWN, 'left').click();
    await expect(panel(page, UNKNOWN, 'left')).toContainText('Statistics not available yet.');
    await expect(panel(page, UNKNOWN, 'left').locator('dd')).toHaveCount(0);
    await toggle(page, DEFENSE, 'right').click();
    await expect(stat(panel(page, DEFENSE, 'right'), 'Sacks')).toHaveText('2');
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
      const target = await left.boundingBox();
      expect(target?.height).toBeGreaterThanOrEqual(44);
    }
    await left.click();
    await expect(panel(page, LEFT, 'left')).toBeHidden();
    await expect(panel(page, RIGHT, 'right')).toBeVisible();
    await left.click();
    expect(state.boxRequests).toHaveLength(1);
    expect(state.providerRequests).toEqual([]);

    state.receptions = 7;
    state.observedAt = '2026-09-13T16:02:00.000Z';
    await page.clock.runFor(59_999);
    expect(state.boxRequests).toHaveLength(1);
    await page.clock.runFor(1);
    await expect(stat(panel(page, LEFT, 'left'), 'Receptions')).toHaveText('7');
    expect(state.boxRequests).toHaveLength(2);
    expect(state.fullCount).toBe(1);
    await expect(left).toHaveAttribute('aria-expanded', 'true');
    await expect(right).toHaveAttribute('aria-expanded', 'true');
    state.boxStatus = 503;
    await page.clock.fastForward(3_600_000);
    await expect.poll(() => state.completedBoxes).toBe(3);
    await expect(stat(panel(page, LEFT, 'left'), 'Receptions')).toHaveText('7');
    await expect(panel(page, LEFT, 'left')).toContainText('12:02 PM ET');
    await expect(left).toHaveAttribute('aria-expanded', 'true');
    expect(state.fullCount).toBe(1);
    expect(state.providerRequests).toEqual([]);
  });
}

test('hidden boards abort an outstanding box-score refresh and catch up once when visible', async ({ page }) => {
  const state = await openFixture(page);
  await toggle(page, LEFT, 'left').click();
  await expect(stat(panel(page, LEFT, 'left'), 'Receptions')).toHaveText('3');
  const held = deferred();
  state.holdBox = held.promise;
  state.receptions = 99;
  await page.clock.runFor(60_000);
  await expect.poll(() => state.boxRequests.length).toBe(2);
  await visibility(page, 'hidden');
  held.resolve();
  state.holdBox = null;
  await expect.poll(() => state.abortedBoxes.length).toBe(1);
  await page.clock.runFor(3_600_000);
  expect(state.boxRequests).toHaveLength(2);
  await expect(stat(panel(page, LEFT, 'left'), 'Receptions')).toHaveText('3');
  state.receptions = 8;
  await visibility(page, 'visible');
  await expect(stat(panel(page, LEFT, 'left'), 'Receptions')).toHaveText('8');
  expect(state.boxRequests).toHaveLength(3);
  await expect(toggle(page, LEFT, 'left')).toHaveAttribute('aria-expanded', 'true');
});

for (const destination of ['league', 'week'] as const) {
  test(`a delayed old box-score response is aborted during ${destination} navigation`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const state = await openFixture(page);
    const held = deferred();
    state.holdBox = held.promise;
    state.receptions = 987654321;
    await toggle(page, LEFT, 'left').click();
    await expect.poll(() => state.boxRequests.length).toBe(1);
    if (destination === 'league') {
      await page.getByRole('navigation', { name: 'Mobile navigation' })
        .getByRole('button', { name: 'Choose league, current League One' }).click();
      await page.getByRole('link', { name: 'View League Two' }).click();
      await expect(page).toHaveURL(/\/league2\/matchups$/u);
      await expect(page.getByRole('link', { name: 'League Two home' })).toBeVisible();
    } else {
      await page.getByLabel('Matchup week').selectOption('2');
      await expect(page).toHaveURL(/\/matchups\?week=2$/u);
      await expect(page.getByLabel('Matchup week')).toHaveValue('2');
    }
    held.resolve();
    state.holdBox = null;
    await expect.poll(() => state.abortedBoxes.length).toBe(1);
    await page.clock.runFor(1);
    await expect(panel(page, LEFT, 'left')).toHaveCount(0);
    await expect(page.getByText('987654321', { exact: true })).toHaveCount(0);
    expect(state.boxRequests).toEqual([{ league: 'league1', season: '2026', week: 1, queryKeys: ['season', 'week'] }]);
  });
}
