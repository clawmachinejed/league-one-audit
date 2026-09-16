import { expect, test, type Page } from '@playwright/test';
import { LEAGUE_IDS } from '../lib/config';
import { LEAGUE_SITES, type LeagueKey } from '../lib/leagues';
import type { MatchupPeriodContext } from '../lib/matchup-period';
import type { MatchupBoxScores } from '../lib/matchup-box-score-types';
import { isMatchupsData } from '../lib/matchups-response';
import { contextFixture, snapshotFixture, snapshotHeaders, SNAPSHOT_A, SNAPSHOT_B } from '../test-support/matchup-snapshot-fixtures';

const FRESH_LINEAGE = '2099-09-03T12:00:00.000Z';
const OWN_BENCH = 'player:fixture-own-bench';
const OTHER_BENCH = 'player:fixture-other-bench';

function myTeamFixture(week: number) {
  const data = snapshotFixture(week);
  const [other, own] = data.matchups[0].sides;
  data.matchups[0].status = 'live';
  other.points = 12.5; other.projectedPoints = 34;
  own.points = 7; own.projectedPoints = 31;
  const game = { kind: 'scheduled' as const, opponent: 'TEN', location: 'away' as const,
    date: '2026-09-13', kickoffAt: '2026-09-13T17:00:00.000Z', finalScore: { teamScore: 23, opponentScore: 10 } };
  // Realistic player names exercise the shared abbreviation rules; fixture role
  // labels such as "Bench Quarterback" would be treated as a compound surname.
  // IDs and values remain synthetic transport fixtures, not these players' results.
  other.bench = [{ ...other.starters[0], id: 'fixture-other-bench', name: 'Mac Jones',
    slot: 'BN', game, points: null, projectedPoints: 11.5 }];
  own.bench = [{ ...own.starters[0], id: 'fixture-own-bench', name: 'A.J. Brown', position: 'WR',
    slot: 'BN', game, points: 0, projectedPoints: 13.25 },
  { ...own.starters[0], id: 'fixture-extra-bench', name: 'TreVeyon Henderson', position: 'RB', slot: 'BN',
    game: null, points: 2.3, projectedPoints: null }];
  // The full league response contains another pair. My Team must display only its own pair.
  const otherPair = snapshotFixture(week, 'Other Matchup');
  otherPair.teams.forEach((team, index) => { team.id = index + 3; team.name = `Other Team ${index + 3}`; });
  otherPair.matchups[0].id = 'other-matchup';
  otherPair.matchups[0].sides.forEach((side, index) => { side.starters[0].id = `other-starter-${index}`; });
  data.teams.push(...otherPair.teams);
  data.matchups.push(otherPair.matchups[0]);
  expect(isMatchupsData(data), 'the My Team fixture must pass the real snapshot boundary').toBe(true);
  return data;
}

