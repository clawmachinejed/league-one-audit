import { expect, test, type Page } from '@playwright/test';
import type { StandingsData } from '../lib/types';
import { contextFixture, snapshotFixture, snapshotHeaders, SNAPSHOT_A, SNAPSHOT_B, SNAPSHOT_C, SNAPSHOT_TIME } from '../test-support/matchup-snapshot-fixtures';

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'wait' });
});

async function openProjectedStandings(page: Page, league: 'league1' | 'league2', unresolvedPair = false) {
  const prefix = league === 'league2' ? '/league2' : '';
  const matchups = snapshotFixture(2);
  matchups.matchups[0].status = 'live';
  matchups.matchups[0].sides[0].projectedPoints = 80;
  matchups.matchups[0].sides[1].projectedPoints = 120;
  const teams = matchups.teams.map((team, index) => ({ ...team, name: `${league} ${index ? 'Beta' : 'Alpha'}`,
    wins: index ? 0 : 1, losses: index ? 1 : 0, ties: 0,
    pointsFor: index ? 90 : 110, pointsAgainst: index ? 110 : 90,
    waiverOrder: index ? 1 : 2, waiverBudgetRemaining: 100 }));
  if (unresolvedPair) {
    const extraTeams = teams.map((team, index) => ({ ...team, id: index + 3,
      name: `${league} ${index ? 'Delta' : 'Gamma'}`, pointsFor: index ? 80 : 100, pointsAgainst: index ? 100 : 80 }));
    teams.push(...extraTeams);
    matchups.matchups.push({ id: 'unresolved-matchup', status: 'unknown',
      sides: extraTeams.map((team, index) => ({ team, points: 0,
        projectedPoints: index ? null : 150,
        starters: index ? [] : [{ ...matchups.matchups[0].sides[0].starters[0], id: 'extra-starter', projectedPoints: 150 }] })) });
  }
  matchups.teams = teams;
  for (const matchup of matchups.matchups) {
    for (const side of matchup.sides) side.team = teams.find((team) => team.id === side.team.id)!;
  }
  const data: StandingsData = { league: matchups.league, teams, updatedAt: SNAPSHOT_TIME,
    projectionBasis: { kind: 'ready', week: 2, teams } };
  const context = contextFixture('active', 2);
  const source = { data: matchups, periodContext: context, snapshotRevision: SNAPSHOT_A, verifiedAt: SNAPSHOT_TIME };
  const state = { injected: 0, compact: 0, full: 0, resolveMissingLineup: false };
  await page.clock.install({ time: new Date(SNAPSHOT_TIME) });

  // Replace only the client component props during navigation, preserving real application
  // modules and avoiding an SSR hydration mismatch or any application fixture route.
  await page.route(`**${prefix}/standings?*`, async (route) => {
    if (route.request().headers().rsc !== '1') return route.continue();
    if (route.request().headers()['next-router-prefetch'] === '1') return route.abort();
    const response = await route.fetch();
    let replaced = 0;
    const replaceProps = (value: unknown): void => {
      if (!value || typeof value !== 'object') return;
      if (!Array.isArray(value)) {
        const object = value as Record<string, unknown>;
        if ('projectionSource' in object && 'data' in object) {
          object.data = data;
          object.projectionSource = source;
          replaced += 1;
          return;
        }
      }
      for (const child of Object.values(value)) replaceProps(child);
    };
    const body = (await response.text()).split('\n').map((line) => {
      const split = line.indexOf(':');
      if (split < 0) return line;
      try {
        const value: unknown = JSON.parse(line.slice(split + 1));
        replaceProps(value);
        return `${line.slice(0, split + 1)}${JSON.stringify(value)}`;
      } catch { return line; }
    }).join('\n');
    expect(replaced, 'The navigation must include exactly one StandingsView prop set').toBe(1);
    state.injected += replaced;
    await route.fulfill({ response, body });
  });
  await page.route('**/api/matchups/**', async (route) => {
    const url = new URL(route.request().url());
    expect([`/api/matchups/${league}`, `/api/matchups/${league}/revision`]).toContain(url.pathname);
    expect(url.searchParams.get('week')).toBe('2');
    const revision = state.resolveMissingLineup ? SNAPSHOT_C : SNAPSHOT_B;
    const verifiedAt = state.resolveMissingLineup ? '2026-09-03T12:02:00.000Z' : '2026-09-03T12:01:00.000Z';
    const headers = Object.fromEntries(snapshotHeaders(revision, verifiedAt, context));
    if (url.pathname.endsWith('/revision')) {
      state.compact += 1;
      await route.fulfill({ status: 200, headers, json: { status: 'ok', revision, verifiedAt } });
    } else {
      state.full += 1;
      if (state.resolveMissingLineup) {
        matchups.matchups[1].status = 'upcoming';
        const side = matchups.matchups[1].sides[1];
        side.projectedPoints = 140;
        side.starters = [{ ...matchups.matchups[0].sides[1].starters[0], id: 'resolved-starter', projectedPoints: 140 }];
      }
      await route.fulfill({ status: 200, headers, json: matchups });
    }
  });
  await page.goto(`${prefix}/managers`, { waitUntil: 'networkidle' });
  await page.getByRole('navigation', { name: 'Mobile navigation' }).getByRole('link', { name: 'League', exact: true }).click();
  await expect(page.locator('.standings-table .team-name')).toHaveText(teams.map((team) => team.name));
  expect(state.injected).toBe(1);
  return state;
}

