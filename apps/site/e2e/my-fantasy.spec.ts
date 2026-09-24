import { expect, test, type Locator, type Page, type Request } from '@playwright/test';
import { LEAGUE_IDS } from '../lib/config';
import { LEAGUE_SITES, type LeagueKey } from '../lib/leagues';
import type { MatchupPeriodContext } from '../lib/matchup-period';
import type { MatchupBoxScores } from '../lib/matchup-box-score-types';
import { isMatchupsData } from '../lib/matchups-response';
import { contextFixture, snapshotFixture, snapshotHeaders, SNAPSHOT_A } from '../test-support/matchup-snapshot-fixtures';

const leagues = ['league1', 'league2', 'dynasty'] as const;
const savedTeams: Record<LeagueKey, number> = { league1: 1, league2: 2, dynasty: 3 };
const verifiedAt = '2099-09-03T12:00:00.000Z';
const initialServerHeading = 'League One before standings refresh';
const storageKey = (league: LeagueKey) => `league-one:my-team:${LEAGUE_IDS[league]}`;
const playerId = (league: LeagueKey, team: number) => `my-fantasy-${league}-${team}`;
const actualPoints = (league: LeagueKey, team: number) => leagues.indexOf(league) * 10 + team * 11 + 0.5;
const projectedPoints = (league: LeagueKey, team: number) => leagues.indexOf(league) + team * 10 + 80.25;
const card = (page: Page, league: LeagueKey) => page.locator(`[data-my-fantasy-league="${league}"]`);
const serverHeading = (page: Page) => card(page, 'league1').getByRole('heading', { level: 2, name: /^League One/u });
const navigation = (page: Page, width: number) => page.getByRole('navigation', {
  name: width < 760 ? 'Mobile navigation' : 'Main navigation', exact: true,
});

function fantasyFixture(league: LeagueKey, week: number) {
  const first = snapshotFixture(week);
  const second = snapshotFixture(week);
  second.teams.forEach(team => { team.id += 2; });
  const data = { ...first, teams: [...first.teams, ...second.teams], matchups: [...first.matchups, ...second.matchups] };
  data.league.rosterPositions = ['QB'];
  for (const team of data.teams) {
    team.name = `${LEAGUE_SITES[league].name} Fantasy Team ${team.id}`;
    team.managerName = `Fantasy Manager ${team.id}`;
  }
  data.matchups.forEach((matchup, index) => {
    matchup.id = `${league}-fantasy-matchup-${index}`;
    matchup.status = 'live';
    for (const side of matchup.sides) {
      side.points = actualPoints(league, side.team.id);
      side.projectedPoints = projectedPoints(league, side.team.id);
      side.starters[0] = { ...side.starters[0], id: playerId(league, side.team.id),
        name: side.team.id % 2 === 0 ? 'Trevor Lawrence' : 'Patrick Mahomes', position: 'QB', slot: 'QB',
        points: side.points, projectedPoints: side.projectedPoints,
        game: { kind: 'scheduled', opponent: 'TEN', location: 'away', date: '2026-09-13',
          kickoffAt: '2026-09-13T17:00:00.000Z',
          liveScore: { teamScore: 7, opponentScore: 3, phase: 'q2', clockSeconds: 300 } } };
    }
  });
  expect(isMatchupsData(data), 'My Fantasy uses valid existing snapshot transport').toBe(true);
  return data;
}

async function expectSelectedScores(container: Locator, league: LeagueKey, ownTeam: number) {
  const opponent = ownTeam % 2 === 0 ? ownTeam - 1 : ownTeam + 1;
  const toggle = container.locator('[data-matchup-toggle]');
  await expect(toggle).toHaveCount(1);
  await expect(toggle.locator('[data-team-name]')).toHaveText(
    [ownTeam, opponent].map(team => `${LEAGUE_SITES[league].name} Fantasy Team ${team}`));
  await expect(toggle.locator('[data-score-number]')).toHaveText(
    [ownTeam, opponent].map(team => actualPoints(league, team).toFixed(2)));
  await expect(toggle.locator('[data-team-projection-number]')).toHaveText(
    [ownTeam, opponent].map(team => projectedPoints(league, team).toFixed(2)));
}