async function openMyTeamFixture(page: Page, league: LeagueKey) {
  const state = { week: 0, documentCount: 0, fullCount: 0, boxRequests: [] as string[],
    boxWeeks: [] as number[], providerRequests: [] as string[] };
  await page.clock.install({ time: new Date('2026-09-13T16:00:00.000Z') });
  await page.clock.pauseAt(new Date('2026-09-13T16:01:00.000Z'));
  await page.addInitScript(key => localStorage.setItem(key, '2'), `league-one:my-team:${LEAGUE_IDS[league]}`);
  page.on('request', request => {
    if (/api\.sleeper\.|tank01/iu.test(new URL(request.url()).hostname)) state.providerRequests.push(request.url());
  });
  // As in the existing snapshot protocol tests, retain the real server board and
  // control only its serialized lineage/context before the normal reader adopts a fixture.
  await page.route(/\/(?:(?:league2|dynasty)\/)?my-team(?:\?|$)/u, async route => {
    if (route.request().resourceType() !== 'document') return route.continue();
    const response = await route.fetch();
    const html = await response.text();
    const picker = html.match(/<select\b[^>]*>[\s\S]*?<\/select>/u)?.[0];
    const selectedWeek = picker?.match(/<option\b[^>]*value="(\d+)"[^>]*selected/u);
    expect(selectedWeek, 'My Team server dropdown identifies the selected exact week').toBeTruthy();
    state.week = Number(selectedWeek![1]);
    const dates = [...html.matchAll(/\\"updatedAt\\":\\"([^"\\]+)\\"/gu)];
    const lineage = /\\"snapshotRevision\\":(?:null|\\"[a-f0-9]{64}\\"),\\"verifiedAt\\":(?:null|\\"[^"\\]+\\")/gu;
    expect(dates.length).toBeGreaterThan(0);
    expect([...html.matchAll(lineage)]).toHaveLength(1);
    let body = html.replace(lineage, `\\"snapshotRevision\\":\\"${SNAPSHOT_A}\\",\\"verifiedAt\\":\\"${dates[0][1]}\\"`);
    const period = /\\"periodContext\\":(\{[^{}]*\})/gu;
    expect([...body.matchAll(period)]).toHaveLength(1);
    body = body.replace(period, (_match, serialized: string) => {
      const initial = JSON.parse(serialized.replace(/\\"/gu, '"')) as MatchupPeriodContext;
      return `\\"periodContext\\":${JSON.stringify({ ...initial, ...contextFixture('active', state.week) }).replace(/"/gu, '\\"')}`;
    });
    if (!body.includes('class="refresh-note"')) body = body.replace(/(<p class="updated"[^>]*>[\s\S]*?<\/p>)/u,
      '$1<p class="refresh-note">Checks for a newer matchup snapshot every minute while this page is open.</p>');
    state.documentCount += 1;
    await route.fulfill({ response, body });
  });
  await page.route('**/api/matchups/**', async route => {
    const url = new URL(route.request().url());
    expect(url.pathname.split('/')[3]).toBe(league);
    expect(Number(url.searchParams.get('week'))).toBe(state.week);
    if (url.pathname.endsWith('/box-scores')) {
      state.boxRequests.push(url.pathname);
      state.boxWeeks.push(state.week);
      expect(url.searchParams.get('season')).toBe('2026');
      const data: MatchupBoxScores = { leagueKey: league, season: '2026', week: state.week, status: 'available',
        observedAt: '2026-09-13T16:00:00.000Z', revision: 'my-team-box', players: {
          [OWN_BENCH]: { stats: { rec: 0, rec_yd: 0, rec_td: 0 }, gamePhase: 'final' },
          [OTHER_BENCH]: { stats: { pass_cmp: 17, pass_att: 27, pass_yd: 209, pass_td: 1, pass_int: 1,
            rush_att: 5, rush_yd: 29 }, gamePhase: 'final' },
        } };
      await route.fulfill({ json: data });
      return;
    }
    const headers = Object.fromEntries(snapshotHeaders(SNAPSHOT_B, FRESH_LINEAGE, contextFixture('active', state.week)));
    if (url.pathname.endsWith('/revision')) {
      await route.fulfill({ headers, json: { status: 'ok', revision: SNAPSHOT_B, verifiedAt: FRESH_LINEAGE } });
    } else {
      state.fullCount += 1;
      await route.fulfill({ headers, json: myTeamFixture(state.week) });
    }
  });
  await page.goto(`${LEAGUE_SITES[league].prefix}/my-team`, { waitUntil: 'networkidle' });
  expect(state.documentCount).toBe(1);
  await page.clock.runFor(61_000);
  await expect(page.getByText('Fixture Beta', { exact: true })).toBeVisible();
  expect(state.fullCount).toBe(1);
  expect(state.boxRequests).toEqual([]);
  return state;
}

for (const league of ['league1', 'league2', 'dynasty'] as const) {
  test(`${league} My Team shows the selected side left and expands both exact-week benches`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const state = await openMyTeamFixture(page, league);
    const card = page.locator('article:has([data-matchup-toggle])');
    await expect(card).toHaveCount(1);
    await expect(card.locator('[data-team-name]')).toHaveText(['Fixture Beta', 'Fixture Alpha']);
    await expect(page.getByText('Other Team 3', { exact: true })).toHaveCount(0);
    const header = card.locator('[data-matchup-toggle]');
    const expectHeaderTotals = async () => {
      await expect(header.locator('[data-score-number]')).toHaveText(['7.00', '12.50']);
      await expect(header.locator('[data-team-projection-number]')).toHaveText(['31.00', '34.00']);
    };
    await expectHeaderTotals();
    await expect(header).toHaveAttribute('aria-expanded', 'false');
    await expect(card.getByRole('region', { name: 'Bench players' })).toBeHidden();
    await header.click();
    const bench = card.getByRole('region', { name: 'Bench players' });
    await expect(bench).toBeVisible();
    const rows = bench.locator('[data-bench-row]');
    await expect(rows).toHaveCount(2);
    const first = rows.first();
    await expect(first.locator('[data-player-score-side="left"] [data-player-score-number]')).toHaveText('0.00');
    await expect(first.locator('[data-player-score-side="left"] [data-player-projection-number]')).toHaveText('13.25');
    await expect(first.locator('[data-player-score-side="right"] [data-player-score-number]')).toHaveText('—');
    await expect(first.locator('[data-player-score-side="right"] [data-player-projection-number]')).toHaveText('11.50');
    await expect(rows.nth(1).locator('[data-player-score-side="left"] [data-player-score-number]')).toHaveText('2.30');
    await expect(rows.nth(1).locator('[data-player-score-side="left"] [data-player-projection-number]')).toHaveText('—');
    await expect(rows.nth(1).locator('[data-player-score-side="right"]')).toHaveCount(0);
    await expectHeaderTotals();
    const disclosure = first.locator('[data-bench-box-score-toggle]');
    await expect(disclosure).toHaveAccessibleName('Bench row 1 game statistics for both teams');
    const leftScore = await first.locator('[data-player-score-side="left"]').boundingBox();
    expect(leftScore).not.toBeNull();
    await page.mouse.click(leftScore!.x + leftScore!.width / 2, leftScore!.y + leftScore!.height / 2);
    const ownPanel = page.locator(`[data-player-box-score][data-box-score-key="${OWN_BENCH}"][data-player-side="left"]`);
    const otherPanel = page.locator(`[data-player-box-score][data-box-score-key="${OTHER_BENCH}"][data-player-side="right"]`);
    await expect(ownPanel.locator('[data-box-score-summary]')).toHaveText('0 REC, 0 YD, 0 TD');
    await expect(otherPanel.locator('[data-box-score-summary]')).toHaveText('17/27 CMP, 209 YD, 1 TD, 1 INT, 5 CAR, 29 YD');
    await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
    await expectHeaderTotals();
    for (const width of [320, 390, 430, 760]) {
      await page.setViewportSize({ width, height: 900 });
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1),
        `My Team document should fit ${width}px`).toBe(true);
      await expect.poll(() => bench.locator('[data-player-name], [data-player-meta], [data-player-box-score]:visible')
        .evaluateAll(nodes => nodes.every(node => node.scrollWidth <= node.clientWidth + 1)),
      `My Team bench names, game labels and statistics should fit ${width}px`).toBe(true);
      expect((await disclosure.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    }
    await disclosure.click();
    await expect(ownPanel).toBeHidden();
    await expect(otherPanel).toBeHidden();
    await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    await header.click();
    await expect(bench).toBeHidden();
    await expect(header).toHaveAttribute('aria-expanded', 'false');
    await expectHeaderTotals();
    expect(state.boxRequests).toEqual([`/api/matchups/${league}/box-scores`]);
    expect(state.providerRequests).toEqual([]);
    expect(await page.evaluate(key => localStorage.getItem(key), `league-one:my-team:${LEAGUE_IDS[league]}`)).toBe('2');

    // A pinned week must reload its own snapshot and bench statistics while
    // retaining the same saved team; it must not keep the prior week's panels.
    const originalWeek = state.week;
    const pinnedWeek = originalWeek < 18 ? originalWeek + 1 : originalWeek - 1;
    const path = `${LEAGUE_SITES[league].prefix}/my-team`;
    state.week = pinnedWeek;
    const picker = page.getByRole('combobox', { name: 'Matchup week', exact: true });
    await picker.selectOption(String(pinnedWeek));
    await expect(page).toHaveURL(new RegExp(`${path}\\?week=${pinnedWeek}$`, 'u'));
    await page.reload({ waitUntil: 'networkidle' });
    // The paused clock also controls React's streamed suspense reveal on reload.
    // Advance it before inspecting the page, as on the initial fixture load.
    await page.clock.runFor(61_000);
    await expect(picker).toHaveValue(String(pinnedWeek));
    await expect.poll(() => state.fullCount).toBe(2);
    await expect(card.locator('[data-team-name]')).toHaveText(['Fixture Beta', 'Fixture Alpha']);
    await expect(header).toHaveAttribute('aria-expanded', 'false');
    await header.click();
    await expect(bench).toBeVisible();
    await expect(first.locator('[data-player-score-side="left"] [data-player-score-number]')).toHaveText('0.00');
    await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    await disclosure.click();
    await expect(ownPanel.locator('[data-box-score-summary]')).toHaveText('0 REC, 0 YD, 0 TD');
    await expect(otherPanel.locator('[data-box-score-summary]')).toHaveText('17/27 CMP, 209 YD, 1 TD, 1 INT, 5 CAR, 29 YD');
    expect(state.boxRequests).toHaveLength(2);
    expect(state.boxWeeks).toEqual([originalWeek, pinnedWeek]);
    expect(state.providerRequests).toEqual([]);
    expect(await page.evaluate(key => localStorage.getItem(key), `league-one:my-team:${LEAGUE_IDS[league]}`)).toBe('2');
  });

  test(`${league} My Team shares the Matchups week dropdown, arrows, bounds and Current navigation`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const path = `${LEAGUE_SITES[league].prefix}/my-team`;
    await page.goto(path, { waitUntil: 'networkidle' });
    const picker = page.getByRole('combobox', { name: 'Matchup week', exact: true });
    const currentWeek = Number(await picker.inputValue());
    await expect(picker.locator('option:checked')).toHaveText(`Week ${currentWeek} · Current`);
    await expect(page.getByRole('link', { name: 'Back to current' })).toHaveCount(0);
    const weeks = await picker.locator('option').evaluateAll(options => options.map(option => Number((option as HTMLOptionElement).value)));
    const firstWeek = Math.min(...weeks);
    const lastWeek = Math.max(...weeks);
    expect(firstWeek).toBe(1);
    expect(lastWeek).toBeGreaterThan(firstWeek);

    if (currentWeek > firstWeek) {
      await picker.selectOption(String(firstWeek));
      await expect(page).toHaveURL(new RegExp(`${path}\\?week=${firstWeek}$`, 'u'));
      await page.reload({ waitUntil: 'networkidle' });
      await expect(picker).toHaveValue(String(firstWeek));
    } else {
      test.info().annotations.push({ type: 'Season boundary', description: `${league} has no earlier regular-season week than its current week.` });
    }
    // Matchups intentionally shows the arrow controls only at desktop widths.
    await page.setViewportSize({ width: 760, height: 900 });
    await expect(page.getByRole('button', { name: `Previous week, week ${firstWeek}`, exact: true })).toBeDisabled();
    const next = page.getByRole('link', { name: `Next week, week ${firstWeek + 1}`, exact: true });
    await expect(next).toHaveAttribute('href', `${path}?week=${firstWeek + 1}`);
    await next.click();
    await expect(page).toHaveURL(new RegExp(`${path}\\?week=${firstWeek + 1}$`, 'u'));
    await expect(picker).toHaveValue(String(firstWeek + 1));

    await picker.selectOption(String(lastWeek));
    await expect(page).toHaveURL(new RegExp(`${path}${lastWeek === currentWeek ? '' : `\\?week=${lastWeek}`}$`, 'u'));
    await page.reload({ waitUntil: 'networkidle' });
    await expect(picker).toHaveValue(String(lastWeek));
    await expect(page.getByRole('button', { name: `Next week, week ${lastWeek}`, exact: true })).toBeDisabled();
    if (currentWeek === lastWeek) {
      test.info().annotations.push({ type: 'Season boundary', description: `${league} has no later regular-season week than its current week.` });
    }
    const previous = page.getByRole('link', { name: `Previous week, week ${lastWeek - 1}`, exact: true });
    await expect(previous).toHaveAttribute('href', `${path}?week=${lastWeek - 1}`);
    await previous.click();
    await expect(page).toHaveURL(new RegExp(`${path}\\?week=${lastWeek - 1}$`, 'u'));
    await expect(picker).toHaveValue(String(lastWeek - 1));
    if (lastWeek - 1 === currentWeek) await picker.selectOption(String(firstWeek));
    const current = page.getByRole('link', { name: 'Back to current', exact: true });
    await expect(current).toHaveAttribute('href', path);
    await current.click();
    await expect(page).toHaveURL(new RegExp(`${path}$`, 'u'));
    await expect(picker).toHaveValue(String(currentWeek));
    await expect(current).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
  });
}