test('projects healthy pairs, labels held records, and incorporates a recovered lineup exactly once', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await openProjectedStandings(page, 'league2', true);
  const control = page.getByRole('switch', { name: 'Projected standings', exact: true });
  const table = page.locator('.standings-table');
  const values = () => table.locator('tbody tr').evaluateAll((rows) => rows.map((row) => ({
    name: row.querySelector('.team-name')?.textContent,
    cells: [...row.querySelectorAll('td')].map((cell) => cell.textContent),
  })));
  const official = await values();
  await expect(control).toHaveAttribute('aria-checked', 'false');
  await control.click();
  await expect.poll(() => [state.compact, state.full]).toEqual([1, 1]);
  await expect(table).toHaveAttribute('data-projected', 'true');
  await expect(table).toHaveAttribute('data-provisional', 'true');
  await expect(control).toContainText('Week 2 · Provisional');
  await expect(page.locator('.table-note')).toContainText('1 of 2 Week 2 matchups included');
  await expect(page.locator('[data-projection-excluded]')).toHaveText(['Week 2 not included', 'Week 2 not included']);
  expect(await values()).toEqual([
    { name: 'league2 Gamma', cells: ['1', '1–0', '100.00', '80.00'] },
    { name: 'league2 Beta', cells: ['2', '1–1', '210.00', '190.00'] },
    { name: 'league2 Alpha', cells: ['3', '1–1', '190.00', '210.00'] },
    { name: 'league2 Delta', cells: ['4', '0–1', '80.00', '100.00'] },
  ]);
  for (const width of [320, 390, 430]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
    expect(await control.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  }

  state.resolveMissingLineup = true;
  await page.clock.runFor(60_000);
  await expect.poll(() => [state.compact, state.full]).toEqual([2, 2]);
  await expect(table).toHaveAttribute('data-provisional', 'false');
  await expect(control).toContainText('Week 2 · Live');
  await expect(page.locator('[data-projection-excluded]')).toHaveCount(0);
  expect(await values()).toEqual([
    { name: 'league2 Gamma', cells: ['1', '2–0', '250.00', '220.00'] },
    { name: 'league2 Beta', cells: ['2', '1–1', '210.00', '190.00'] },
    { name: 'league2 Alpha', cells: ['3', '1–1', '190.00', '210.00'] },
    { name: 'league2 Delta', cells: ['4', '0–2', '220.00', '250.00'] },
  ]);
  await control.click();
  await expect(table).toHaveAttribute('data-projected', 'false');
  expect(await values()).toEqual(official);
});

for (const league of ['league1', 'league2'] as const) {
  test(`${league} keeps official standings by default and switches projected results on and off with the keyboard`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const state = await openProjectedStandings(page, league);
    const control = page.getByRole('switch', { name: 'Projected standings', exact: true });
    const table = page.locator('.standings-table');
    const values = () => table.locator('tbody tr').evaluateAll((rows) => rows.map((row) => ({
      name: row.querySelector('.team-name')?.textContent,
      cells: [...row.querySelectorAll('td')].map((cell) => cell.textContent),
    })));
    const official = [
      { name: `${league} Alpha`, cells: ['1', '1–0', '110.00', '90.00'] },
      { name: `${league} Beta`, cells: ['2', '0–1', '90.00', '110.00'] },
    ];
    await expect(control).toHaveAttribute('aria-checked', 'false');
    await expect(table).toHaveAttribute('data-projected', 'false');
    expect(await values()).toEqual(official);
    await page.clock.runFor(120_000);
    expect([state.compact, state.full]).toEqual([0, 0]);

    await control.focus();
    await page.keyboard.press('Space');
    await expect(control).toHaveAttribute('aria-checked', 'true');
    await expect.poll(() => [state.compact, state.full]).toEqual([1, 1]);
    await expect(table).toHaveAttribute('data-projected', 'true');
    expect(await values()).toEqual([
      { name: `${league} Beta`, cells: ['1', '1–1', '210.00', '190.00'] },
      { name: `${league} Alpha`, cells: ['2', '1–1', '190.00', '210.00'] },
    ]);
    await expect(control).toContainText('Week 2 · Live');
    for (const width of [320, 360, 390, 430, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      const box = await control.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
      expect(await control.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    }

    await page.getByRole('tab', { name: 'Waivers', exact: true }).click();
    await expect(table).toHaveAttribute('data-projected', 'false');
    expect(await values()).toEqual([
      { name: `${league} Beta`, cells: ['2', '0–1', '1', '$100'] },
      { name: `${league} Alpha`, cells: ['1', '1–0', '2', '$100'] },
    ]);
    await page.clock.runFor(120_000);
    expect([state.compact, state.full]).toEqual([1, 1]);
    await page.getByRole('tab', { name: 'Standings', exact: true }).click();
    await expect(table).toHaveAttribute('data-projected', 'true');
    await expect.poll(() => state.compact).toBe(2);
    await control.focus();
    await page.keyboard.press('Enter');
    await expect(control).toHaveAttribute('aria-checked', 'false');
    await expect(table).toHaveAttribute('data-projected', 'false');
    expect(await values()).toEqual(official);
    await page.clock.runFor(120_000);
    expect([state.compact, state.full]).toEqual([2, 1]);
  });
}
