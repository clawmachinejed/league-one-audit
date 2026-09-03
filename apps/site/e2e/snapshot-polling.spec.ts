import { expect, test, type Page, type Route } from '@playwright/test';
import { LEAGUE_IDS } from '../lib/config';
import type { MatchupPeriodContext } from '../lib/matchup-period';
import { snapshotFixture, snapshotHeaders, SNAPSHOT_A, SNAPSHOT_B, SNAPSHOT_C } from '../test-support/matchup-snapshot-fixtures';

const INITIAL_TIME = '2099-09-03T12:00:00.000Z';
const UPDATED_TIME = '2099-09-03T12:01:00.000Z';
type Temporal = MatchupPeriodContext['temporalState'];
type BrowserFixture = Awaited<ReturnType<typeof openFixture>>;
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

async function openFixture(page: Page, { league = 'league1', temporal = 'future', week = 5, adopt = true }:
  { league?: 'league1' | 'league2'; temporal?: Temporal; week?: number; adopt?: boolean } = {}) {
  const prefix = league === 'league2' ? '/league2' : '';
  const state = {
    revision: SNAPSHOT_B, verifiedAt: INITIAL_TIME, temporal, payload: snapshotFixture(week),
    compactStatus: 200, fullStatus: 200, compactCount: 0, fullCount: 0, refreshCount: 0,
    conflicts: 0, conflictRevision: SNAPSHOT_C, holdCompact: null as Promise<void> | null, holdFull: null as Promise<void> | null,
    fullRevisions: [] as string[], compactTimes: [] as number[], initialLineageInjections: 0,
  };
  await page.clock.install({ time: new Date('2026-09-03T12:00:00.000Z') });
  await page.addInitScript(({ key }) => { localStorage.setItem(key, '2'); }, { key: `league-one:my-team:${LEAGUE_IDS[league]}` });
  // Test transport only: real local SSR markup/data, controlled serialized lineage; no application test route.
  await page.route(/\/(?:league2\/)?matchups(?:\?|$)/u, async (route) => {
    if (route.request().resourceType() !== 'document') return route.continue();
    const response = await route.fetch();
    const html = await response.text();
    const dates = [...html.matchAll(/\\"updatedAt\\":\\"([^"\\]+)\\"/gu)];
    const lineage = /\\"snapshotRevision\\":(?:null|\\"[a-f0-9]{64}\\"),\\"verifiedAt\\":(?:null|\\"[^"\\]+\\")/gu;
    expect(dates.length, 'SSR must include a serialized matchup timestamp').toBeGreaterThan(0);
    expect([...html.matchAll(lineage)], 'SSR must include exactly one MatchupsView lineage').toHaveLength(1);
    const body = html.replace(lineage, `\\"snapshotRevision\\":\\"${SNAPSHOT_A}\\",\\"verifiedAt\\":\\"${dates[0][1]}\\"`);
    state.initialLineageInjections += 1;
    await route.fulfill({ response, body });
  });
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (request.headers().rsc === '1' && request.headers()['next-router-prefetch'] !== '1'
      && url.pathname === `${prefix}/matchups` && url.searchParams.get('week') === String(week)) state.refreshCount += 1;
  });
  await page.route('**/api/matchups/**', async (route: Route) => {
    const url = new URL(route.request().url());
    const requestedWeek = Number(url.searchParams.get('week'));
    const context = { defaultSeason: 2026, defaultWeek: state.temporal === 'past' ? requestedWeek + 1 : state.temporal === 'active' ? requestedWeek : 1,
      activeSeason: 2026, activeWeek: state.temporal === 'past' ? requestedWeek + 1 : state.temporal === 'active' ? requestedWeek : 1,
      lifecycle: 'active' as const, nflPhase: 'regular' as const, temporalState: state.temporal, refreshDue: false };
    const headers = Object.fromEntries(snapshotHeaders(state.revision, state.verifiedAt, context));
    if (url.pathname.endsWith('/revision')) {
      state.compactCount += 1;
      state.compactTimes.push(await page.evaluate(() => Date.now()));
      if (state.holdCompact) await state.holdCompact;
      await route.fulfill({ status: state.compactStatus, headers,
        json: state.compactStatus === 200 ? { status: 'ok', revision: state.revision, verifiedAt: state.verifiedAt } : { status: 'unavailable' } });
    } else {
      state.fullCount += 1;
      state.fullRevisions.push(url.searchParams.get('rev') ?? '');
      if (state.holdFull) await state.holdFull;
      if (state.conflicts > 0) {
        state.conflicts -= 1;
        state.revision = state.conflictRevision;
        await route.fulfill({ status: 409, json: { status: 'revision-mismatch' } });
      } else {
        await route.fulfill({ status: state.fullStatus, headers,
          json: state.fullStatus === 200 ? state.payload : { status: 'unavailable' } });
      }
    }
  });
  await page.goto(`${prefix}/matchups?week=${week}`, { waitUntil: 'networkidle' });
  expect(state.initialLineageInjections).toBe(1);
  if (adopt) {
    await page.getByRole('button', { name: 'Refresh matchups', exact: true }).click();
    await expect(page.getByText('Fixture Alpha', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Refresh matchups', exact: true })).toBeEnabled();
  }
  return state;
}
async function visible(page: Page, value: 'visible' | 'hidden') {
  await page.evaluate((visibility) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
    document.dispatchEvent(new Event('visibilitychange'));
  }, value);
}
async function nextPoll(page: Page, fixture: BrowserFixture) {
  const count = fixture.compactCount;
  await page.clock.runFor(60_000);
  await expect.poll(() => fixture.compactCount).toBe(count + 1);
  await expect(page.getByRole('button', { name: 'Refresh matchups', exact: true })).toBeEnabled();
}

