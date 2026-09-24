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
const teamName = (league: LeagueKey, team: number) => `${LEAGUE_SITES[league].name} Fantasy Team ${team} Championship Contenders`;
const actualPoints = (league: LeagueKey, team: number) => league === 'league1' && team === 1
  ? 123.45 : leagues.indexOf(league) * 10 + team * 11 + 0.5;
const projectedPoints = (league: LeagueKey, team: number) => ({
  league1: [150.25, 95.25], league2: [121.25, 90.25], dynasty: [100.25, 100.25],
}[league][team % 2 === 0 ? 1 : 0]);
const oddTeamWinChance: Record<LeagueKey, number> = { league1: 0.67, league2: 0.65, dynasty: 0.5 };
const card = (page: Page, league: LeagueKey) => page.locator(`[data-my-fantasy-league="${league}"]`);
const serverHeading = (page: Page) => card(page, 'league1').getByRole('heading', { level: 2, name: /^League One/u });
const navigation = (page: Page, width: number) => page.getByRole('navigation', {
  name: width < 760 ? 'Mobile navigation' : 'Main navigation', exact: true,
});

async function pageIntroGeometry(page: Page) {
  // A streamed fallback can remain hidden beside the resolved page markup.
  // Require one visible intro instead of choosing an arbitrary duplicate.
  const intro = page.locator('#main-content [data-page-intro]:visible');
  await expect(intro).toHaveCount(1);
  await expect(intro).toBeVisible();
  const title = await intro.evaluate(element => {
    const heading = element.querySelector('h1')!;
    const season = element.querySelector('p')!;
    const style = getComputedStyle(heading);
    const seasonStyle = getComputedStyle(season);
    const headingBox = heading.getBoundingClientRect();
    const seasonBox = season.getBoundingClientRect();
    return { typography: { fontSize: style.fontSize, lineHeight: style.lineHeight, fontWeight: style.fontWeight,
      letterSpacing: style.letterSpacing, seasonSize: seasonStyle.fontSize, seasonLineHeight: seasonStyle.lineHeight },
    top: headingBox.top, left: headingBox.left, seasonGap: seasonBox.top - headingBox.bottom,
    seasonBottom: seasonBox.bottom, seasonText: season.textContent };
  });
  const selector = await page.getByRole('combobox', { name: 'Matchup week', exact: true }).boundingBox();
  expect(selector).not.toBeNull();
  return { ...title, selectorTop: selector!.y, selectorRight: selector!.x + selector!.width };
}

async function expectFantasyWeek(page: Page, week: number) {
  await expect(page.getByRole('combobox', { name: 'Matchup week', exact: true })).toHaveValue(String(week));
  await expect(page.locator('[data-my-fantasy-league]')).toHaveCount(3);
  for (const league of leagues) await expect(card(page, league).locator('[data-fantasy-metadata]'))
    .toHaveText(`Sleeper · Week ${week}`);
}

async function openFantasyCalendar(page: Page) {
  const before = '2026-09-15T15:59:58.000Z';
  const cutoff = '2026-09-15T16:00:00.000Z';
  const laterCutoff = '2026-09-22T16:00:00.000Z';
  const thirdCutoff = '2026-09-29T16:00:00.000Z';
  const state = { currentWeek: 1, navigations: [] as Array<number | null>, accountRequests: [] as string[], providerRequests: [] as string[] };
  const evaluatedAt = () => state.currentWeek === 1 ? before : state.currentWeek === 2 ? cutoff
    : state.currentWeek === 3 ? laterCutoff : thirdCutoff;
  const context = (week: number): MatchupPeriodContext => ({ ...contextFixture('active', state.currentWeek),
    temporalState: week < state.currentWeek ? 'past' : week > state.currentWeek ? 'future' : 'active' });
  await page.setViewportSize({ width: 390, height: 900 });
  await page.clock.install({ time: new Date(Date.parse(before) - 60_000) });
  await page.addInitScript(preferences => preferences.forEach(([key, value]) => localStorage.setItem(key, value)),
    leagues.map(league => [storageKey(league), String(savedTeams[league])]));
  page.on('request', request => {
    if (/api\.sleeper\.|tank01/iu.test(new URL(request.url()).hostname)) state.providerRequests.push(request.url());
  });
  await page.route(/\/api\/me(?:\/|\?|$)/u, async route => {
    state.accountRequests.push(new URL(route.request().url()).pathname);
    await route.fulfill({ status: 503, json: { error: 'accounts_unavailable' } });
  });
  // Same controlled Flight transport as site-week-rollover.spec.ts. The real
  // route must supply requestedWeek; the fixture changes only provider evidence.
  await page.route(/\/my-fantasy(?:\?|$)/u, async route => {
    const headers = route.request().headers();
    if (headers.rsc !== '1') return route.continue();
    if (headers['next-router-prefetch'] === '1') return route.abort();
    const requested = new URL(route.request().url()).searchParams.get('week');
    const week = requested === null ? state.currentWeek : Number(requested);
    state.navigations.push(requested === null ? null : week);
    const response = await route.fetch();
    let sourceReplacements = 0;
    let viewReplacements = 0;
    function replaceProps(value: unknown, inheritedLeague?: LeagueKey): void {
      if (!value || typeof value !== 'object') return;
      let league = inheritedLeague;
      if (!Array.isArray(value)) {
        const props = value as Record<string, unknown>;
        if ('leagues' in props && 'evaluatedAt' in props) {
          expect(props.requestedWeek === '$undefined' ? undefined : props.requestedWeek).toBe(requested === null ? undefined : week);
          props.evaluatedAt = evaluatedAt();
          viewReplacements += 1;
        }
        if ('site' in props && 'source' in props) {
          league = (props.site as { key: LeagueKey }).key;
          expect(leagues).toContain(league);
          props.standingsData = null;
          props.honors = null;
        }
        if ('snapshotRevision' in props && 'periodContext' in props && 'data' in props) {
          expect(league).toBeDefined();
          const data = fantasyFixture(league!, week);
          data.updatedAt = evaluatedAt();
          Object.assign(props, { data, periodContext: context(week), snapshotRevision: SNAPSHOT_A,
            verifiedAt: evaluatedAt(), standings: null, rollover: { week: state.currentWeek,
              evaluatedAt: evaluatedAt(), nextRolloverAt: state.currentWeek === 1 ? cutoff
                : state.currentWeek === 2 ? laterCutoff : state.currentWeek === 3 ? thirdCutoff : '2026-10-06T16:00:00.000Z' } });
          sourceReplacements += 1;
          return;
        }
      }
      Object.values(value).forEach(child => replaceProps(child, league));
    }
    const body = (await response.text()).split('\n').map(line => {
      const separator = line.indexOf(':');
      if (separator < 0) return line;
      let value: unknown;
      try { value = JSON.parse(line.slice(separator + 1)); } catch { return line; }
      replaceProps(value);
      return `${line.slice(0, separator + 1)}${JSON.stringify(value)}`;
    }).join('\n');
    expect(sourceReplacements, 'Every existing league reader receives the same calendar authority').toBe(3);
    expect(viewReplacements, 'The real My Fantasy page receives its original query selection').toBe(1);
    await route.fulfill({ response, body });
  });
  await page.route('**/api/matchups/**', async route => {
    const url = new URL(route.request().url());
    const league = url.pathname.split('/')[3] as LeagueKey;
    const week = Number(url.searchParams.get('week'));
    const data = fantasyFixture(league, week);
    data.updatedAt = evaluatedAt();
    const headers = Object.fromEntries(snapshotHeaders(SNAPSHOT_A, data.updatedAt, context(week)));
    await route.fulfill({ headers, json: url.pathname.endsWith('/revision')
      ? { status: 'ok', revision: SNAPSHOT_A, verifiedAt: data.updatedAt } : data });
  });
  await page.goto('/managers', { waitUntil: 'networkidle' });
  await navigation(page, 390).getByRole('link', { name: 'My Fantasy', exact: true }).click();
  await expectFantasyWeek(page, 1);
  await page.clock.pauseAt(new Date(before));
  return state;
}

