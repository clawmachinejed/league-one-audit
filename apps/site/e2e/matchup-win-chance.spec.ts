import { expect, test, type Page } from '@playwright/test';
import { LEAGUE_IDS } from '../lib/config';
import { LEAGUE_SITES, type LeagueKey } from '../lib/leagues';
import { isMatchupsData } from '../lib/matchups-response';
import type { Matchup, MatchupsData } from '../lib/types';
import { contextFixture, snapshotFixture, snapshotHeaders, SNAPSHOT_A, SNAPSHOT_B, SNAPSHOT_TIME } from '../test-support/matchup-snapshot-fixtures';

function boardFixture(refreshed: boolean, future: boolean): MatchupsData {
  const data = snapshotFixture(5);
  const matchup = data.matchups[0];
  matchup.status = future ? 'upcoming' : 'live';
  matchup.sides.forEach((side, index) => {
    side.points = future ? 0 : index === 0 ? 25 : 10;
    side.projectedPoints = index === 0 ? 90 : 110;
    side.bench = [{ ...side.starters[0], id: `bench-${index}`, name: index === 0 ? 'Mac Jones' : 'A.J. Brown',
      slot: 'BN', points: 0, projectedPoints: 12 }];
  });
  if (!future) {
    // Deliberately reverse metadata order. Values are attached to identity,
    // never to array order or the selected team's display position.
    matchup.winProbability = { modelVersion: 'normal-v1', status: 'estimated', teams: [
      { teamId: 2, probability: refreshed ? 0.005 : 0.71 },
      { teamId: 1, probability: refreshed ? 0.995 : 0.29 },
    ] };
    const extra = (name: string, ids: readonly [number, number], status: Matchup['status'], scores: readonly [number, number]) => {
      const source = snapshotFixture(5).matchups[0];
      source.id = name;
      source.status = status;
      source.sides.forEach((side, index) => {
        side.team = { ...side.team, id: ids[index], name: `${name} ${index + 1}` };
        side.points = scores[index];
        side.starters[0].id = `starter-${ids[index]}`;
        data.teams.push(side.team);
      });
      data.matchups.push(source);
      return source;
    };
    extra('Final result', [3, 4], 'final', [25, 10]);
    extra('Tied result', [5, 6], 'final', [0, 0]);
    extra('Unknown estimate', [7, 8], 'live', [50, 0]);
    const pending = extra('Pending opponent', [9, 10], 'upcoming', [0, 0]);
    pending.sides.pop();
    data.teams.pop();
  }
  expect(isMatchupsData(data), 'win chance fixture passes the real snapshot boundary').toBe(true);
  return data;
}