for (const league of ['league1', 'league2'] as const) {
  test(`${league} starts with SSR lineage and skips the full body when its first revision is unchanged`, async ({ page }) => {
    const fixture = await openFixture(page, { league, adopt: false });
    fixture.revision = SNAPSHOT_A;
    await page.getByRole('button', { name: 'Refresh matchups', exact: true }).click();
    await expect.poll(() => fixture.compactCount).toBe(1);
    await expect(page.locator('.updated')).toContainText('8:00 AM ET');
    expect(fixture.fullCount).toBe(0);
    await nextPoll(page, fixture);
    expect(fixture.fullCount).toBe(0);
  });
}
for (const temporal of ['active', 'future'] as const) {
  test(`${temporal} snapshots poll compact metadata every minute without redownloading unchanged content`, async ({ page }) => {
    const fixture = await openFixture(page, { temporal });
    const fullCount = fixture.fullCount;
    const held = deferred(); fixture.holdCompact = held.promise;
    await page.clock.runFor(60_000);
    await expect.poll(() => fixture.compactCount).toBe(2);
    await page.clock.runFor(5_000);
    held.resolve(); fixture.holdCompact = null;
    await expect(page.getByRole('button', { name: 'Refresh matchups', exact: true })).toBeEnabled();
    await page.clock.runFor(55_000);
    await expect.poll(() => fixture.compactCount).toBe(3);
    expect(fixture.fullCount).toBe(fullCount);
  });
}

test('hidden pages make no checks, then check immediately when visible; completed pages stop polling', async ({ page }) => {
  const fixture = await openFixture(page);
  const before = fixture.compactCount;
  await visible(page, 'hidden');
  await page.clock.runFor(180_000);
  expect(fixture.compactCount).toBe(before);
  await visible(page, 'visible');
  await expect.poll(() => fixture.compactCount).toBe(before + 1);
  fixture.temporal = 'past';
  await nextPoll(page, fixture);
  const completed = fixture.compactCount;
  await page.clock.runFor(180_000);
  await visible(page, 'hidden');
  await visible(page, 'visible');
  expect(fixture.compactCount).toBe(completed);
});

test('same content advances freshness and changed content preserves expanded cards, team choice, and mobile formatting', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const fixture = await openFixture(page);
  const toggle = page.locator('button[data-matchup-toggle]').first();
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  fixture.verifiedAt = UPDATED_TIME;
  await nextPoll(page, fixture);
  await expect(page.locator('.updated')).toContainText('8:01 AM ET');
  expect(fixture.fullCount).toBe(1);
  fixture.revision = SNAPSHOT_C;
  fixture.payload = snapshotFixture(5, 'Updated Alpha');
  await nextPoll(page, fixture);
  await expect(page.getByText('Updated Alpha', { exact: true })).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  expect(fixture.fullCount).toBe(2);
  expect(await page.evaluate((key) => localStorage.getItem(key), `league-one:my-team:${LEAGUE_IDS.league1}`)).toBe('2');
  for (const width of [360, 390, 430, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
  }
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
});

test('publication races retry compact metadata once and never adopt a mismatched requested revision', async ({ page }) => {
  const fixture = await openFixture(page);
  fixture.revision = SNAPSHOT_A;
  fixture.conflicts = 1;
  fixture.payload = snapshotFixture(5, 'Race Winner');
  await page.getByRole('button', { name: 'Refresh matchups', exact: true }).click();
  await expect(page.getByText('Race Winner', { exact: true })).toBeVisible();
  expect(fixture.fullRevisions.slice(-2)).toEqual([SNAPSHOT_A, SNAPSHOT_C]);
  expect(fixture.compactCount).toBe(3);
  fixture.revision = SNAPSHOT_A;
  fixture.conflicts = 2;
  fixture.conflictRevision = SNAPSHOT_B;
  const fullBefore = fixture.fullCount;
  const compactBefore = fixture.compactCount;
  await page.clock.runFor(60_000);
  await expect.poll(() => fixture.fullCount).toBe(fullBefore + 2);
  expect(fixture.compactCount).toBe(compactBefore + 2);
  await expect(page.getByText('Race Winner', { exact: true })).toBeVisible();
  expect(fixture.fullCount).toBe(fullBefore + 2);
});