function fantasyFixture(league: LeagueKey, week: number) {
  const first = snapshotFixture(week);
  const second = snapshotFixture(week);
  second.teams.forEach(team => { team.id += 2; });
  const data = { ...first, teams: [...first.teams, ...second.teams], matchups: [...first.matchups, ...second.matchups] };
  data.league.rosterPositions = ['QB'];
  for (const team of data.teams) {
    team.name = teamName(league, team.id);
    team.managerName = `Fantasy Manager ${team.id}`;
  }
  data.matchups.forEach((matchup, index) => {
    matchup.id = `${league}-fantasy-matchup-${index}`;
    matchup.status = 'live';
    matchup.winProbability = { modelVersion: 'normal-v2', status: 'estimated', teams: [
      { teamId: matchup.sides[0].team.id, probability: oddTeamWinChance[league] },
      { teamId: matchup.sides[1].team.id, probability: 1 - oddTeamWinChance[league] },
    ] };
    for (const side of matchup.sides) {
      side.points = actualPoints(league, side.team.id);
      side.projectedPoints = projectedPoints(league, side.team.id);
      side.starters[0] = { ...side.starters[0], id: playerId(league, side.team.id),
        name: side.team.id % 2 === 0 ? 'Trevor Lawrence' : 'Patrick Mahomes', position: 'QB', slot: 'QB',
        points: side.points, projectedPoints: side.projectedPoints,
        game: { kind: 'scheduled', opponent: 'TEN', location: 'away', date: '2026-09-13',
          kickoffAt: '2026-09-13T17:00:00.000Z',
          liveScore: { teamScore: 7, opponentScore: 3, phase: 'q2', clockSeconds: 300 } } };
      side.bench = [{ ...side.starters[0], id: `${playerId(league, side.team.id)}-bench`,
        name: side.team.id % 2 === 0 ? 'Josh Allen' : 'Justin Herbert', slot: 'BN', points: 199, projectedPoints: 220 }];
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
    [ownTeam, opponent].map(team => teamName(league, team)));
  await expect(toggle.locator('[data-score-number]')).toHaveText(
    [ownTeam, opponent].map(team => actualPoints(league, team).toFixed(2)));
  await expect(toggle.locator('[data-team-projection-number]')).toHaveText(
    [ownTeam, opponent].map(team => projectedPoints(league, team).toFixed(2)));
}

async function openFantasyFixture(page: Page, options: { staleInitialRefresh?: boolean; incompleteVerification?: boolean;
  leagueLabels?: Partial<Record<LeagueKey, string>> } = {}) {
  const state = { documents: 0, full: { league1: 0, league2: 0, dynasty: 0 },
    refreshRequests: 0, refreshFinished: 0, refreshFailures: 0,
    readerRequests: 0, readerFinished: 0, readerFailures: [] as string[],
    holdRefreshMarker: options.staleInitialRefresh ?? false, staleRefreshes: 0,
    weeks: {} as Partial<Record<LeagueKey, number>>,
    boxRequests: [] as Array<{ league: LeagueKey; season: string | null; week: number; queryKeys: string[] }>,
    providerRequests: [] as string[], accountRequests: [] as string[] };
  await page.clock.install({ time: new Date('2026-09-13T16:00:00.000Z') });
  await page.clock.pauseAt(new Date('2026-09-13T16:01:00.000Z'));
  await page.addInitScript(preferences => {
    for (const [key, value] of preferences) {
      // Reloading must retain later choices made through the existing My Team controls.
      if (localStorage.getItem(key) === null) localStorage.setItem(key, value);
    }
  }, leagues.map(league => [storageKey(league), String(savedTeams[league])]));
  await page.route(/\/api\/me(?:\/|\?|$)/u, async route => {
    state.accountRequests.push(new URL(route.request().url()).pathname);
    await route.fulfill({ status: 503, json: { error: 'accounts_unavailable' },
      headers: { 'Cache-Control': 'private, no-store' } });
  });
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
      if ((!state.holdRefreshMarker && !options.leagueLabels) || new URL(request.url()).pathname !== '/my-fantasy'
        || headers.rsc !== '1' || headers['next-router-prefetch']) return route.continue();
      // A successful refresh can still carry old server props. Keep the marker
      // for the first wave only; later retries receive the untouched response.
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      let body = await response.text();
      if (state.holdRefreshMarker) {
        const siteName = '"site":{"key":"league1","name":"League One"';
        expect(body.split(siteName)).toHaveLength(2);
        state.staleRefreshes += 1;
        body = body.replace(siteName, siteName.replace('League One', initialServerHeading));
      }
      for (const league of leagues) {
        const label = options.leagueLabels?.[league];
        if (!label) continue;
        const siteName = `"site":{"key":"${league}","name":${JSON.stringify(LEAGUE_SITES[league].name)}`;
        expect(body.split(siteName), 'Layout labels come from actual server props').toHaveLength(2);
        body = body.replace(siteName, `"site":{"key":"${league}","name":${JSON.stringify(label)}`);
      }
      return route.fulfill({ response, body });
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
      body = body.replace(siteName, siteName.replace('League One', initialServerHeading));
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
      const data = fantasyFixture(league, week);
      if (options.incompleteVerification && league === 'dynasty') data.warning = 'Player availability coverage is incomplete.';
      await route.fulfill({ headers, json: data });
    }
  });
  await page.goto('/my-fantasy', { waitUntil: 'networkidle' });
  await expect(serverHeading(page)).toHaveText(initialServerHeading, { timeout: 20_000 });
  await page.clock.runFor(61_000);
  for (const league of leagues) {
    await expectSelectedScores(card(page, league), league, savedTeams[league]);
    await expect(card(page, league).locator(`a[href="${LEAGUE_SITES[league].prefix}/my-team"]`))
      .toHaveAttribute('href', `${LEAGUE_SITES[league].prefix}/my-team`);
    const summary = card(page, league).locator('[data-matchup-toggle]');
    await expect(card(page, league).locator('[data-matchup-presentation="fantasy"]')).toHaveCount(1);
    await expect(summary).toHaveAccessibleName(/record 0 wins, 0 losses/u);
    await expect(summary.locator('[data-manager-name-text]')).toHaveCount(2);
    await expect(summary.locator('[data-team-record]')).toHaveCount(2);
    await expect(summary.locator('[data-win-chance]')).toHaveCount(1);
    await expect(card(page, league).locator('.manager-championship-trophy')).toHaveCount(0);
    await expect(summary).toHaveAccessibleName(/projected score.*Current rank .*projected rank/u);
    await expect(summary.locator('[data-fantasy-rank]')).toHaveCount(1);
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
  expect(state.accountRequests, 'Explicit My Team selections do not depend on account reads').toEqual([]);
  await expect(page.getByText('1–1–1 projected', { exact: true })).toBeVisible();
  // These deliberately future-dated verification headers preserve adopted
  // fixtures through RSC refreshes; they cannot honestly claim recent updates.
  await expect(page.getByText('Update time unavailable', { exact: true })).toBeVisible();
  await expect(page.locator('[data-fantasy-no-issues]')).toHaveText('No lineup issues');
  await expect(page.locator('[data-fantasy-clear-icon]')).toBeVisible();
  await expect(page.getByText('Starting lineup unverified', { exact: true })).toHaveCount(0);
  await expect(page.getByText(/^\d+ lineups? could not be verified\.$/u)).toHaveCount(0);
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
    const myTeamIntro = await pageIntroGeometry(page);
    await page.goto('/league2/matchups', { waitUntil: 'networkidle' });
    const matchupsIntro = await pageIntroGeometry(page);
    const nav = navigation(page, width);
    const links = nav.locator(':scope > a');
    await expect(links).toHaveText(['My Fantasy', 'My Team', 'Matchups', 'League']);
    await expect(nav.getByRole('link', { name: 'My Fantasy', exact: true })).toHaveAttribute('href', '/my-fantasy');
    await expect(nav.getByRole('link', { name: 'My Team', exact: true })).toHaveAttribute('href', '/league2/my-team');
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1),
      `League Two navigation must fit ${width}px`).toBe(true);
    await nav.getByRole('link', { name: 'My Fantasy', exact: true }).click();
    await expect(page).toHaveURL(/\/my-fantasy$/u);
    await expect(page.getByRole('heading', { level: 1, name: 'My Fantasy', exact: true })).toBeVisible();
    const fantasyIntro = await pageIntroGeometry(page);
    for (const [label, reference] of [['My Team', myTeamIntro], ['Matchups', matchupsIntro]] as const) {
      expect(fantasyIntro.typography, `My Fantasy matches ${label} heading typography at ${width}px`).toEqual(reference.typography);
      expect(fantasyIntro.seasonText).toBe(reference.seasonText);
      for (const field of ['top', 'left', 'seasonGap', 'selectorTop', 'selectorRight'] as const) {
        expect(Math.abs(fantasyIntro[field] - reference[field]),
          `My Fantasy matches ${label} ${field} at ${width}px`).toBeLessThanOrEqual(1);
      }
    }
    const overview = page.locator('[data-fantasy-overview]');
    await expect(overview).toBeVisible();
    expect((await overview.boundingBox())!.y, 'The season sits above the cross-league overview')
      .toBeGreaterThanOrEqual(fantasyIntro.seasonBottom);
    await expect(nav.getByRole('link', { name: 'My Fantasy', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(nav.getByRole('link', { name: 'My Team', exact: true })).not.toHaveAttribute('aria-current', 'page');
    await expect(page.locator('[data-my-fantasy-league]')).toHaveCount(0);
    await page.waitForLoadState('networkidle');
    const switcher = page.locator('.league-switcher-trigger:visible');
    await switcher.press('Enter');
    const choices = page.locator('.league-switcher-panel:visible a');
    await expect(choices).toHaveCount(3);
    for (const league of leagues) await expect(page.locator('.league-switcher-panel:visible')
      .getByRole('link', { name: `View ${LEAGUE_SITES[league].name}`, exact: true })).toHaveCount(1);
    await switcher.press('Escape');
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1),
      `Global My Fantasy navigation must fit ${width}px`).toBe(true);
  });
}

