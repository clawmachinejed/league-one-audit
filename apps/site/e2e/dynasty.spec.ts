import { expect, test, type Locator, type Page } from '@playwright/test';
import { LEAGUE_IDS } from '../lib/config';
import { LEAGUE_SITES, type LeagueKey } from '../lib/leagues';

const widths = [320, 390, 430, 760, 1280] as const;
const preferenceKey = (league: LeagueKey) => `league-one:my-team:${LEAGUE_IDS[league]}`;

async function chooseLeague(page: Page, league: LeagueKey) {
  await page.locator('.league-switcher-trigger:visible').click();
  const choice = page.getByRole('link', { name: `View ${LEAGUE_SITES[league].name}`, exact: true });
  const source = await choice.locator('img').getAttribute('src');
  const image = new URL(source!, 'http://localhost');
  expect(image.searchParams.get('url') ?? image.pathname).toBe(LEAGUE_SITES[league].logo);
  await choice.click();
  await expect(page.locator('.brand-name')).toHaveText(`${LEAGUE_SITES[league].brand}.`);
}

async function savePreference(page: Page, league: LeagueKey, id: string) {
  await page.evaluate(({ key, value }) => {
    localStorage.setItem(key, value);
    window.dispatchEvent(new StorageEvent('storage', { key, newValue: value }));
  }, { key: preferenceKey(league), value: id });
}

async function expectSuperFlexFit(page: Page, scope: Locator, surface: string) {
  const slots = scope.locator('[aria-label="Super flex"]:visible');
  await expect(slots.first(), `${surface} must expose its real super flex slot`).toBeVisible();
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(() => slots.evaluateAll(elements => elements.every(element => {
      const box = element.getBoundingClientRect();
      return element.textContent === 'SF' && box.width > 0 && element.scrollWidth <= element.clientWidth;
    })), `${surface} super flex chips fit ${width}px`).toBe(true);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth
      <= document.documentElement.clientWidth + 1), `${surface} document fits ${width}px`).toBe(true);
    await expect.poll(() => page.locator('.site-header').evaluate(header => {
      const brand = header.querySelector('.brand')!.getBoundingClientRect();
      const actions = header.querySelector('.header-actions')!.getBoundingClientRect();
      return header.scrollWidth <= header.clientWidth + 1
        && (actions.width === 0 || brand.right <= actions.left + 1);
    }), `${surface} Dynasty branding and navigation fit ${width}px without overlapping`).toBe(true);
  }
}

