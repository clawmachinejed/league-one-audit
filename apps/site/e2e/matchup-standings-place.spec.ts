import { expect, test, type Page } from '@playwright/test';
import { LEAGUE_IDS } from '../lib/config';
import { LEAGUE_SITES, type LeagueKey } from '../lib/leagues';
import { isMatchupsData } from '../lib/matchups-response';
import type { MatchupsData } from '../lib/types';
import { contextFixture, snapshotFixture, snapshotHeaders, SNAPSHOT_A, SNAPSHOT_B, SNAPSHOT_TIME } from '../test-support/matchup-snapshot-fixtures';

const placeForTeam = (id: number) => 13 - id;
const ordinal = (place: number) => `${place}${place === 1 ? 'st' : place === 2 ? 'nd' : place === 3 ? 'rd' : 'th'}`;
const teamName = (id: number) => `Fixture Team ${id}`;
const CURRENT_PLACES = Object.fromEntries(Array.from({ length: 12 }, (_, index) => [index + 1, placeForTeam(index + 1)]));

function boardFixture(refreshed = false): MatchupsData {
  const base = snapshotFixture(2);
  const teams = Array.from({ length: 12 }, (_, index) => ({
    ...base.teams[0], id: index + 1, name: teamName(index + 1), managerName: `fixture_manager_${index + 1}`,
    // Deliberately differ from the current standings order: neither snapshot
    // order, points nor record may supply these badges' current positions.
    wins: refreshed ? 11 : 10, losses: 2, ties: 1, pointsFor: (12 - index) * 100, pointsAgainst: 500,
  }));
  const data: MatchupsData = {
    ...base, teams,
    matchups: Array.from({ length: 6 }, (_, pair) => ({
      id: `fixture-pair-${pair}`, status: 'upcoming' as const,
      sides: teams.slice(pair * 2, pair * 2 + 2).map(team => ({
        ...base.matchups[0].sides[0], team, projectedPoints: refreshed ? 77 : 42,
        starters: [{ ...base.matchups[0].sides[0].starters[0], id: `fixture-player-${team.id}`, name: `Fixture Player ${team.id}` }],
      })),
    })).reverse(),
  };
  expect(isMatchupsData(data), 'the intercepted board must pass the real snapshot boundary').toBe(true);
  return data;
}

async function openFixture(page: Page, league: LeagueKey) {
  const prefix = LEAGUE_SITES[league].prefix;
  const context = contextFixture('active', 2);
  const state = { injected: 0, full: 0, refreshed: false, providerRequests: [] as string[] };
  await page.clock.install({ time: new Date(SNAPSHOT_TIME) });
  await page.clock.pauseAt(new Date(Date.parse(SNAPSHOT_TIME) + 60_000));
  await page.addInitScript(key => localStorage.setItem(key, '2'), `league-one:my-team:${LEAGUE_IDS[league]}`);
  page.on('request', request => {
    if (/api\.sleeper\.|tank01/iu.test(new URL(request.url()).hostname)) state.providerRequests.push(request.url());
  });
  // Navigate through real routes and replace only RSC client props, preserving
  // real client modules without a test route or an SSR hydration mismatch.
  await page.route(/\/(?:(?:league2|dynasty)\/)?matchups(?:\?|$)/u, async route => {
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
          object.data = boardFixture();
          object.periodContext = context;
          object.snapshotRevision = SNAPSHOT_A;
          object.verifiedAt = SNAPSHOT_TIME;
          object.rollover = null;
          object.followCurrent = false;
          // League Two deliberately has four playoff teams so a hardcoded
          // six-team cutoff cannot pass by copying League One's rules.
          object.standings = { leagueId: LEAGUE_IDS[league], season: '2026', playoffTeams: 4, places: CURRENT_PLACES };
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
    expect(replaced, 'navigation includes exactly one MatchupsView client prop set').toBe(1);
    state.injected += replaced;
    await route.fulfill({ response, body });
  });
  await page.route('**/api/matchups/**', async route => {
    const url = new URL(route.request().url());
    expect([`/api/matchups/${league}`, `/api/matchups/${league}/revision`]).toContain(url.pathname);
    expect(url.searchParams.get('week')).toBe('2');
    const revision = state.refreshed ? SNAPSHOT_B : SNAPSHOT_A;
    const verifiedAt = state.refreshed ? '2099-09-03T12:01:00.000Z' : SNAPSHOT_TIME;
    const headers = Object.fromEntries(snapshotHeaders(revision, verifiedAt, context));
    if (url.pathname.endsWith('/revision')) {
      await route.fulfill({ headers, json: { status: 'ok', revision, verifiedAt } });
    } else {
      state.full += 1;
      await route.fulfill({ headers, json: boardFixture(state.refreshed) });
    }
  });
  await page.goto(`${prefix}/managers`, { waitUntil: 'networkidle' });
  await page.getByRole('navigation', { name: 'Mobile navigation' }).getByRole('link', { name: 'Matchups', exact: true }).click();
  await expect(page.locator('[data-matchup-toggle]').first().locator('[data-team-name]')).toHaveText([teamName(2), teamName(1)]);
  expect(state.injected).toBe(1);
  return state;
}