test('My Fantasy shares exact-week navigation across every card and retains selection on reload', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.addInitScript(preferences => preferences.forEach(([key, value]) => localStorage.setItem(key, value)),
    leagues.map(league => [storageKey(league), String(savedTeams[league])]));
  await page.goto('/my-fantasy', { waitUntil: 'networkidle' });
  const picker = page.getByRole('combobox', { name: 'Matchup week', exact: true });
  const currentWeek = Number(await picker.inputValue());
  await expectFantasyWeek(page, currentWeek);
  await expect(picker.locator('option:checked')).toHaveText(`Week ${currentWeek} · Current`);
  const weeks = await picker.locator('option').evaluateAll(options => options.map(option => Number((option as HTMLOptionElement).value)));
  const anotherWeek = weeks.find(week => week !== currentWeek)!;
  expect(anotherWeek).toBeDefined();
  await picker.selectOption(String(anotherWeek));
  await expect(page).toHaveURL(new RegExp(`/my-fantasy\\?week=${anotherWeek}$`, 'u'));
  await expectFantasyWeek(page, anotherWeek);
  for (const league of leagues) await expect(card(page, league).getByRole('link', { name: `Enter ${LEAGUE_SITES[league].name}`, exact: true }))
    .toHaveAttribute('href', `${LEAGUE_SITES[league].prefix}/my-team?week=${anotherWeek}`);
  await page.reload({ waitUntil: 'networkidle' });
  await expectFantasyWeek(page, anotherWeek);
  const current = page.getByRole('link', { name: 'Back to current', exact: true });
  await expect(current).toHaveAttribute('href', '/my-fantasy');
  await current.click();
  await expect(page).toHaveURL(/\/my-fantasy$/u);
  await expectFantasyWeek(page, currentWeek);
  await expect(current).toHaveCount(0);
  // The dropdown's Current option also clears the numeric pin.
  await picker.selectOption(String(anotherWeek));
  await expectFantasyWeek(page, anotherWeek);
  await picker.selectOption(String(currentWeek));
  await expect(page).toHaveURL(/\/my-fantasy$/u);
  await expectFantasyWeek(page, currentWeek);
  expect(await page.evaluate(keys => keys.map(key => localStorage.getItem(key)), leagues.map(storageKey))).toEqual(['1', '2', '3']);
});

