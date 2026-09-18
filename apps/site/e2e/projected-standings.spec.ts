import { expect, test, type Page } from '@playwright/test';
import type { StandingsData } from '../lib/types';
import { contextFixture, snapshotFixture, snapshotHeaders, SNAPSHOT_A, SNAPSHOT_B, SNAPSHOT_C, SNAPSHOT_TIME } from '../test-support/matchup-snapshot-fixtures';

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'wait' });
});

async function openProjectedStandings(page: Page, league: 'league1' | 'league2', {
  unresolvedPair = false, unavailable = false, maximumMovement = false,
}: { unresolvedPair?: boolean; unavailable?: boolean; maximumMovement?: boolean } = {}) {
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
  if (maximumMovement) {
    const template = matchups.matchups[0];
    teams.splice(0, teams.length, ...Array.from({ length: 12 }, (_, index) => ({ ...teams[0],
      id: index + 1, name: `${league} Team ${String(index + 1).padStart(2, '0')}`,
      wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0, waiverOrder: index + 1 })));
    matchups.matchups = Array.from({ length: 6 }, (_, pair) => ({ ...template, id: `maximum-movement-${pair}`,
      sides: [teams[pair], teams[11 - pair]].map((team, side) => {
        const projectedPoints = pair === 0 ? (side === 0 ? 0 : 300) : side === 0 ? 80 : 120;
        return { ...template.sides[side], team, points: 0, projectedPoints,
          starters: [{ ...template.sides[side].starters[0], id: `maximum-player-${team.id}`, points: 0, projectedPoints }] };
      }) }));
  }
  matchups.teams = teams;
  for (const matchup of matchups.matchups) {
    for (const side of matchup.sides) side.team = teams.find((team) => team.id === side.team.id)!;
  }
  const data: StandingsData = { league: matchups.league, teams, updatedAt: SNAPSHOT_TIME,
    // Basis ordering need not match current actual ranks. Movement must use the
    // official teams array, regardless of baseline order or a table-column sort.
    projectionBasis: unavailable ? { kind: 'unavailable', reason: 'Completed matchup history is incomplete.' }
      : { kind: 'ready', week: 2, teams: [...teams].reverse() } };
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
  const state = await openProjectedStandings(page, 'league2', { unresolvedPair: true });
  const control = page.getByRole('switch', { name: 'Projected standings', exact: true });
  const table = page.locator('.standings-table');
  const values = () => table.locator('tbody tr').evaluateAll((rows) => rows.map((row) => ({
    name: row.querySelector('.team-name')?.textContent,
    cells: [...row.querySelectorAll('td')].map((cell) => cell.querySelector('[data-standings-rank]')?.textContent ?? cell.textContent),
  })));
  const official = await values();
  await expect(control).toHaveAttribute('aria-checked', 'false');
  await expect(table.locator('.standings-rank-movement')).toHaveCount(0);
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
  const assertMovement = async () => {
    for (const [name, direction, label] of [
      ['Gamma', 'up', 'Up 2 places from actual rank 3'],
      ['Beta', 'unchanged', 'No change from actual rank 2'],
      ['Alpha', 'down', 'Down 2 places from actual rank 1'],
      ['Delta', 'unchanged', 'No change from actual rank 4'],
    ]) {
      const movement = table.locator('tbody tr').filter({ has: page.getByText(`league2 ${name}`, { exact: true }) }).locator('.standings-rank-movement');
      await expect(movement).toHaveAttribute('data-direction', direction);
      await expect(movement).toHaveAttribute('aria-label', label);
      await expect(movement).toHaveText(direction === 'unchanged' ? '—' : '');
      await expect(movement.locator('[data-movement-triangle]')).toHaveCount(direction === 'unchanged' ? 0 : 2);
    }
  };
  await assertMovement();
  await test.info().attach('projected-rank-movement-phone', { body: await page.screenshot(), contentType: 'image/png' });
  await page.getByRole('button', { name: 'Sort by PF', exact: true }).click();
  await expect(table.locator('.team-name')).toHaveText(['league2 Beta', 'league2 Alpha', 'league2 Gamma', 'league2 Delta']);
  await assertMovement();
  await page.getByRole('button', { name: 'Sort by Rank', exact: true }).click();
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
  await assertMovement();
  await control.click();
  await expect(table).toHaveAttribute('data-projected', 'false');
  await expect(table.locator('.standings-rank-movement')).toHaveCount(0);
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
      cells: [...row.querySelectorAll('td')].map((cell) => cell.querySelector('[data-standings-rank]')?.textContent ?? cell.textContent),
    })));
    const official = [
      { name: `${league} Alpha`, cells: ['1', '1–0', '110.00', '90.00'] },
      { name: `${league} Beta`, cells: ['2', '0–1', '90.00', '110.00'] },
    ];
    await expect(control).toHaveAttribute('aria-checked', 'false');
    await expect(table).toHaveAttribute('data-projected', 'false');
    await expect(table.locator('.standings-rank-movement')).toHaveCount(0);
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
    await expect(table.getByRole('img', { name: 'Up 1 place from actual rank 2', exact: true })).toBeVisible();
    await expect(table.getByRole('img', { name: 'Down 1 place from actual rank 1', exact: true })).toBeVisible();
    await expect(table.locator('[data-movement-triangle]')).toHaveCount(2);
    await expect(table.locator('.standings-rank-movement')).toHaveText(['', '']);
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
    await expect(table.locator('.standings-rank-movement')).toHaveCount(0);
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
    await expect(table.locator('.standings-rank-movement')).toHaveCount(0);
    expect(await values()).toEqual(official);
    await page.clock.runFor(120_000);
    expect([state.compact, state.full]).toEqual([2, 1]);
  });
}

