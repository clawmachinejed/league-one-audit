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
    let body = html.replace(lineage, `\\"snapshotRevision\\":\\"${SNAPSHOT_A}\\",\\"verifiedAt\\":\\"${dates[0][1]}\\"`);
    const period = /\\"periodContext\\":(\{[^{}]*\})/gu;
    expect([...body.matchAll(period)], 'SSR must include exactly one MatchupsView period context').toHaveLength(1);
    // Keep the server's display period (and its visible week-control markup), but
    // make fixture polling independent of the real NFL calendar. API responses
    // below remain the authority for subsequent active/future/completed transitions.
    body = body.replace(period, (_match, serialized: string) => {
      const initial = JSON.parse(serialized.replace(/\\"/gu, '"')) as MatchupPeriodContext;
      const controlled: MatchupPeriodContext = { ...initial, lifecycle: 'active', nflPhase: 'regular',
        activeSeason: temporal === 'future' && week === 1 ? 2025 : 2026,
        activeWeek: temporal === 'future' ? week === 1 ? 18 : week - 1 : temporal === 'past' ? week + 1 : week,
        temporalState: temporal, refreshDue: false };
      return `\\"periodContext\\":${JSON.stringify(controlled).replace(/"/gu, '\\"')}`;
    });
    // A historical server response omits this note. Keep its initial markup in
    // agreement with the controlled non-past context without replacing the board.
    if (temporal !== 'past' && !body.includes('class="refresh-note"')) {
      body = body.replace(/(<p class="updated"[^>]*>[\s\S]*?<\/p>)/u,
        '$1<p class="refresh-note">Checks for a newer matchup snapshot every minute while this page is open.</p>');
    }
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
  await expect(page.getByRole('button', { name: /refresh(?:ing)? matchups/iu })).toHaveCount(0);
  if (adopt) {
    await nextPoll(page, state);
    await expect(page.getByText('Fixture Alpha', { exact: true })).toBeVisible();
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
  await expect(page.locator('.updated')).not.toContainText('Checking for matchup updates');
}

for (const league of ['league1', 'league2'] as const) {
  test(`${league} starts with SSR lineage and skips the full body when its first revision is unchanged`, async ({ page }) => {
    const fixture = await openFixture(page, { league, adopt: false });
    fixture.revision = SNAPSHOT_A;
    await nextPoll(page, fixture);
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
    await expect(page.locator('.updated')).not.toContainText('Checking for matchup updates');
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

for (const league of ['league1', 'league2'] as const) {
  test(`${league} refreshes scheduled NFL labels through live, Half, and final results at supported widths`, async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    const fixture = await openFixture(page, { league, temporal: 'active', adopt: false });
    const matchup = fixture.payload.matchups[0];
    matchup.status = 'live';
    fixture.payload.league.rosterPositions = ['QB', 'RB'];
    const [left, right] = matchup.sides;
    left.starters[0].game = { kind: 'scheduled', opponent: 'TEN', location: 'away',
      date: '2026-09-03', kickoffAt: '2026-09-04T00:20:00.000Z' };
    right.starters[0].game = { kind: 'scheduled', opponent: 'NYJ', location: 'home',
      date: '2026-09-03', kickoffAt: '2026-09-04T00:20:00.000Z' };
    left.starters.push({ ...left.starters[0], id: 'fixture-tie-player', name: 'Fixture Tie Player',
      position: 'RB', slot: 'RB', game: { kind: 'scheduled', opponent: 'LAR', location: 'home',
        date: '2026-09-03', kickoffAt: '2026-09-04T00:20:00.000Z' } });
    right.starters.push({ ...right.starters[0], id: 'fixture-unfinished-player', name: 'Fixture Unfinished Player',
      position: 'RB', slot: 'RB', game: { kind: 'scheduled', opponent: 'KC', location: 'away',
        date: '2026-09-07', kickoffAt: '2026-09-08T00:15:00.000Z' } });
    await nextPoll(page, fixture);
    await expect(page.getByText('Fixture Alpha', { exact: true })).toBeVisible();
    const toggle = page.locator('button[data-matchup-toggle]').first();
    await toggle.click();
    await expect(toggle.locator('[data-team-name]')).toHaveText(['Fixture Beta', 'Fixture Alpha']);
    const labels = page.locator('[data-player-game]');
    // The fixture saves roster 2 as My Team. Keep source games unchanged and
    // assert each starter row in the rendered Beta-left, Alpha-right order.
    const displayedLabels = (sourceOrder: readonly string[]) => [sourceOrder[1], sourceOrder[0], sourceOrder[3], sourceOrder[2]];
    const expectLabelFit = async () => {
      for (const width of [360, 390, 430, 1280]) {
        await page.setViewportSize({ width, height: 900 });
        await expect.poll(async () => labels.evaluateAll((nodes) => nodes.every((node) => {
          const game = node as HTMLElement;
          const meta = game.closest<HTMLElement>('[data-player-meta]');
          return !!meta && game.scrollWidth <= meta.clientWidth + 1;
        })), `NFL labels should fit without clipping at ${width}px`).toBe(true);
        const heights = await labels.evaluateAll((nodes) => nodes.map((node) => (
          node.closest<HTMLElement>('div[class*="playerRow"]')?.getBoundingClientRect().height ?? 0
        )));
        for (const height of heights) expect(height).toBeCloseTo(52, 0);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
      }
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    };
    await expect(labels).toHaveText(displayedLabels([
      'Thu 8:20 PM @ TEN', 'Thu 8:20 PM vs NYJ', 'Thu 8:20 PM vs LAR', 'Mon 8:15 PM @ KC',
    ]));
    await expectLabelFit();

    if (left.starters[0].game?.kind !== 'scheduled' || right.starters[0].game?.kind !== 'scheduled'
      || left.starters[1].game?.kind !== 'scheduled') throw new Error('Expected scheduled fixture games.');
    const [awayGame, homeGame, tieGame] = [left.starters[0].game, right.starters[0].game, left.starters[1].game];
    let adoptedCount = 1;
    const adoptLabels = async (expected: string[]) => {
      // New revisions exercise the real compact-to-full browser adoption protocol.
      fixture.revision = (adoptedCount + 11).toString(16).repeat(64);
      fixture.verifiedAt = new Date(Date.parse(INITIAL_TIME) + adoptedCount * 60_000).toISOString();
      await nextPoll(page, fixture);
      await expect(labels).toHaveText(displayedLabels(expected));
      adoptedCount += 1;
      expect(fixture.fullCount).toBe(adoptedCount);
      await expectLabelFit();
    };
    awayGame.liveScore = { teamScore: 0, opponentScore: 0, phase: 'q1', clockSeconds: 900 };
    homeGame.liveScore = { teamScore: 10, opponentScore: 24, phase: 'q2', clockSeconds: 0 };
    tieGame.liveScore = { teamScore: 17, opponentScore: 17, phase: 'overtime', clockSeconds: 165 };
    await adoptLabels([
      '15:00 1st 0-0 @ TEN', '00:00 2nd 10-24 vs NYJ', '02:45 OT 17-17 vs LAR', 'Mon 8:15 PM @ KC',
    ]);
    awayGame.liveScore = { teamScore: 10, opponentScore: 7, phase: 'halftime', clockSeconds: null };
    homeGame.liveScore = { teamScore: 10, opponentScore: 24, phase: 'halftime', clockSeconds: null };
    tieGame.liveScore = { teamScore: 17, opponentScore: 17, phase: 'overtime', clockSeconds: null };
    await adoptLabels([
      'Half 10-7 @ TEN', 'Half 10-24 vs NYJ', 'OT 17-17 vs LAR', 'Mon 8:15 PM @ KC',
    ]);
    awayGame.liveScore = { teamScore: 23, opponentScore: 10, phase: 'q3', clockSeconds: 165 };
    homeGame.liveScore = { teamScore: 10, opponentScore: 24, phase: 'q4', clockSeconds: 5 };
    await adoptLabels([
      '02:45 3rd 23-10 @ TEN', '00:05 4th 10-24 vs NYJ', 'OT 17-17 vs LAR', 'Mon 8:15 PM @ KC',
    ]);

    // Individual NFL games finish while the fantasy matchup and week remain live.
    delete awayGame.liveScore;
    delete homeGame.liveScore;
    delete tieGame.liveScore;
    awayGame.finalScore = { teamScore: 23, opponentScore: 10 };
    homeGame.finalScore = { teamScore: 10, opponentScore: 24 };
    tieGame.finalScore = { teamScore: 17, opponentScore: 17 };
    await adoptLabels([
      'Final W 23-10 @ TEN', 'Final L 10-24 vs NYJ', 'Final T 17-17 vs LAR', 'Mon 8:15 PM @ KC',
    ]);
    expect(fixture.refreshCount).toBe(0);
    expect(await page.evaluate((key) => localStorage.getItem(key), `league-one:my-team:${LEAGUE_IDS[league]}`)).toBe('2');
  });
}

test('publication races retry compact metadata once and never adopt a mismatched requested revision', async ({ page }) => {
  const fixture = await openFixture(page);
  fixture.revision = SNAPSHOT_A;
  fixture.conflicts = 1;
  fixture.payload = snapshotFixture(5, 'Race Winner');
  await page.clock.runFor(60_000);
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

test('repeated automatic future failures retain last good data and the next good poll recovers', async ({ page }) => {
  const fixture = await openFixture(page);
  fixture.compactStatus = 503;
  await nextPoll(page, fixture);
  await expect(page.getByText('Fixture Alpha', { exact: true })).toBeVisible();
  expect(fixture.refreshCount).toBe(0);
  await nextPoll(page, fixture);
  await expect(page.getByText('Fixture Alpha', { exact: true })).toBeVisible();
  expect(fixture.refreshCount).toBe(0);
  expect(fixture.fullCount).toBe(1);
  fixture.compactStatus = 200;
  fixture.revision = SNAPSHOT_C;
  fixture.payload = snapshotFixture(5, 'Recovered Alpha');
  await nextPoll(page, fixture);
  await expect(page.getByText('Recovered Alpha', { exact: true })).toBeVisible();
  expect(fixture.fullCount).toBe(2);
  expect(fixture.refreshCount).toBe(0);
});

test('automatic current failures refresh official data', async ({ page }) => {
  const fixture = await openFixture(page, { temporal: 'active' });
  fixture.compactStatus = 503;
  await nextPoll(page, fixture);
  await expect.poll(() => fixture.refreshCount).toBe(1);
  await expect(page.getByText('Fixture Alpha', { exact: true })).toHaveCount(0);
  await expect(page.locator('.updated')).not.toContainText('Checking for matchup updates');
});

test('malformed full data cannot replace the future page and does not trigger a route refresh', async ({ page }) => {
  const fixture = await openFixture(page);
  fixture.revision = SNAPSHOT_C;
  fixture.payload.matchups[0].sides[0].starters[0].name = null as never;
  await nextPoll(page, fixture);
  await expect(page.getByText('Fixture Alpha', { exact: true })).toBeVisible();
  expect(fixture.refreshCount).toBe(0);
});

test('a timed-out automatic current check falls back and clears the checking status', async ({ page }) => {
  const fixture = await openFixture(page, { temporal: 'active' });
  const held = deferred(); fixture.holdCompact = held.promise;
  await page.clock.runFor(60_000);
  await expect.poll(() => fixture.compactCount).toBe(2);
  await expect(page.locator('.updated')).toContainText('Checking for matchup updates');
  await page.clock.runFor(15_001);
  await expect.poll(() => fixture.refreshCount).toBe(1);
  await expect(page.getByText('Fixture Alpha', { exact: true })).toHaveCount(0);
  await expect(page.locator('.updated')).not.toContainText('Checking for matchup updates');
  held.resolve();
});

test('a timed-out automatic future check retains good data and permits the next scheduled check', async ({ page }) => {
  const fixture = await openFixture(page);
  const held = deferred(); fixture.holdCompact = held.promise;
  await page.clock.runFor(60_000);
  await expect.poll(() => fixture.compactCount).toBe(2);
  await expect(page.locator('.updated')).toContainText('Checking for matchup updates');
  await page.clock.runFor(15_001);
  await expect(page.locator('.updated')).not.toContainText('Checking for matchup updates');
  await expect(page.getByText('Fixture Alpha', { exact: true })).toBeVisible();
  expect(fixture.refreshCount).toBe(0);
  expect(fixture.fullCount).toBe(1);
  held.resolve(); fixture.holdCompact = null;
  fixture.revision = SNAPSHOT_C;
  fixture.payload = snapshotFixture(5, 'After Timeout');
  // The interval is still anchored to the previous poll. Advance only the
  // remaining part of that minute, then let mocked network responses settle;
  // advancing a whole minute here also fires the new request's timeout.
  await page.clock.runFor(60_000 - 15_001);
  await expect.poll(() => fixture.compactCount).toBe(3);
  await expect(page.getByText('After Timeout', { exact: true })).toBeVisible();
  await expect(page.locator('.updated')).not.toContainText('Checking for matchup updates');
  expect(fixture.fullCount).toBe(2);
  expect(fixture.refreshCount).toBe(0);
  await nextPoll(page, fixture);
  expect(fixture.compactCount).toBe(4);
  expect(fixture.fullCount).toBe(2);
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
  // The real league picker opens the destination's Current week. Keep this race
  // at that same week without assuming the live NFL calendar is always Week 1.
  await page.goto('/league2/matchups');
  const destinationPicker = page.getByRole('combobox', { name: 'Matchup week', exact: true });
  await expect(destinationPicker).toBeVisible();
  const destinationWeek = Number(await destinationPicker.inputValue());
  expect(Number.isInteger(destinationWeek) && destinationWeek >= 1 && destinationWeek <= 18).toBe(true);
  const fixture = await openFixture(page, { week: destinationWeek, temporal: 'active' });
  fixture.revision = SNAPSHOT_C;
  fixture.payload = snapshotFixture(destinationWeek, 'Late League One');
  const held = deferred(); fixture.holdFull = held.promise;
  await page.clock.runFor(60_000);
  await expect.poll(() => fixture.fullCount).toBe(2);
  await page.getByRole('navigation', { name: 'Mobile navigation' }).getByRole('button', { name: 'Choose league, current League One' }).click();
  await page.getByRole('link', { name: 'View League Two' }).click();
  await expect(page).toHaveURL(/\/league2\/matchups$/u);
  await expect(page.getByLabel('Matchup week')).toHaveValue(String(destinationWeek));
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