test('My Fantasy follows current-week rollover across all cards while explicit weeks stay pinned', async ({ page }) => {
  const state = await openFantasyCalendar(page);
  const picker = page.getByRole('combobox', { name: 'Matchup week', exact: true });
  const initialNavigations = state.navigations.length;
  state.currentWeek = 2;
  await page.clock.runFor(1_999);
  expect(state.navigations).toHaveLength(initialNavigations);
  await page.clock.runFor(1);
  await expectFantasyWeek(page, 2);
  expect(new URL(page.url()).searchParams.has('week')).toBe(false);
  expect(state.navigations.at(-1)).toBeNull();
  await picker.selectOption('3');
  await expect(page).toHaveURL(/\/my-fantasy\?week=3$/u);
  await expectFantasyWeek(page, 3);
  // The pinned future week becomes current while hidden, then historical on a
  // later refresh. Visibility uses the existing site rollover signal.
  const visibility = async (visible: boolean) => page.evaluate(value => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => value ? 'visible' : 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  }, visible);
  await visibility(false);
  state.currentWeek = 3;
  await page.clock.setSystemTime(new Date('2026-09-22T16:00:01.000Z'));
  await visibility(true);
  await expect(picker.locator('option[value="3"]')).toContainText('Current');
  await expectFantasyWeek(page, 3);
  await expect(page).toHaveURL(/\/my-fantasy\?week=3$/u);
  await visibility(false);
  state.currentWeek = 4;
  await page.clock.setSystemTime(new Date('2026-09-29T16:00:01.000Z'));
  await visibility(true);
  await expect(picker.locator('option[value="4"]')).toContainText('Current');
  await expectFantasyWeek(page, 3);
  await expect(page).toHaveURL(/\/my-fantasy\?week=3$/u);
  const current = page.getByRole('link', { name: 'Back to current', exact: true });
  await expect(current).toHaveAttribute('href', '/my-fantasy');
  // The separate real-response navigation test verifies Current and reload.
  // Keep this controlled calendar transport focused on rollover and pinning;
  // cached navigation may correctly return an empty Flight patch with no props.
  expect(state.accountRequests).toEqual([]);
  expect(state.providerRequests).toEqual([]);
  await page.unrouteAll({ behavior: 'wait' });
});

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

test('My Fantasy includes only explicit current My Team selections from manager profiles', async ({ page }) => {
  const accountRequests: string[] = [];
  await page.route(/\/api\/me(?:\/|\?|$)/u, async route => {
    accountRequests.push(new URL(route.request().url()).pathname);
    await route.fulfill({ status: 401, json: { error: 'unauthenticated' } });
  });
  const selections = () => page.evaluate(keys => keys.map(key => localStorage.getItem(key)), leagues.map(storageKey));
  async function chooseTeam(league: LeagueKey, team: number, selected: boolean) {
    await page.goto(`${LEAGUE_SITES[league].prefix}/managers/${team}`, { waitUntil: 'networkidle' });
    const choose = page.locator('.manager-heading .my-team-button');
    await expect(choose).toHaveAttribute('aria-pressed', String(!selected));
    await choose.click();
    await expect(choose).toHaveAttribute('aria-pressed', String(selected));
    await page.goto('/my-fantasy', { waitUntil: 'networkidle' });
  }
  await page.goto('/my-fantasy', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-my-fantasy-league]')).toHaveCount(0);
  expect(await selections()).toEqual([null, null, null]);
  await chooseTeam('league1', 1, true);
  await expect(page.locator('[data-my-fantasy-league]')).toHaveCount(1);
  await expect(card(page, 'league1')).toBeVisible();
  // League One's affiliation cannot create a League Two card or a saved choice.
  await expect(card(page, 'league2')).toHaveCount(0);
  await expect(card(page, 'dynasty')).toHaveCount(0);
  expect(await selections()).toEqual(['1', null, null]);
  await chooseTeam('league2', 2, true);
  await expect(page.locator('[data-my-fantasy-league]')).toHaveCount(2);
  await expect(card(page, 'league1')).toBeVisible();
  await expect(card(page, 'league2')).toBeVisible();
  expect(await selections()).toEqual(['1', '2', null]);

  await page.evaluate(key => localStorage.setItem(key, '999999'), storageKey('dynasty'));
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.locator('[data-my-fantasy-league]')).toHaveCount(2);
  await expect(card(page, 'dynasty')).toHaveCount(0);
  expect(await selections()).toEqual(['1', '2', '999999']);
  await chooseTeam('league1', 1, false);
  await expect(page.locator('[data-my-fantasy-league]')).toHaveCount(1);
  await expect(card(page, 'league1')).toHaveCount(0);
  await expect(card(page, 'league2')).toBeVisible();
  expect(await selections()).toEqual([null, '2', '999999']);
  await chooseTeam('league2', 2, false);
  await expect(page.locator('[data-my-fantasy-league]')).toHaveCount(0);
  expect(await selections()).toEqual([null, null, '999999']);
  expect(accountRequests, 'Signed-out visitors use the same explicit selections without account calls').toEqual([]);
});