test('automatic future failures retain last good data while manual failures use the server fallback', async ({ page }) => {
  const fixture = await openFixture(page);
  fixture.compactStatus = 503;
  await nextPoll(page, fixture);
  await expect(page.getByText('Fixture Alpha', { exact: true })).toBeVisible();
  expect(fixture.refreshCount).toBe(0);
  await page.getByRole('button', { name: 'Refresh matchups', exact: true }).click();
  await expect.poll(() => fixture.refreshCount).toBe(1);
  await expect(page.getByText('Fixture Alpha', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Refresh matchups', exact: true })).toBeEnabled();
});

test('automatic current failures refresh official data', async ({ page }) => {
  const fixture = await openFixture(page, { temporal: 'active' });
  fixture.compactStatus = 503;
  await nextPoll(page, fixture);
  await expect.poll(() => fixture.refreshCount).toBe(1);
  await expect(page.getByText('Fixture Alpha', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Refresh matchups', exact: true })).toBeEnabled();
});

test('malformed full data cannot replace the future page and does not trigger a route refresh', async ({ page }) => {
  const fixture = await openFixture(page);
  fixture.revision = SNAPSHOT_C;
  fixture.payload.matchups[0].sides[0].starters[0].name = null as never;
  await nextPoll(page, fixture);
  await expect(page.getByText('Fixture Alpha', { exact: true })).toBeVisible();
  expect(fixture.refreshCount).toBe(0);
});

test('a timed-out manual refresh finishes and falls back without leaving the control active', async ({ page }) => {
  const fixture = await openFixture(page);
  const held = deferred(); fixture.holdCompact = held.promise;
  await page.getByRole('button', { name: 'Refresh matchups', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Refreshing matchups', exact: true })).toBeDisabled();
  await page.clock.runFor(15_001);
  await expect.poll(() => fixture.refreshCount).toBe(1);
  await expect(page.getByRole('button', { name: 'Refresh matchups', exact: true })).toBeEnabled();
  held.resolve();
});

test('hiding during an outstanding request cancels it without triggering fallback', async ({ page }) => {
  const fixture = await openFixture(page, { temporal: 'active' });
  const held = deferred(); fixture.holdCompact = held.promise;
  await page.clock.runFor(60_000);
  await expect.poll(() => fixture.compactCount).toBe(2);
  await visible(page, 'hidden');
  fixture.revision = SNAPSHOT_C;
  held.resolve();
  await page.clock.runFor(15_001);
  expect(fixture.fullCount).toBe(1);
  expect(fixture.refreshCount).toBe(0);
  await expect(page.getByText('Fixture Alpha', { exact: true })).toBeVisible();
});

test('a previous league response cannot overwrite the newly selected league at the same week', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const fixture = await openFixture(page, { week: 1 });
  fixture.revision = SNAPSHOT_C;
  fixture.payload = snapshotFixture(1, 'Late League One');
  const held = deferred(); fixture.holdFull = held.promise;
  await page.clock.runFor(60_000);
  await expect.poll(() => fixture.fullCount).toBe(2);
  await page.getByRole('navigation', { name: 'Mobile navigation' }).getByRole('button', { name: 'Choose league, current League One' }).click();
  await page.getByRole('link', { name: 'View League Two' }).click();
  await expect(page).toHaveURL(/\/league2\/matchups$/u);
  await expect(page.getByLabel('Matchup week')).toHaveValue('1');
  await expect(page.getByRole('link', { name: 'League Two home' })).toBeVisible();
  held.resolve();
  await page.clock.runFor(1);
  await expect(page.getByText('Late League One', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Fixture Alpha', { exact: true })).toHaveCount(0);
});

test('a previous week response cannot overwrite a newly selected week in the same league', async ({ page }) => {
  const fixture = await openFixture(page);
  fixture.revision = SNAPSHOT_C;
  fixture.payload = snapshotFixture(5, 'Late Week Five');
  const held = deferred(); fixture.holdFull = held.promise;
  await page.clock.runFor(60_000);
  await expect.poll(() => fixture.fullCount).toBe(2);
  await page.getByLabel('Matchup week').selectOption('6');
  await expect(page).toHaveURL(/\/matchups\?week=6$/u);
  await expect(page.getByLabel('Matchup week')).toHaveValue('6');
  held.resolve();
  await page.clock.runFor(1);
  await expect(page.getByText('Late Week Five', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Fixture Alpha', { exact: true })).toHaveCount(0);
});

test('both real league APIs reject invalid revision tokens with no-store responses', async ({ request }) => {
  for (const league of ['league1', 'league2']) {
    const response = await request.get(`/api/matchups/${league}?week=5&rev=invalid`, { maxRedirects: 0 });
    expect(response.status()).toBe(400);
    expect(response.headers()['cache-control']).toBe('no-store');
    expect(await response.json()).toEqual({ status: 'invalid-revision' });
  }
});