test('Dynasty uses its Sleeper icon, all shared routes and an independent My Team preference', async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/standings', { waitUntil: 'networkidle' });
  const selected = new Map<LeagueKey, string>();
  for (const [index, league] of (['league1', 'league2', 'dynasty'] as const).entries()) {
    if (league !== 'league1') await chooseLeague(page, league);
    await expect(page).toHaveURL(new RegExp(`${LEAGUE_SITES[league].prefix}/standings$`, 'u'));
    const rows = page.locator('.standings-table tbody tr');
    await expect(rows).toHaveCount(league === 'dynasty' ? 10 : 12);
    const href = await rows.nth(index + 1).locator('.standings-team').getAttribute('href');
    const id = href!.split('/').at(-1)!;
    selected.set(league, id);
    await savePreference(page, league, id);
    await expect(page.locator('.standings-table .selected-row .standings-team')).toHaveAttribute('href', href!);
  }
  // Switching back mounts each league's own provider and reads the saved key again.
  for (const league of ['league1', 'league2', 'dynasty'] as const) {
    await chooseLeague(page, league);
    await expect(page.locator('.standings-table .selected-row .standings-team'))
      .toHaveAttribute('href', `${LEAGUE_SITES[league].prefix}/managers/${selected.get(league)}`);
  }
  await page.reload({ waitUntil: 'networkidle' });
  const dynastyId = selected.get('dynasty')!;
  await expect(page.locator('.standings-table .selected-row .standings-team'))
    .toHaveAttribute('href', `/dynasty/managers/${dynastyId}`);
  const brandImage = page.getByRole('link', { name: 'Dynasty League home' }).locator('img');
  await expect.poll(() => brandImage.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', LEAGUE_SITES.dynasty.logo);

  const navigation = page.getByRole('navigation', { name: 'Mobile navigation' });
  await navigation.getByRole('link', { name: 'Managers', exact: true }).click();
  await expect(page.locator('.manager-card')).toHaveCount(10);
  await page.locator(`.manager-card-link[href="/dynasty/managers/${dynastyId}"]`).click();
  await expect(page.getByRole('heading', { name: 'Starting lineup', exact: true })).toBeVisible();
  const teamName = await page.locator('.profile-identity h1').innerText();
  await expect(page.getByRole('button', { name: `Clear ${teamName} as My Team`, exact: true })).toBeVisible();
  await page.getByRole('navigation', { name: 'Team pages' }).getByRole('link', { name: 'Transactions', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/dynasty/managers/${dynastyId}/transactions$`, 'u'));
  await expect(page.getByRole('heading', { name: 'Team activity', exact: true })).toBeVisible();

  await navigation.getByRole('link', { name: 'My Team', exact: true }).click();
  await expect(page.locator('[data-matchup-toggle]')).toHaveCount(1);
  await expect(page.locator('[data-team-name]').first()).toHaveText(teamName);
  await page.getByRole('tab', { name: 'Schedule', exact: true }).click();
  await expect(page.locator('[data-schedule-week]')).toHaveCount(15);
  await expect(page.locator('[data-schedule-side="my-team"]').first()).toContainText(teamName);
  await navigation.getByRole('link', { name: 'Matchups', exact: true }).click();
  await expect(page.locator('[data-matchup-toggle]')).toHaveCount(5);
  await expect(page.locator('[data-team-name]').first()).toHaveText(teamName);
  expect(await page.evaluate(keys => keys.map(key => localStorage.getItem(key)),
    [...selected.keys()].map(preferenceKey))).toEqual([...selected.values()]);
});

test('Dynasty Week 1 official scores and real super flex slots fit every shared player surface', async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/dynasty/matchups?week=1', { waitUntil: 'networkidle' });
  await expect(page.getByLabel('Matchup week')).toHaveValue('1');
  const cards = page.locator('article:has([data-matchup-toggle])');
  if (await cards.count() === 0) {
    await expect(page.getByText(/No matchups posted|could not be loaded|unavailable/iu).first()).toBeVisible();
    test.info().annotations.push({ type: 'Sleeper data', description:
      'Dynasty Week 1 matchups were unavailable; real score and super flex geometry checks could not run.' });
    return;
  }
  await expect(cards).toHaveCount(5);
  const officialScores = await cards.locator('[data-score-number]').allTextContents();
  expect(officialScores).toHaveLength(10);
  expect(officialScores.every(score => /^-?\d+\.\d{2}$/u.test(score))).toBe(true);
  expect(officialScores.some(score => Number(score) > 0)).toBe(true);
  const first = cards.first();
  const teamName = await first.locator('[data-team-name]').first().innerText();
  await first.locator('[data-matchup-toggle]').click();
  const managerHref = await first.getByRole('link', { name: `View ${teamName} profile`, exact: true }).getAttribute('href');
  expect(managerHref).toMatch(/^\/dynasty\/managers\/\d+$/u);
  await expectSuperFlexFit(page, first, 'Matchups');

  await savePreference(page, 'dynasty', managerHref!.split('/').at(-1)!);
  await page.goto('/dynasty/my-team?week=1', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-team-name]').first()).toHaveText(teamName);
  await page.locator('[data-matchup-toggle]').click();
  await expect(page.getByRole('region', { name: 'Bench players' })).toBeVisible();
  await expectSuperFlexFit(page, page.locator('main'), 'My Team');

  await page.goto('/dynasty/standings', { waitUntil: 'networkidle' });
  await page.getByRole('tab', { name: 'Rosters', exact: true }).click();
  await page.getByLabel('Roster week').selectOption('1');
  const roster = page.locator(`[data-roster-card][data-team-id="${managerHref!.split('/').at(-1)}"]`);
  await roster.locator('[data-roster-toggle]').click();
  await expectSuperFlexFit(page, roster, 'League rosters');

  await page.goto(managerHref!, { waitUntil: 'networkidle' });
  await expect(page.locator('.profile-identity h1')).toHaveText(teamName);
  await expectSuperFlexFit(page, page.locator('.roster-layout'), 'Manager roster');
});