for (const league of ['league1', 'league2', 'dynasty'] as const) {
  test(`${league} displays bold actual places outside each record with scoped colors and preserved matchup behavior`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const state = await openFixture(page, league);
    const badges = page.locator('[data-team-place]');
    await expect(badges).toHaveCount(12);
    for (let id = 1; id <= 12; id += 1) {
      const place = placeForTeam(id);
      const expectedTone = league === 'dynasty' ? 'neutral'
        : league === 'league2' ? place <= 4 ? 'playoff' : 'neutral'
          : place <= 6 ? 'playoff' : place >= 11 ? 'relegation' : 'middle';
      const badge = page.locator(`[data-team-place="${id}"]`);
      await expect(badge).toHaveText(ordinal(place));
      await expect(badge).toHaveAttribute('data-place-tone', expectedTone);
      expect(await badge.evaluate(node => node.tagName)).toBe('STRONG');
      expect(await badge.evaluate(node => Number(getComputedStyle(node).fontWeight))).toBeGreaterThanOrEqual(700);
    }
    // Check actual rendered colors as well as semantic tone attributes.
    const colors = await badges.evaluateAll(nodes => nodes.map(node => ({
      tone: node.getAttribute('data-place-tone'), color: getComputedStyle(node).color,
    })));
    for (const tone of new Set(colors.map(item => item.tone))) {
      expect(new Set(colors.filter(item => item.tone === tone).map(item => item.color)).size).toBe(1);
    }
    expect(new Set(colors.map(item => item.color)).size).toBe(league === 'league1' ? 3 : league === 'league2' ? 2 : 1);

    const first = page.locator('[data-matchup-toggle]').first();
    await expect(first).toHaveAttribute('aria-expanded', 'false');
    await first.click();
    await expect(first).toHaveAttribute('aria-expanded', 'true');
    const card = first.locator('..');
    await expect(card.locator('[data-player-name]')).toHaveCount(2);
    await expect(card.locator('[data-player-name]').first()).toBeVisible();
    for (const width of [320, 360, 390, 430, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1),
        `matchups document fits ${width}px`).toBe(true);
      await expect.poll(() => page.locator('[data-team-meta]').evaluateAll(nodes => nodes.every(meta => {
        const badge = meta.querySelector('[data-team-place]')!.getBoundingClientRect();
        const record = meta.querySelector('[data-team-record]')!.getBoundingClientRect();
        const bounds = meta.getBoundingClientRect();
        const outside = meta.getAttribute('data-team-meta') === 'left'
          ? badge.right <= record.left + 1 : record.right <= badge.left + 1;
        return outside && badge.left >= bounds.left - 1 && badge.right <= bounds.right + 1
          && record.left >= bounds.left - 1 && record.right <= bounds.right + 1
          && Math.abs(badge.top - record.top) < 3;
      })), `standings places remain outside the records and fit at ${width}px`).toBe(true);
      expect((await first.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }

    // A newer weekly snapshot changes records/projections but cannot overwrite
    // the separately loaded current official standings or collapse the card.
    state.refreshed = true;
    await page.clock.runFor(60_000);
    await expect.poll(() => state.full).toBe(1);
    await expect(first.locator('[data-team-projection-number]')).toHaveText(['77.00', '77.00']);
    await expect(first.locator('[data-team-record]')).toHaveText(['11–2–1', '11–2–1']);
    await expect(first.locator('[data-team-name]')).toHaveText([teamName(2), teamName(1)]);
    await expect(first.locator('[data-team-place]')).toHaveText(['11th', '12th']);
    await expect(first).toHaveAttribute('aria-expanded', 'true');
    await first.click();
    await expect(first).toHaveAttribute('aria-expanded', 'false');
    await expect(card.locator('[data-player-name]').first()).toBeHidden();
    expect(state.providerRequests).toEqual([]);
  });
}