test('My Fantasy keeps league expansions independent and each bench behind a second tap', async ({ page }) => {
  await openFantasyFixture(page);
  const one = card(page, 'league1').locator('[data-matchup-toggle]');
  const two = card(page, 'league2').locator('[data-matchup-toggle]');
  await one.click();
  await expect(one).toHaveAttribute('aria-expanded', 'true');
  const bench = card(page, 'league1').getByRole('button', { name: 'Bench', exact: true });
  await expect(bench).toHaveAttribute('aria-expanded', 'false');
  await expect(card(page, 'league1').locator('[data-bench-row]').first()).toBeHidden();
  await bench.press('Enter');
  await expect(bench).toHaveAttribute('aria-expanded', 'true');
  await expect(card(page, 'league1').locator('[data-bench-row]').first()).toBeVisible();
  await bench.click();
  await expect(bench).toHaveAttribute('aria-expanded', 'false');
  await expect(card(page, 'league1').locator('[data-bench-row]').first()).toBeHidden();
  await bench.click();

  await two.click();
  await expect(one).toHaveAttribute('aria-expanded', 'true');
  await expect(two).toHaveAttribute('aria-expanded', 'true');
  await expect(bench).toHaveAttribute('aria-expanded', 'true');
  await expect(card(page, 'league1').locator('[data-bench-row]').first()).toBeVisible();
  await expect(card(page, 'league2').getByRole('button', { name: 'Bench', exact: true })).toHaveAttribute('aria-expanded', 'false');
  await one.click();
  await expect(one).toHaveAttribute('aria-expanded', 'false');
  await expect(two).toHaveAttribute('aria-expanded', 'true');
  await expect(bench).toBeHidden();
  await one.click();
  await expect(bench).toHaveAttribute('aria-expanded', 'true');
  await expect(card(page, 'league1').locator('[data-bench-row]').first()).toBeVisible();
  await two.click();
  await expect(one).toHaveAttribute('aria-expanded', 'true');
  await expect(two).toHaveAttribute('aria-expanded', 'false');
  // Even a bench score greater than either starting total must never change the summary.
  await expectSelectedScores(card(page, 'league1'), 'league1', savedTeams.league1);
  await expectSelectedScores(card(page, 'league2'), 'league2', savedTeams.league2);
  await one.click();
  await expect(page.locator('[data-matchup-toggle][aria-expanded="true"]')).toHaveCount(0);
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
    const opponent = team % 2 === 0 ? team - 1 : team + 1;
    const ownPanel = container.locator(`[data-player-box-score][data-player-side="left"][data-box-score-key="player:${playerId(league, team)}"]`);
    const opponentPanel = container.locator(`[data-player-box-score][data-player-side="right"][data-box-score-key="player:${playerId(league, opponent)}"]`);
    await expect(ownPanel.locator('[data-box-score-summary]')).toHaveText(`17/27 CMP, ${200 + team} YD, 1 TD, 1 INT, 5 CAR, 29 YD`);
    await expect(opponentPanel.locator('[data-box-score-summary]')).toHaveText(`17/27 CMP, ${200 + opponent} YD, 1 TD, 1 INT, 5 CAR, 29 YD`);
    await expect(row).toHaveAttribute('aria-expanded', 'true');
    await expectSelectedScores(container, league, team);
    await expect(page).toHaveURL(/\/my-fantasy$/u);
    await row.press('Enter');
    await expect(ownPanel).toBeHidden();
    await expect(opponentPanel).toBeHidden();
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

test('My Fantasy attention aligns long IR and availability alerts without hiding stored win probability', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 900 });
  const longLeagueName = 'League Two Regional Championship Superflex';
  const state = await openFantasyFixture(page, { incompleteVerification: true,
    leagueLabels: { league2: longLeagueName } });
  await expect(card(page, 'dynasty').locator('[data-fantasy-status]')).toHaveAttribute('data-fantasy-status', 'unknown');
  const noIssues = page.locator('[data-fantasy-no-issues]');
  await expect(noIssues).toHaveText('No lineup issues');
  const clearStyle = await noIssues.evaluate(element => {
    const panel = getComputedStyle(element);
    const icon = getComputedStyle(element.querySelector('[data-fantasy-clear-icon]')!);
    return { border: Number.parseFloat(panel.borderTopWidth), background: panel.backgroundColor,
      iconBackground: icon.backgroundColor, iconColor: icon.color, iconRadius: icon.borderRadius };
  });
  expect(clearStyle.border).toBeGreaterThan(0);
  expect(clearStyle.background).not.toBe('rgba(0, 0, 0, 0)');
  expect(clearStyle.iconRadius).toBe('50%');
  expect(clearStyle.iconColor).toBe('rgb(255, 255, 255)');
  const iconRgb = clearStyle.iconBackground.match(/[\d.]+/gu)!.map(Number);
  expect(iconRgb[1], 'The no-issues circle is green').toBeGreaterThan(Math.max(iconRgb[0], iconRgb[2]));
  const selectedStarters = {
    league1: [
      { name: 'Selected OUT Starter with a Particularly Long Name', status: 'OUT' },
      { name: 'Jonathan Brooks Injured Reserve Starting Running Back', status: 'IR' },
      { name: 'Selected Suspended Starting Wide Receiver', status: 'SUSPENDED' },
    ],
    league2: [
      { name: 'Selected Doubtful Starter with a Particularly Long Name', status: 'DOUBTFUL' },
      { name: 'Selected OUT Running Back with Another Long Name', status: 'OUT' },
      { name: 'Selected Available Starting Receiver', status: null },
    ],
    dynasty: [
      { name: 'Selected Questionable Starter', status: 'QUESTIONABLE' },
      { name: 'Selected Available Running Back', status: null },
      { name: 'Selected Available Starting Receiver', status: null },
    ],
  };
  const issues = [...selectedStarters.league1, ...selectedStarters.league2.slice(0, 2)];
  // Adopt another accepted snapshot through the existing reader. Every NFL game
  // is pre-kickoff with zero actual points. Stored normal-v3 odds remain usable
  // even when an inactive starter needs attention; the UI must not recompute them.
  await page.route('**/api/matchups/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/box-scores')) return route.fallback();
    const league = url.pathname.split('/')[3] as LeagueKey;
    expect(leagues).toContain(league);
    const week = Number(url.searchParams.get('week'));
    expect(week).toBe(state.weeks[league]);
    const revision = ['e', 'f', '1'][leagues.indexOf(league)].repeat(64);
    const nextVerifiedAt = '2099-09-03T12:01:00.000Z';
    const headers = Object.fromEntries(snapshotHeaders(revision, nextVerifiedAt, contextFixture('active', week)));
    if (url.pathname.endsWith('/revision')) {
      await route.fulfill({ headers, json: { status: 'ok', revision, verifiedAt: nextVerifiedAt } });
      return;
    }
    const data = fantasyFixture(league, week);
    data.league.rosterPositions = ['QB', 'RB', 'WR'];
    for (const matchup of data.matchups) {
      matchup.status = 'upcoming';
      const firstProbability = league === 'league1' ? 0.5 : oddTeamWinChance[league];
      matchup.winProbability = { modelVersion: 'normal-v3', status: 'estimated', teams: [
        { teamId: matchup.sides[0].team.id, probability: firstProbability },
        { teamId: matchup.sides[1].team.id, probability: 1 - firstProbability },
      ] };
      for (const side of matchup.sides) {
        const selected = side.team.id === savedTeams[league];
        side.points = 0;
        side.starters = selectedStarters[league].map((starter, index) => {
          const status = selected ? starter.status : 'OUT';
          return { ...side.starters[0], id: `${playerId(league, side.team.id)}-${index}`,
            slot: data.league.rosterPositions![index], position: data.league.rosterPositions![index],
            name: selected ? starter.name : `Opponent OUT ${league} ${side.team.id} ${index}`,
            injuryStatus: status, points: 0, projectedPoints: status && ['OUT', 'IR', 'SUSPENDED'].includes(status) ? 0 : 10,
            game: { kind: 'scheduled', opponent: 'TEN', location: 'away', date: '2026-09-13',
              kickoffAt: '2026-09-13T17:00:00.000Z' } };
        });
        side.projectedPoints = side.starters.reduce((total, player) => total + player.projectedPoints!, 0);
        side.bench = [{ ...side.starters[0], id: `${playerId(league, side.team.id)}-bench`,
          name: `Bench OUT ${league} ${side.team.id}`, slot: 'BN', injuryStatus: 'OUT' }];
      }
    }
    expect(isMatchupsData(data)).toBe(true);
    await route.fulfill({ headers, json: data });
  });
  for (let step = 0; step < 13; step += 1) {
    await page.clock.runFor(5_000);
    await expect.poll(() => state.readerFinished === state.readerRequests).toBe(true);
  }
  expect(state.readerFailures).toEqual([]);
  const panel = page.locator('section[aria-labelledby="fantasy-attention-heading"]');
  await expect(panel.getByRole('heading', { name: '5 starting positions need attention', exact: true })).toBeVisible();
  const rows = panel.locator('[data-fantasy-attention-row]');
  await expect(rows).toHaveCount(issues.length);
  await expect(rows.locator('[data-fantasy-attention-player]')).toHaveText(issues.map(issue => issue.name));
  await expect(panel).not.toContainText(/Opponent|Bench|Questionable/u);
  await expect(panel.getByText('OUT', { exact: true })).toHaveCount(2);
  await expect(panel.getByText('IR', { exact: true })).toBeVisible();
  await expect(panel.getByText('SUSPENDED', { exact: true })).toBeVisible();
  await expect(panel.getByText('DOUBTFUL', { exact: true })).toBeVisible();
  await expect(panel.getByText('Starting', { exact: true })).toHaveCount(issues.length);
  await expect(panel.getByText(longLeagueName, { exact: true })).toHaveCount(2);
  await expect(panel.locator('h2 svg')).toHaveCount(1);
  await expect(panel.locator('h2 span[aria-hidden="true"]')).toHaveCount(0);
  await expect(page.locator('[data-fantasy-no-issues]')).toHaveCount(0);
  for (const league of leagues) await expect(card(page, league).locator('[data-fantasy-status]'))
    .toHaveAttribute('data-fantasy-status', league === 'dynasty' ? 'clear' : 'alert');
  const headerDots = page.locator('[data-fantasy-status]');
  const rowDots = rows.locator(':scope > span[aria-hidden="true"]');
  await expect(headerDots).toHaveCount(3);
  await expect(rowDots).toHaveCount(issues.length);
  const dotSizes = await headerDots.or(rowDots).evaluateAll(nodes => nodes.map(node => {
    const rect = node.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  }));
  for (const size of dotSizes) {
    expect(size.width).toBe(11);
    expect(size.height).toBe(11);
  }
  const colors = await rows.evaluateAll(nodes => nodes.map(node => ({
    dot: getComputedStyle(node.querySelector(':scope > span[aria-hidden="true"]')!).backgroundColor,
    designation: getComputedStyle(node.querySelector('[data-fantasy-attention-details] > span:first-child')!).color,
  })));
  for (const color of colors) expect(color.dot).toBe(color.designation);
  expect(colors[0].designation, 'OUT and DOUBTFUL use distinct alert and caution colors').not.toBe(colors[3].designation);
  const irCard = card(page, 'league1');
  const irProbability = irCard.locator('[data-win-chance-track]');
  await expect(irCard.locator('[data-fantasy-status]')).toHaveAttribute('data-fantasy-status', 'alert');
  await expect(irProbability).toBeVisible();
  await expect(irProbability.locator('[data-win-chance-side]')).toHaveText(['50%', '50%']);
  await expect(irProbability).toHaveAttribute('data-win-chance-tone', 'neutral');
  await expect(irProbability.locator('[data-win-chance-fill]')).toBeVisible();

  for (const textScale of [1, 1.5]) {
    if (textScale > 1) {
      // Explicit text-only resize stress preserves viewport width and dot size.
      await panel.locator('h2, [data-fantasy-attention-row]').evaluateAll(nodes => nodes.forEach(node => {
        const element = node as HTMLElement;
        element.style.fontSize = `${Number.parseFloat(getComputedStyle(element).fontSize) * 1.5}px`;
      }));
    }
    for (const width of [320, 390, 430, 900, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      if (width === 390 || width === 900) await page.screenshot({
        path: testInfo.outputPath(`attention-${width}px-${textScale * 100}-percent.png`), fullPage: true,
      });
      const geometry = await rows.evaluateAll(nodes => nodes.map(node => {
        const player = node.querySelector('[data-fantasy-attention-player]')!;
        const details = node.querySelector('[data-fantasy-attention-details]')!;
        const status = details.querySelector(':scope > span:first-child')!;
        const starting = details.querySelector(':scope > span:last-child')!.getBoundingClientRect();
        const league = node.querySelector('[data-fantasy-attention-league]')!;
        const statusBox = status.getBoundingClientRect();
        const playerBox = player.getBoundingClientRect();
        const leagueBox = league.getBoundingClientRect();
        return { statusWidth: status.clientWidth, statusScrollWidth: status.scrollWidth,
          statusLeft: statusBox.left, statusRight: statusBox.right, statusTop: statusBox.top, statusBottom: statusBox.bottom,
          startingLeft: starting.left, startingTop: starting.top, startingBottom: starting.bottom,
          playerLeft: playerBox.left, playerRight: playerBox.right, playerTop: playerBox.top, playerBottom: playerBox.bottom,
          playerWidth: player.clientWidth, playerScrollWidth: player.scrollWidth,
          leagueLeft: leagueBox.left, leagueTop: leagueBox.top, leagueBottom: leagueBox.bottom, leagueRight: leagueBox.right,
          leagueWidth: league.clientWidth, leagueScrollWidth: league.scrollWidth,
          rowRight: node.getBoundingClientRect().right, rowWidth: node.clientWidth, rowScrollWidth: node.scrollWidth };
      }));
      for (const row of geometry) {
        const context = `at ${width}px and ${textScale * 100}% text`;
        expect(row.statusScrollWidth, `The complete availability status fits ${context}`).toBeLessThanOrEqual(row.statusWidth + 1);
        expect(row.statusRight, `Availability cannot overlap Starting ${context}`).toBeLessThanOrEqual(row.startingLeft - 1);
        expect(row.playerScrollWidth, `Long player names wrap ${context}`).toBeLessThanOrEqual(row.playerWidth + 1);
        expect(row.leagueScrollWidth, `Long league names wrap ${context}`).toBeLessThanOrEqual(row.leagueWidth + 1);
        expect(Math.abs(row.leagueRight - row.rowRight), `League labels align right ${context}`).toBeLessThanOrEqual(1);
        expect(row.rowScrollWidth, `The row fits ${context}`).toBeLessThanOrEqual(row.rowWidth + 1);
        if (width <= 430) {
          expect(Math.abs(row.playerTop - row.leagueTop), `Player and league begin together ${context}`).toBeLessThanOrEqual(1);
          expect(row.playerRight, `Player and league names cannot overlap ${context}`).toBeLessThanOrEqual(row.leagueLeft - 1);
          expect(row.statusTop, `Availability follows both complete names ${context}`)
            .toBeGreaterThanOrEqual(Math.max(row.playerBottom, row.leagueBottom));
          expect(Math.abs(row.statusLeft - row.playerLeft), `Availability begins under the player ${context}`).toBeLessThanOrEqual(1);
          expect(Math.abs(row.statusTop - row.startingTop), `Status and Starting form one readable group ${context}`).toBeLessThanOrEqual(1);
        } else {
          expect(row.playerRight, `Player name stays before the status column ${context}`).toBeLessThanOrEqual(row.statusLeft - 1);
          expect(Math.abs(row.statusLeft - geometry[0].statusLeft), `Statuses share one column ${context}`).toBeLessThanOrEqual(1);
          expect(Math.abs(row.startingLeft - geometry[0].startingLeft), `Starting shares one column ${context}`).toBeLessThanOrEqual(1);
        }
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
    }
  }
  expect(state.accountRequests).toEqual([]);
  expect(state.providerRequests).toEqual([]);
});