async function openFantasyFixture(page: Page, options: { staleInitialRefresh?: boolean } = {}) {
  const state = { documents: 0, full: { league1: 0, league2: 0, dynasty: 0 },
    refreshRequests: 0, refreshFinished: 0, refreshFailures: 0,
    readerRequests: 0, readerFinished: 0, readerFailures: [] as string[],
    holdRefreshMarker: options.staleInitialRefresh ?? false, staleRefreshes: 0,
    weeks: {} as Partial<Record<LeagueKey, number>>,
    boxRequests: [] as Array<{ league: LeagueKey; season: string | null; week: number; queryKeys: string[] }>,
    providerRequests: [] as string[] };
  await page.clock.install({ time: new Date('2026-09-13T16:00:00.000Z') });
  await page.clock.pauseAt(new Date('2026-09-13T16:01:00.000Z'));
  await page.addInitScript(preferences => {
    for (const [key, value] of preferences) {
      // Reloading must retain later choices made through the existing My Team controls.
      if (localStorage.getItem(key) === null) localStorage.setItem(key, value);
    }
  }, leagues.map(league => [storageKey(league), String(savedTeams[league])]));
  const refreshes = new Set<Request>();
  const readers = new Set<Request>();
  page.on('request', request => {
    if (/api\.sleeper\.|tank01/iu.test(new URL(request.url()).hostname)) state.providerRequests.push(request.url());
    if (new URL(request.url()).pathname.startsWith('/api/matchups/')) {
      readers.add(request); state.readerRequests += 1;
    }
    const headers = request.headers();
    if (new URL(request.url()).pathname === '/my-fantasy' && headers.rsc === '1' && !headers['next-router-prefetch']) {
      refreshes.add(request); state.refreshRequests += 1;
    }
  });
  page.on('requestfinished', request => {
    if (refreshes.has(request)) state.refreshFinished += 1;
    if (readers.has(request)) state.readerFinished += 1;
  });
  page.on('requestfailed', request => {
    if (refreshes.has(request)) { state.refreshFinished += 1; state.refreshFailures += 1; }
    if (readers.has(request)) {
      state.readerFinished += 1;
      state.readerFailures.push(`${new URL(request.url()).pathname}: ${request.failure()?.errorText}`);
    }
  });
  // Keep real SSR markup. Control lineage/context before the normal reader
  // adopts data, and use one presentation marker to observe RSC commits.
  await page.route(/\/(?:my-fantasy|(?:(?:league2|dynasty)\/)?my-team)(?:\?|$)/u, async route => {
    if (route.request().resourceType() !== 'document') {
      const request = route.request();
      const headers = request.headers();
      if (!state.holdRefreshMarker || new URL(request.url()).pathname !== '/my-fantasy'
        || headers.rsc !== '1' || headers['next-router-prefetch']) return route.continue();
      // A successful refresh can still carry old server props. Keep the marker
      // for the first wave only; later retries receive the untouched response.
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      const body = await response.text();
      const siteName = '"site":{"key":"league1","name":"League One"';
      expect(body.split(siteName)).toHaveLength(2);
      state.staleRefreshes += 1;
      return route.fulfill({ response, body: body.replace(siteName, siteName.replace('League One', initialServerHeading)) });
    }
    const response = await route.fetch();
    const html = await response.text();
    const expectedSources = new URL(route.request().url()).pathname === '/my-fantasy' ? 3 : 1;
    const lineage = /\\"snapshotRevision\\":(?:null|\\"[a-f0-9]{64}\\"),\\"verifiedAt\\":(?:null|\\"[^"\\]+\\")/gu;
    expect([...html.matchAll(lineage)], 'each available league supplies one existing reader').toHaveLength(expectedSources);
    let body = html.replace(lineage, `\\"snapshotRevision\\":\\"${SNAPSHOT_A}\\",\\"verifiedAt\\":\\"2026-01-01T00:00:00.000Z\\"`);
    const period = /\\"periodContext\\":(\{[^{}]*\})/gu;
    expect([...body.matchAll(period)]).toHaveLength(expectedSources);
    body = body.replace(period, (_match, serialized: string) => {
      const initial = JSON.parse(serialized.replace(/\\"/gu, '"')) as MatchupPeriodContext;
      return `\\"periodContext\\":${JSON.stringify({ ...initial,
        ...contextFixture('active', initial.activeWeek ?? initial.defaultWeek) }).replace(/"/gu, '\\"')}`;
    });
    if (state.documents === 0 && new URL(route.request().url()).pathname === '/my-fantasy') {
      // Mark an initial server-owned prop in both the HTML and Flight payload.
      // Only a committed, unmodified RSC refresh can restore the canonical heading.
      const siteName = '\\"site\\":{\\"key\\":\\"league1\\",\\"name\\":\\"League One\\"';
      expect(body.split(siteName)).toHaveLength(2);
      expect(body.split('<h2>League One</h2>')).toHaveLength(2);
      body = body.replace(siteName, siteName.replace('League One', initialServerHeading))
        .replace('<h2>League One</h2>', `<h2>${initialServerHeading}</h2>`)
        .replace('data-my-fantasy-league="league1" aria-label="League One"',
          `data-my-fantasy-league="league1" aria-label="${initialServerHeading}"`)
        .replace('aria-label="Enter League One"', `aria-label="Enter ${initialServerHeading}"`);
    }
    state.documents += 1;
    await route.fulfill({ response, body });
  });
  await page.route('**/api/matchups/**', async route => {
    const url = new URL(route.request().url());
    const league = url.pathname.split('/')[3] as LeagueKey;
    expect(leagues).toContain(league);
    const week = Number(url.searchParams.get('week'));
    expect(Number.isInteger(week) && week >= 1 && week <= 18).toBe(true);
    if (state.weeks[league] !== undefined) expect(week).toBe(state.weeks[league]);
    state.weeks[league] = week;
    if (url.pathname.endsWith('/box-scores')) {
      state.boxRequests.push({ league, season: url.searchParams.get('season'), week,
        queryKeys: [...url.searchParams.keys()].sort() });
      const payload: MatchupBoxScores = { leagueKey: league, season: '2026', week, status: 'available',
        observedAt: '2026-09-13T16:00:00.000Z', revision: `fantasy-box-${league}`, players: Object.fromEntries(
          [1, 2, 3, 4].map(team => [`player:${playerId(league, team)}`, {
            stats: { pass_cmp: 17, pass_att: 27, pass_yd: 200 + team, pass_td: 1, pass_int: 1,
              rush_att: 5, rush_yd: 29 }, gamePhase: 'live',
          }])) };
      await route.fulfill({ json: payload });
      return;
    }
    const revision = ['b', 'c', 'd'][leagues.indexOf(league)].repeat(64);
    const headers = Object.fromEntries(snapshotHeaders(revision, verifiedAt, contextFixture('active', week)));
    if (url.pathname.endsWith('/revision')) {
      await route.fulfill({ headers, json: { status: 'ok', revision, verifiedAt } });
    } else {
      state.full[league] += 1;
      await route.fulfill({ headers, json: fantasyFixture(league, week) });
    }
  });
  await page.goto('/my-fantasy', { waitUntil: 'networkidle' });
  await expect(serverHeading(page)).toHaveText(initialServerHeading);
  await page.clock.runFor(61_000);
  for (const league of leagues) {
    await expectSelectedScores(card(page, league), league, savedTeams[league]);
    const summary = card(page, league).locator('[data-matchup-toggle]');
    await expect(summary).toContainText('Record:');
    await expect(summary).toContainText('projected');
    await expect(summary).toHaveAccessibleName(/Record:\s*0–0/u);
    await expect(summary).toHaveAccessibleName(/Current rank\s+—\s+to\s+—\s+projected/u);
    await expect(summary).toHaveAccessibleName(/Projected rank unavailable/u);
  }
  // Adoption changes official-record evidence. Observe committed server props
  // rather than transport completion: an accepted stream can end as ERR_ABORTED.
  await expect.poll(() => state.refreshRequests).toBeGreaterThan(0);
  await expect(serverHeading(page),
    'The first standings refresh must preserve the deliberately stale marker or commit genuine server props')
    .toHaveText(options.staleInitialRefresh ? initialServerHeading : 'League One');
  await expect.poll(() => state.refreshFinished === state.refreshRequests).toBe(true);
  expect(state.refreshRequests).toBeLessThanOrEqual(3);
  if (!options.staleInitialRefresh) await expectBoundedSettlingRefreshes(page, state);
  expect(state.full).toEqual({ league1: 1, league2: 1, dynasty: 1 });
  expect(state.boxRequests).toEqual([]);
  return state;
}

async function expectBoundedSettlingRefreshes(page: Page, state: {
  refreshRequests: number; refreshFinished: number; full: Record<LeagueKey, number>;
  readerRequests: number; readerFinished: number; readerFailures: string[];
}) {
  async function advanceWithCompletedReaders(milliseconds: number) {
    for (let remaining = milliseconds; remaining > 0; remaining -= 5_000) {
      // A long fake-clock jump can fire the existing reader's 15s timeout before
      // intercepted browser IO completes. Drain IO between small clock steps so
      // this tests standings retry limits, not an artificial transport outage.
      await page.clock.runFor(Math.min(remaining, 5_000));
      await expect.poll(() => state.readerFinished === state.readerRequests).toBe(true);
      await expect.poll(() => state.refreshFinished === state.refreshRequests).toBe(true);
      expect(state.readerFailures).toEqual([]);
    }
  }
  for (let settlingAttempt = 0; settlingAttempt < 2; settlingAttempt += 1) {
    const previousRequests = state.refreshRequests;
    await advanceWithCompletedReaders(66_000);
    await expect.poll(() => state.refreshRequests, 'Each settling interval retries the official standings read')
      .toBeGreaterThan(previousRequests);
    await expect(serverHeading(page),
      'An untouched delayed RSC response must commit genuine server props').toHaveText('League One');
    await expect.poll(() => state.refreshFinished === state.refreshRequests).toBe(true);
    expect(state.refreshRequests).toBeLessThanOrEqual((settlingAttempt + 2) * leagues.length);
    for (const league of leagues) await expectSelectedScores(card(page, league), league, savedTeams[league]);
  }
  const settledRequests = state.refreshRequests;
  // Two more full settling intervals must not restart an exhausted retry budget.
  await advanceWithCompletedReaders(131_000);
  expect(state.refreshRequests).toBe(settledRequests);
  expect(state.refreshRequests).toBeLessThanOrEqual(9);
  expect(state.full).toEqual({ league1: 1, league2: 1, dynasty: 1 });
  for (const league of leagues) await expectSelectedScores(card(page, league), league, savedTeams[league]);
}

for (const width of [390, 760, 900, 1280]) {
  test(`My Fantasy precedes My Team and remains global from League Two at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/league2/my-team', { waitUntil: 'domcontentloaded' });
    const nav = navigation(page, width);
    const links = nav.locator(':scope > a');
    await expect(links).toHaveText(['My Fantasy', 'My Team', 'Matchups', 'League', 'Managers']);
    await expect(nav.getByRole('link', { name: 'My Fantasy', exact: true })).toHaveAttribute('href', '/my-fantasy');
    await expect(nav.getByRole('link', { name: 'My Team', exact: true })).toHaveAttribute('href', '/league2/my-team');
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1),
      `League Two navigation must fit ${width}px`).toBe(true);
    await nav.getByRole('link', { name: 'My Fantasy', exact: true }).click();
    await expect(page).toHaveURL(/\/my-fantasy$/u);
    await expect(page.getByRole('heading', { level: 1, name: 'My Fantasy', exact: true })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'My Fantasy', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(nav.getByRole('link', { name: 'My Team', exact: true })).not.toHaveAttribute('aria-current', 'page');
    await expect(page.locator('[data-my-fantasy-league]')).toHaveCount(3);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1),
      `Global My Fantasy navigation must fit ${width}px`).toBe(true);
    for (const league of leagues) {
      await expect(card(page, league).getByRole('link', { name: `Enter ${LEAGUE_SITES[league].name}`, exact: true }))
        .toHaveAttribute('href', `${LEAGUE_SITES[league].prefix}/my-team`);
    }
  });
}

test('My Fantasy retries stale server props and preserves the expanded matchup through bounded recovery', async ({ page }) => {
  const state = await openFantasyFixture(page, { staleInitialRefresh: true });
  expect(state.staleRefreshes).toBeGreaterThan(0);
  const container = card(page, 'league1');
  await expect(serverHeading(page)).toHaveText(initialServerHeading);
  const toggle = container.locator('[data-matchup-toggle]');
  await toggle.click();
  const row = container.locator('[data-starter-box-score-toggle]').first();
  await row.click();
  await expect(container.locator('[data-box-score-summary]').first()).toBeVisible();
  const staleResponses = state.staleRefreshes;
  state.holdRefreshMarker = false;
  await expectBoundedSettlingRefreshes(page, state);
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(row).toHaveAttribute('aria-expanded', 'true');
  await expect(container.locator('[data-box-score-summary]').first()).toBeVisible();
  await expect(page).toHaveURL(/\/my-fantasy$/u);
  expect(state.staleRefreshes).toBe(staleResponses);
  expect(state.documents).toBe(1);
  // The expanded live box score retains its existing once-per-minute reader.
  expect(state.boxRequests.length).toBeGreaterThanOrEqual(1);
  expect(state.boxRequests.length).toBeLessThanOrEqual(5);
  expect(state.boxRequests.every(request => request.league === 'league1')).toBe(true);
  expect(state.providerRequests).toEqual([]);
});

test('My Fantasy retains independent saved teams and adopts a change made in League Two', async ({ page }) => {
  const state = await openFantasyFixture(page);
  const readSelections = () => page.evaluate(keys => keys.map(key => localStorage.getItem(key)), leagues.map(storageKey));
  expect(await readSelections()).toEqual(['1', '2', '3']);
  await page.goto('/league2/managers/1', { waitUntil: 'networkidle' });
  await page.clock.runFor(1_000);
  const choose = page.locator('.manager-heading .my-team-button');
  await expect(choose).toHaveAttribute('aria-pressed', 'false');
  await choose.click();
  await expect(choose).toHaveAttribute('aria-pressed', 'true');
  expect(await readSelections()).toEqual(['1', '1', '3']);

  await page.goto('/my-fantasy', { waitUntil: 'networkidle' });
  await page.clock.runFor(61_000);
  for (const league of leagues) await expectSelectedScores(card(page, league), league, league === 'league2' ? 1 : savedTeams[league]);
  await page.reload({ waitUntil: 'networkidle' });
  await page.clock.runFor(61_000);
  for (const league of leagues) await expectSelectedScores(card(page, league), league, league === 'league2' ? 1 : savedTeams[league]);
  expect(await readSelections()).toEqual(['1', '1', '3']);
  await card(page, 'league2').getByRole('link', { name: 'Enter League Two', exact: true }).click();
  await expect(page).toHaveURL(/\/league2\/my-team$/u);
  // A document navigation gives the same transport control as the global cards.
  await page.reload({ waitUntil: 'networkidle' });
  await page.clock.runFor(61_000);
  await expectSelectedScores(page.locator('article:has([data-matchup-toggle])'), 'league2', 1);
  expect(await readSelections()).toEqual(['1', '1', '3']);
  expect(state.providerRequests).toEqual([]);
});

test('My Fantasy expands each matchup and player statistics inline without entering a league', async ({ page }) => {
  const state = await openFantasyFixture(page);
  for (const league of leagues) {
    const container = card(page, league);
    const toggle = container.locator('[data-matchup-toggle]');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(page).toHaveURL(/\/my-fantasy$/u);
    const row = container.locator('[data-starter-box-score-toggle]').first();
    await expect(row).toHaveAttribute('aria-expanded', 'false');
    expect(state.boxRequests).toHaveLength(leagues.indexOf(league));
    await row.click();
    const team = savedTeams[league];
    const ownPanel = container.locator(`[data-player-box-score][data-player-side="left"][data-box-score-key="player:${playerId(league, team)}"]`);
    await expect(ownPanel.locator('[data-box-score-summary]')).toHaveText(`17/27 CMP, ${200 + team} YD, 1 TD, 1 INT, 5 CAR, 29 YD`);
    await expect(row).toHaveAttribute('aria-expanded', 'true');
    await expectSelectedScores(container, league, team);
    await expect(page).toHaveURL(/\/my-fantasy$/u);
    await row.press('Enter');
    await expect(ownPanel).toBeHidden();
    await expect(row).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(row).toBeHidden();
    await expect(page).toHaveURL(/\/my-fantasy$/u);
  }
  expect(state.boxRequests).toEqual(leagues.map(league => ({ league, season: '2026', week: state.weeks[league], queryKeys: ['season', 'week'] })));
  expect(state.documents).toBe(1);
  expect(state.providerRequests).toEqual([]);
});

test('My Fantasy cards and inline statistics fit supported phone and desktop widths', async ({ page }) => {
  await openFantasyFixture(page);
  for (const league of leagues) {
    await card(page, league).locator('[data-matchup-toggle]').click();
    await card(page, league).locator('[data-starter-box-score-toggle]').first().click();
    await expect(card(page, league).locator('[data-box-score-summary]').first()).toBeVisible();
  }
  for (const width of [320, 360, 390, 430, 760, 900, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1),
      `My Fantasy document must fit ${width}px`).toBe(true);
    await expect.poll(() => page.locator('[data-my-fantasy-league], [data-player-box-score]:visible')
      .evaluateAll(nodes => nodes.every(node => node.scrollWidth <= node.clientWidth + 1)),
    `My Fantasy cards and expanded statistics must fit ${width}px`).toBe(true);
    for (const league of leagues) {
      const container = card(page, league);
      if (width >= 760) {
        const layout = await container.evaluate(element => {
          const style = getComputedStyle(element);
          const contentWidth = element.getBoundingClientRect().width - Number.parseFloat(style.paddingLeft)
            - Number.parseFloat(style.paddingRight) - Number.parseFloat(style.borderLeftWidth) - Number.parseFloat(style.borderRightWidth);
          return { contentWidth, summaryWidth: element.querySelector('[data-matchup-toggle]')!.getBoundingClientRect().width };
        });
        expect(layout.summaryWidth, `${league} summary should use the full card interior at ${width}px`)
          .toBeGreaterThanOrEqual(layout.contentWidth - 4);
      }
      for (const control of [container.locator('[data-matchup-toggle]'), container.locator('[data-starter-box-score-toggle]').first(),
        container.getByRole('link', { name: `Enter ${LEAGUE_SITES[league].name}`, exact: true })]) {
        const bounds = await control.boundingBox();
        expect(bounds, 'card controls remain rendered').not.toBeNull();
        expect(bounds!.height, `card controls remain usable at ${width}px`).toBeGreaterThanOrEqual(44);
      }
    }
  }
});