test('puts colored movement below each projected rank without shifting the rank or row on phones and desktop', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openProjectedStandings(page, 'league1');
  const control = page.getByRole('switch', { name: 'Projected standings', exact: true });
  const table = page.locator('.standings-table');
  const rankLayout = () => table.locator('tbody tr').evaluateAll((rows) => rows.map((row) => {
    const rank = row.querySelector('[data-standings-rank]')!.getBoundingClientRect();
    const rowBox = row.getBoundingClientRect();
    return { left: rank.left - rowBox.left, top: rank.top - rowBox.top, height: rank.height, rowHeight: rowBox.height };
  }));
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    const officialLayout = await rankLayout();
    await control.click();
    await expect(table).toHaveAttribute('data-projected', 'true');
    expect(await rankLayout()).toEqual(officialLayout);
    const movements = await table.locator('tbody tr').evaluateAll((rows) => rows.map((row) => {
      const rank = row.querySelector('[data-standings-rank]')!.getBoundingClientRect();
      const movement = row.querySelector('.standings-rank-movement')!;
      const movementBox = movement.getBoundingClientRect();
      const cellBox = row.querySelector('.rank-cell')!.getBoundingClientRect();
      return {
        direction: movement.getAttribute('data-direction'),
        color: getComputedStyle(movement).color.match(/\d+/g)!.map(Number),
        beneath: movementBox.top >= rank.bottom,
        inside: movementBox.left >= cellBox.left && movementBox.right <= cellBox.right && movementBox.bottom <= cellBox.bottom,
      };
    }));
    expect(movements.map(({ direction, beneath, inside }) => ({ direction, beneath, inside }))).toEqual([
      { direction: 'up', beneath: true, inside: true },
      { direction: 'down', beneath: true, inside: true },
    ]);
    expect(movements[0].color[1], 'An upward movement is green').toBeGreaterThan(movements[0].color[0]);
    expect(movements[1].color[0], 'A downward movement is red').toBeGreaterThan(movements[1].color[1]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
    await control.click();
    await expect(table).toHaveAttribute('data-projected', 'false');
    await expect(table.locator('.standings-rank-movement')).toHaveCount(0);
    expect(await rankLayout()).toEqual(officialLayout);
  }
});

test('eleven-place movement fits within a twelve-team rank cell using one solid triangle per place', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await openProjectedStandings(page, 'league1', { maximumMovement: true });
  const control = page.getByRole('switch', { name: 'Projected standings', exact: true });
  const table = page.locator('.standings-table');
  const rankLayout = () => table.locator('tbody tr').evaluateAll((rows) => rows.map((row) => {
    const rank = row.querySelector('[data-standings-rank]')!.getBoundingClientRect();
    const rowBox = row.getBoundingClientRect();
    return { left: rank.left - rowBox.left, top: rank.top - rowBox.top, height: rank.height, rowHeight: rowBox.height };
  }));
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    const officialLayout = await rankLayout();
    await control.click();
    await expect(table).toHaveAttribute('data-projected', 'true');
    expect(await rankLayout()).toEqual(officialLayout);
    for (const label of ['Up 11 places from actual rank 12', 'Down 11 places from actual rank 1']) {
      const movement = table.getByRole('img', { name: label, exact: true });
      await expect(movement).toBeVisible();
      await expect(movement).toHaveText('');
      await expect(movement.locator('[data-movement-triangle]')).toHaveCount(11);
      expect(await movement.evaluate((element) => {
        const cell = element.closest('.rank-cell')!.getBoundingClientRect();
        const rank = element.closest('.standings-rank')!.querySelector('[data-standings-rank]')!.getBoundingClientRect();
        return [...element.querySelectorAll('[data-movement-triangle]')].every((triangle) => {
          const box = triangle.getBoundingClientRect();
          const shape = triangle.querySelector('path, polygon') ?? triangle;
          const fill = getComputedStyle(shape).fill;
          return box.width > 0 && box.height > 0 && box.top >= rank.bottom && box.bottom <= cell.bottom
            && box.left >= cell.left && box.right <= cell.right && fill !== 'none' && fill !== 'rgba(0, 0, 0, 0)';
        });
      })).toBe(true);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
    if (width === 320) await test.info().attach('projected-rank-eleven-triangles-phone', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
    await control.click();
    await expect(table).toHaveAttribute('data-projected', 'false');
    expect(await rankLayout()).toEqual(officialLayout);
  }
});

test('shows no rank movement when projected standings are unavailable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openProjectedStandings(page, 'league1', { unavailable: true });
  const control = page.getByRole('switch', { name: 'Projected standings', exact: true });
  await control.click();
  await expect(control).toHaveAttribute('aria-checked', 'true');
  await expect(control).toContainText('Unavailable');
  await expect(page.locator('.standings-table')).toHaveAttribute('data-projected', 'false');
  await expect(page.locator('.standings-table .team-name')).toHaveText(['league1 Alpha', 'league1 Beta']);
  await expect(page.locator('.standings-rank-movement')).toHaveCount(0);
  await expect(page.getByText('Showing official standings. Completed matchup history is incomplete.', { exact: true })).toBeVisible();
});