test('My Fantasy cards and inline statistics fit supported phone and desktop widths', async ({ page }) => {
  await openFantasyFixture(page);
  for (const league of leagues) {
    const container = card(page, league);
    await container.locator('[data-matchup-toggle]').click();
    await container.locator('[data-starter-box-score-toggle]').first().click();
    await expect(container.locator('[data-box-score-summary]')).toHaveCount(2);
  }
  await expect(page.locator('[data-matchup-toggle][aria-expanded="true"]')).toHaveCount(3);
  for (const width of [320, 360, 390, 430, 760, 900, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1),
      `My Fantasy document must fit ${width}px`).toBe(true);
    await expect.poll(() => page.locator('[data-my-fantasy-league], [data-player-box-score]:visible')
      .evaluateAll(nodes => nodes.every(node => node.scrollWidth <= node.clientWidth + 1)),
    `My Fantasy cards and expanded statistics must fit ${width}px`).toBe(true);
    const headerGeometry: Array<{ enterRight: number }> = [];
    for (const league of leagues) {
      const container = card(page, league);
      await expect(container.locator('[data-box-score-summary]').first()).toBeVisible();
      const summaryGeometry = await container.locator('[data-matchup-toggle]').evaluate(element => {
        const names = [...element.querySelectorAll<HTMLElement>('[data-team-name]')];
        const meta = [...element.querySelectorAll<HTMLElement>('[data-team-meta]')];
        const scores = [...element.querySelectorAll<HTMLElement>('[data-score-side]')];
        return { names: names.map((name, index) => ({ width: name.clientWidth, scrollWidth: name.scrollWidth,
          height: name.getBoundingClientRect().height, lineHeight: Number.parseFloat(getComputedStyle(name).lineHeight),
          bottom: name.getBoundingClientRect().bottom, metaTop: meta[index].getBoundingClientRect().top })),
        scores: scores.map(score => {
          const number = score.querySelector('[data-score-number]')!.getBoundingClientRect();
          const bounds = score.getBoundingClientRect();
          return { left: number.left, right: number.right, columnLeft: bounds.left, columnRight: bounds.right };
        }) };
      });
      for (const name of summaryGeometry.names) {
        expect(name.scrollWidth, `${league} complete team names wrap inside the card at ${width}px`).toBeLessThanOrEqual(name.width + 1);
        expect(name.bottom, `${league} team names cannot overlap manager metadata at ${width}px`).toBeLessThanOrEqual(name.metaTop + 1);
        if (width === 320) expect(name.height, 'Long fixture names exercise more than two lines')
          .toBeGreaterThan(name.lineHeight * 2);
      }
      for (const score of summaryGeometry.scores) {
        expect(score.left, `${league} official score fits its own column at ${width}px`).toBeGreaterThanOrEqual(score.columnLeft - 1);
        expect(score.right, `${league} official score fits its own column at ${width}px`).toBeLessThanOrEqual(score.columnRight + 1);
      }
      const header = container.locator('[data-fantasy-header]');
      const geometry = await header.evaluate(element => {
        const title = element.querySelector('h2')!.getBoundingClientRect();
        const metadata = element.querySelector('[data-fantasy-metadata]')!;
        const metadataLine = metadata.getBoundingClientRect();
        const logo = element.querySelector('img')!.getBoundingClientRect();
        const enter = element.querySelector('[data-fantasy-enter]')!;
        const dot = element.querySelector('[data-fantasy-status]')!.getBoundingClientRect();
        const textBounds = (node: Element) => {
          const range = document.createRange();
          range.selectNode(node.firstChild!);
          return range.getBoundingClientRect();
        };
        return { titleTop: title.top, titleBottom: title.bottom, metadataTop: textBounds(metadata).top,
          metadataLineBottom: metadataLine.bottom, logoTop: logo.top, logoBottom: logo.bottom,
          metadataBottom: textBounds(metadata).bottom, enterTextBottom: textBounds(enter).bottom,
          enterRight: enter.getBoundingClientRect().right, enterTop: enter.getBoundingClientRect().top, dotBottom: dot.bottom,
          headerRight: element.getBoundingClientRect().right - Number.parseFloat(getComputedStyle(element).paddingRight)
            - Number.parseFloat(getComputedStyle(element).borderRightWidth) };
      });
      headerGeometry.push(geometry);
      expect(geometry.dotBottom, `${league} status dot stays outside the Enter League hit target at ${width}px`).toBeLessThanOrEqual(geometry.enterTop);
      expect(geometry.metadataTop, `${league} provider metadata belongs below the title at ${width}px`)
        .toBeGreaterThanOrEqual(geometry.titleBottom - 1);
      expect(geometry.metadataTop - geometry.titleBottom,
        `${league} provider metadata sits directly below the title at ${width}px`).toBeLessThanOrEqual(6);
      expect(Math.abs(geometry.logoTop - geometry.titleTop),
        `${league} logo starts at the title line at ${width}px`).toBeLessThanOrEqual(2);
      expect(Math.abs(geometry.logoBottom - geometry.metadataLineBottom),
        `${league} logo ends at the metadata line at ${width}px`).toBeLessThanOrEqual(2);
      expect(Math.abs(geometry.metadataBottom - geometry.enterTextBottom),
        `${league} Enter League text shares the metadata baseline at ${width}px`).toBeLessThanOrEqual(2);
      expect(Math.abs(geometry.enterRight - geometry.headerRight),
        `${league} Enter League is right-aligned at ${width}px`).toBeLessThanOrEqual(1);
      await expect(header.locator('[data-fantasy-status]')).toHaveAccessibleName(/Starting lineup|starting position|Matchup complete/u);
      const track = container.locator('[data-win-chance-track]');
      await expect(track).toHaveCount(1);
      await expect(track.locator('[data-win-chance-fill]')).toHaveCount(1);
      await expect(container.locator('[data-win-chance-half]')).toHaveCount(0);
      const probability = { league1: { labels: ['67%', '33%'], tone: 'favored', own: 0.67 },
        league2: { labels: ['35%', '65%'], tone: 'underdog', own: 0.35 },
        dynasty: { labels: ['50%', '50%'], tone: 'neutral', own: 0.5 } }[league];
      await expect(track.locator('[data-win-chance-side]')).toHaveText(probability.labels);
      await expect(track).toHaveAttribute('data-win-chance-tone', probability.tone);
      const fillGeometry = await track.evaluate(element => ({ width: element.getBoundingClientRect().width,
        fill: element.querySelector('[data-win-chance-fill]')!.getBoundingClientRect().width }));
      expect(Math.abs(fillGeometry.fill - fillGeometry.width * probability.own),
        `${league} only the selected team's portion is filled at ${width}px`).toBeLessThanOrEqual(2);
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
    expect(Math.max(...headerGeometry.map(header => header.enterRight)) - Math.min(...headerGeometry.map(header => header.enterRight)),
      `Enter League aligns across all cards at ${width}px`).toBeLessThanOrEqual(1);
  }
});