async function openFixture(page: Page, league: LeagueKey, future = false) {
  const prefix = LEAGUE_SITES[league].prefix;
  const context = contextFixture(future ? 'future' : 'active', 5);
  const state = { injected: 0, full: 0, compact: 0, refreshed: false, providerRequests: [] as string[] };
  await page.clock.install({ time: new Date(SNAPSHOT_TIME) });
  await page.clock.pauseAt(new Date(Date.parse(SNAPSHOT_TIME) + 60_000));
  await page.addInitScript(key => localStorage.setItem(key, '2'), `league-one:my-team:${LEAGUE_IDS[league]}`);
  page.on('request', request => {
    if (/api\.sleeper\.|tank01/iu.test(new URL(request.url()).hostname)) state.providerRequests.push(request.url());
  });
  // Follow the existing browser protocol fixtures: use real routes/modules and
  // replace only their RSC client props, with no application test route or feed.
  await page.route(/\/(?:(?:league2|dynasty)\/)?(?:matchups|my-team)(?:\?|$)/u, async route => {
    if (route.request().headers().rsc !== '1') return route.continue();
    if (route.request().headers()['next-router-prefetch'] === '1') return route.abort();
    const response = await route.fetch();
    let replaced = 0;
    const replaceProps = (value: unknown): void => {
      if (!value || typeof value !== 'object') return;
      if (!Array.isArray(value)) {
        const object = value as Record<string, unknown>;
        const data = object.data as Record<string, unknown> | undefined;
        if ('periodContext' in object && data && 'matchups' in data && 'standings' in object) {
          object.data = boardFixture(state.refreshed, future);
          object.periodContext = context;
          object.snapshotRevision = SNAPSHOT_A;
          object.verifiedAt = SNAPSHOT_TIME;
          object.rollover = null;
          object.followCurrent = false;
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
    expect(replaced, 'navigation includes exactly one shared matchup view').toBe(1);
    state.injected += replaced;
    await route.fulfill({ response, body });
  });
  await page.route('**/api/matchups/**', async route => {
    const url = new URL(route.request().url());
    expect([`/api/matchups/${league}`, `/api/matchups/${league}/revision`]).toContain(url.pathname);
    expect(url.searchParams.get('week')).toBe('5');
    const revision = state.refreshed ? SNAPSHOT_B : SNAPSHOT_A;
    const verifiedAt = state.refreshed ? '2099-09-03T12:01:00.000Z' : SNAPSHOT_TIME;
    const headers = Object.fromEntries(snapshotHeaders(revision, verifiedAt, context));
    if (url.pathname.endsWith('/revision')) {
      state.compact += 1;
      await route.fulfill({ headers, json: { status: 'ok', revision, verifiedAt } });
    } else {
      state.full += 1;
      await route.fulfill({ headers, json: boardFixture(state.refreshed, future) });
    }
  });
  await page.goto(`${prefix}/managers`, { waitUntil: 'networkidle' });
  await page.getByRole('navigation', { name: 'Mobile navigation' }).getByRole('link', { name: 'Matchups', exact: true }).click();
  await expect(page.locator('[data-matchup-toggle]').first().locator('[data-team-name]')).toHaveText(['Fixture Beta', 'Fixture Alpha']);
  expect(state.injected).toBe(1);
  return state;
}

for (const league of ['league1', 'league2', 'dynasty'] as const) {
  test(`${league} keeps compact win chances with each team on Matchups and My Team through expansion and snapshot refresh`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const state = await openFixture(page, league);
    let header = page.locator('[data-matchup-toggle]').first();
    await expect(header.locator('[data-win-chance-side]')).toHaveText(['71%', '29%']);
    await expect(header).toHaveAccessibleName(/Estimated win chance: Fixture Beta 71%; Fixture Alpha 29%/u);
    await expect(page.locator('[data-win-chance="final"] [data-win-chance-side]')).toHaveText(['100%', '0%']);
    await expect(page.locator('[data-win-chance="tie"] [data-win-chance-side]')).toHaveText(['Tie', 'Tie']);
    await expect(page.locator('[data-win-chance="unavailable"] [data-win-chance-side]')).toHaveText(['—', '—', '—', '—']);
    await expect(header.locator('[data-score-number]')).toHaveText(['10.00', '25.00']);
    await header.click();
    await expect(header).toHaveAttribute('aria-expanded', 'true');
    await expect(header.locator('..').locator('[data-player-name]').first()).toBeVisible();

    for (const width of [320, 390, 430, 760]) {
      await page.setViewportSize({ width, height: 900 });
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1),
        `win chance headers fit ${width}px`).toBe(true);
      await expect.poll(() => page.locator('[data-win-chance]').evaluateAll(nodes => nodes.every(node => {
        const bounds = node.getBoundingClientRect();
        return [...node.children].every(child => {
          const rect = child.getBoundingClientRect();
          return child.scrollWidth <= child.clientWidth + 1 && rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1;
        });
      })), `win chance labels and values fit ${width}px`).toBe(true);
      expect((await header.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }

    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('navigation', { name: 'Mobile navigation' }).getByRole('link', { name: 'My Team', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'My Team', exact: true })).toBeVisible();
    await expect.poll(() => state.injected).toBe(2);
    header = page.locator('[data-matchup-toggle]');
    await expect(header).toHaveCount(1);
    await expect(header.locator('[data-team-name]')).toHaveText(['Fixture Beta', 'Fixture Alpha']);
    await expect(header.locator('[data-win-chance-side]')).toHaveText(['71%', '29%']);
    await header.click();
    await expect(page.getByRole('region', { name: 'Bench players' })).toBeVisible();
    await expect(header).toHaveAttribute('aria-expanded', 'true');
    expect(state.injected).toBe(2);
    expect(state.full).toBe(0);
    await test.info().attach('win-chance-my-team-390px', {
      body: await page.screenshot({ fullPage: true }), contentType: 'image/png',
    });

    state.refreshed = true;
    await page.clock.runFor(60_000);
    await expect(header.locator('[data-win-chance-side]')).toHaveText(['<1%', '>99%']);
    await expect(header).toHaveAccessibleName(/Fixture Beta less than 1%; Fixture Alpha greater than 99%/u);
    await expect(header).toHaveAttribute('aria-expanded', 'true');
    await expect(header.locator('[data-score-number]')).toHaveText(['10.00', '25.00']);
    await expect(header.locator('[data-team-projection-number]')).toHaveText(['110.00', '90.00']);
    await header.click();
    await expect(page.getByRole('region', { name: 'Bench players' })).toBeHidden();
    expect(state.compact).toBe(1);
    expect(state.full).toBe(1);
    expect(state.providerRequests).toEqual([]);
  });

  test(`${league} leaves future win chances unavailable on both pages when the stored snapshot has no estimate`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 844 });
    const state = await openFixture(page, league, true);
    const chances = page.locator('[data-win-chance="unavailable"]');
    await expect(chances.locator('[data-win-chance-side]')).toHaveText(['—', '—']);
    await expect(page.locator('[data-matchup-toggle]')).toHaveAccessibleName(/Estimated win chance unavailable/u);
    await page.getByRole('navigation', { name: 'Mobile navigation' }).getByRole('link', { name: 'My Team', exact: true }).click();
    // Both routes display identical fixture values: those values alone cannot
    // prove navigation completed before advancing the polling clock.
    await expect(page.getByRole('heading', { name: 'My Team', exact: true })).toBeVisible();
    await expect.poll(() => state.injected).toBe(2);
    await expect(chances.locator('[data-win-chance-side]')).toHaveText(['—', '—']);
    await expect(page.locator('[data-team-projection-number]')).toHaveText(['110.00', '90.00']);
    await page.clock.runFor(60_000);
    await expect(chances.locator('[data-win-chance-side]')).toHaveText(['—', '—']);
    expect(state.injected).toBe(2);
    expect(state.compact).toBe(1);
    expect(state.full).toBe(0);
    expect(state.providerRequests).toEqual([]);
  });
}
