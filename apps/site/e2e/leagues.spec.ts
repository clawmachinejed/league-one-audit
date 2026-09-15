import { expect, test, type Locator, type Page } from '@playwright/test';
import { LEAGUE_IDS } from '../lib/config';

const phoneWidths = [360, 390, 430] as const;
const sharedNavigationViewports = [
  { name: 'minimum supported width', width: 320, height: 800 },
  { name: 'iPhone width', width: 390, height: 844 },
  { name: 'wide mobile', width: 504, height: 932 },
  { name: 'desktop navigation boundary', width: 760, height: 900 },
  { name: 'desktop', width: 1280, height: 900 },
] as const;

const primaryNavigation = [
  { section: 'my-team', label: 'My Team' },
  { section: 'matchups', label: 'Matchups' },
  { section: 'standings', label: 'League' },
  { section: 'managers', label: 'Managers' },
] as const;

async function expectNoPageOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth, 'the document should fit its viewport').toBeLessThanOrEqual(dimensions.clientWidth + 1);
}

async function expectTouchHeight(locator: Locator) {
  const box = await locator.boundingBox();
  expect(box, 'the control should be rendered').not.toBeNull();
  expect(box!.height, 'touch controls should be at least 44px tall').toBeGreaterThanOrEqual(44);
}

async function readNavigationGeometry(navigation: Locator) {
  return navigation.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const switcher = element.querySelector<HTMLElement>(':scope > .league-switcher')?.getBoundingClientRect();
    const trigger = element.querySelector<HTMLElement>(':scope > .league-switcher > button')?.getBoundingClientRect();
    const items = [...element.querySelectorAll<HTMLElement>(':scope > a')].map(item => {
      const itemRect = item.getBoundingClientRect();
      const itemStyle = getComputedStyle(item);
      const icon = item.querySelector<SVGElement>('svg')!;
      const iconRect = icon.getBoundingClientRect();
      const label = item.querySelector<HTMLElement>('span') ?? item;
      const labelRect = label.getBoundingClientRect();
      return {
        label: item.textContent?.trim(),
        x: itemRect.x,
        y: itemRect.y,
        width: itemRect.width,
        height: itemRect.height,
        minHeight: Number.parseFloat(itemStyle.minHeight),
        borderRadius: Number.parseFloat(itemStyle.borderRadius),
        gap: Number.parseFloat(itemStyle.gap),
        fontSize: Number.parseFloat(itemStyle.fontSize),
        fontWeight: itemStyle.fontWeight,
        lineHeight: Number.parseFloat(itemStyle.lineHeight),
        iconX: iconRect.x,
        iconY: iconRect.y,
        iconWidth: iconRect.width,
        iconHeight: iconRect.height,
        iconStrokeWidth: icon.getAttribute('stroke-width'),
        labelX: labelRect.x,
        labelY: labelRect.y,
        labelWidth: labelRect.width,
        labelHeight: labelRect.height,
      };
    });
    return {
      position: style.position,
      bottom: Number.parseFloat(style.bottom),
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      paddingTop: Number.parseFloat(style.paddingTop),
      paddingRight: Number.parseFloat(style.paddingRight),
      paddingBottom: Number.parseFloat(style.paddingBottom),
      paddingLeft: Number.parseFloat(style.paddingLeft),
      switcher: switcher && { x: switcher.x, y: switcher.y, width: switcher.width, height: switcher.height },
      trigger: trigger && { x: trigger.x, y: trigger.y, width: trigger.width, height: trigger.height },
      items,
    };
  });
}

function stableGeometry(geometry: Awaited<ReturnType<typeof readNavigationGeometry>>) {
  return {
    ...geometry,
    items: geometry.items.map(item => ({
      ...item,
      label: undefined,
      labelX: undefined,
      labelWidth: undefined,
    })),
  };
}

test('the mobile league selector is first, accessible, and fits every supported phone width', async ({ page }) => {
  for (const width of phoneWidths) {
    await test.step(`${width}px`, async () => {
      await page.setViewportSize({ width, height: 844 });
      await page.goto('/matchups', { waitUntil: 'networkidle' });

      const mobileNav = page.getByRole('navigation', { name: 'Mobile navigation' });
      const trigger = mobileNav.getByRole('button', { name: 'Choose league, current League One' });
      await expect(trigger).toBeVisible();
      await expectTouchHeight(trigger);
      await expect(mobileNav.locator(':scope > .league-switcher')).toHaveCount(1);
      await expect(mobileNav.locator(':scope > *').first()).toHaveClass(/league-switcher/u);

      await trigger.click();
      const leagueOne = mobileNav.getByRole('link', { name: 'View League One' });
      const leagueTwo = mobileNav.getByRole('link', { name: 'View League Two' });
      await expect(leagueOne).toBeVisible();
      await expect(leagueTwo).toBeVisible();
      await expectTouchHeight(leagueOne);
      await expectTouchHeight(leagueTwo);
      await expectNoPageOverflow(page);

      await page.keyboard.press('Escape');
      await expect(leagueOne).toHaveCount(0);
      await expect(trigger).toBeFocused();
    });
  }
});

test('the shared navigation uses Matchups geometry at every required width in both leagues', async ({ page }) => {
  for (const viewport of sharedNavigationViewports) {
    for (const prefix of ['', '/league2'] as const) {
      await test.step(`${prefix || 'League One'} at ${viewport.name}`, async () => {
        await page.setViewportSize(viewport);
        await page.goto(`${prefix}/matchups`, { waitUntil: 'networkidle' });
        await expectNoPageOverflow(page);

        const navigation = page.getByRole('navigation', {
          name: viewport.width < 760 ? 'Mobile navigation' : 'Main navigation',
        });
        await expect(navigation).toBeVisible();
        for (const item of primaryNavigation) {
          await expect(navigation.getByRole('link', { name: item.label, exact: true }))
            .toHaveAttribute('href', `${prefix}/${item.section}`);
        }
        await expect(navigation.locator(':scope > a')).toHaveText(primaryNavigation.map(item => item.label));

        if (viewport.width >= 760) return;

        const geometry = await readNavigationGeometry(navigation);
        expect(geometry.position).toBe('fixed');
        expect(geometry.bottom).toBe(0);
        expect(geometry.x).toBeCloseTo(0, 1);
        expect(geometry.y + geometry.height).toBeCloseTo(viewport.height, 1);
        expect(geometry.width).toBeCloseTo(await page.evaluate(() => document.body.getBoundingClientRect().width), 1);
        expect(geometry.height).toBeCloseTo(53, 1);
        expect(geometry.paddingTop).toBeCloseTo(4, 1);
        expect(geometry.paddingBottom).toBeGreaterThanOrEqual(4);
        expect(geometry.paddingLeft).toBeCloseTo(8, 1);
        expect(geometry.paddingRight).toBeCloseTo(8, 1);
        expect(geometry.switcher?.height).toBeCloseTo(44, 1);
        expect(geometry.trigger?.width).toBeCloseTo(44, 1);
        expect(geometry.trigger?.height).toBeCloseTo(44, 1);

        const expectedColumnWidth = (geometry.width - geometry.paddingLeft - geometry.paddingRight) / 5;
        for (const item of geometry.items) {
          expect(item.width).toBeCloseTo(expectedColumnWidth, 1);
          expect(item.height).toBeCloseTo(44, 1);
          expect(item.minHeight).toBeCloseTo(44, 1);
          expect(item.borderRadius).toBeCloseTo(9, 1);
          expect(item.gap).toBeCloseTo(4, 1);
          expect(item.fontSize).toBeCloseTo(10, 1);
          expect(item.fontWeight).toBe('700');
          expect(item.lineHeight).toBeCloseTo(12, 1);
          expect(item.iconWidth).toBeCloseTo(19, 1);
          expect(item.iconHeight).toBeCloseTo(19, 1);
          expect(item.iconStrokeWidth).toBe('1.7');
        }
        expect(geometry.items.map(item => item.y)).toEqual(geometry.items.map(() => geometry.items[0].y));
        expect(geometry.items.map(item => item.iconY)).toEqual(geometry.items.map(() => geometry.items[0].iconY));
        expect(geometry.items.map(item => item.labelY)).toEqual(geometry.items.map(() => geometry.items[0].labelY));
        expect(geometry.items[1].x - geometry.items[0].x).toBeCloseTo(expectedColumnWidth, 1);
        expect(geometry.items[2].x - geometry.items[1].x).toBeCloseTo(expectedColumnWidth, 1);
        expect(geometry.items[3].x - geometry.items[2].x).toBeCloseTo(expectedColumnWidth, 1);
      });
    }
  }
});

test('League navigation stays distinct from Standings content and does not resize between sections', async ({ page }) => {
  for (const viewport of [sharedNavigationViewports[1], sharedNavigationViewports[4]]) {
    for (const prefix of ['', '/league2'] as const) {
      await test.step(`${prefix || 'League One'} at ${viewport.name}`, async () => {
        await page.setViewportSize(viewport);
        await page.goto(`${prefix}/matchups`, { waitUntil: 'networkidle' });
        const navigation = page.getByRole('navigation', {
          name: viewport.width < 760 ? 'Mobile navigation' : 'Main navigation',
        });
        const baseline = stableGeometry(await readNavigationGeometry(navigation));

        for (const item of primaryNavigation) {
          const link = navigation.getByRole('link', { name: item.label, exact: true });
          await link.click();
          await expect(page).toHaveURL(new RegExp(`${prefix}/${item.section}$`, 'u'));
          await expect(link).toHaveAttribute('aria-current', 'page');
          await expectNoPageOverflow(page);
          expect(stableGeometry(await readNavigationGeometry(navigation))).toEqual(baseline);
        }

        await expect(navigation.getByRole('link', { name: 'Standings', exact: true })).toHaveCount(0);
        await navigation.getByRole('link', { name: 'League', exact: true }).click();
        await expect(page.getByRole('heading', { level: 1, name: 'League', exact: true })).toBeVisible();
        const standingsViews = page.getByRole('tablist', { name: 'Standings views' });
        await expect(standingsViews.getByRole('tab', { name: 'Standings', exact: true })).toBeVisible();
        await expect(standingsViews.getByRole('tab', { name: 'Waivers', exact: true })).toBeVisible();
        await expect(standingsViews.getByRole('tab', { name: 'Transactions', exact: true })).toBeVisible();

        await navigation.getByRole('link', { name: 'Managers', exact: true }).click();
        const managerLink = page.locator(`a[href^="${prefix}/managers/"]`).first();
        if (await managerLink.count()) {
          await managerLink.click();
          await expect(page).toHaveURL(new RegExp(`${prefix}/managers/[^/]+$`, 'u'));
          await expect(navigation.getByRole('link', { name: 'Managers', exact: true })).toHaveAttribute('aria-current', 'page');
          expect(stableGeometry(await readNavigationGeometry(navigation))).toEqual(baseline);
          await expectNoPageOverflow(page);
        } else {
          test.info().annotations.push({
            type: 'Sleeper data',
            description: `${prefix || 'League One'} returned no manager cards, so its detail-route geometry check was not applicable.`,
          });
        }
      });
    }
  }
});

test('switching leagues changes identity, data routes, and every primary tab', async ({ page }) => {
  const leagueOneLogo = /league-one-logo-63ab193e\.jpg/u;
  const leagueTwoLogo = /league-two-logo-6c951682\.jpg/u;
  const expectBrand = async (name: 'League One' | 'League Two', image: RegExp, icon: string) => {
    const home = page.getByRole('link', { name: `${name} home` });
    await expect(home).toBeVisible();
    await expect(home.locator('img')).toHaveAttribute('src', image);
    await expect(page.locator('.league-switcher-mobile button img')).toHaveAttribute('src', image);
    await expect(page.locator('.league-switcher-desktop button img')).toHaveAttribute('src', image);
    for (const rel of ['icon', 'apple-touch-icon']) {
      const metadata = page.locator(`link[rel="${rel}"]`);
      await expect(metadata).toHaveCount(1);
      await expect(metadata).toHaveAttribute('href', icon);
    }
  };
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/matchups', { waitUntil: 'networkidle' });
  await expectBrand('League One', leagueOneLogo, '/league-one-logo-63ab193e.jpg');

  await page.getByRole('navigation', { name: 'Mobile navigation' })
    .getByRole('button', { name: 'Choose league, current League One' }).click();
  await expect(page.getByRole('link', { name: 'View League One' }).locator('img')).toHaveAttribute('src', leagueOneLogo);
  await expect(page.getByRole('link', { name: 'View League Two' }).locator('img')).toHaveAttribute('src', leagueTwoLogo);
  await page.getByRole('link', { name: 'View League Two' }).click();

  await expect(page).toHaveURL(/\/league2\/matchups$/u);
  const leagueTwoHome = page.getByRole('link', { name: 'League Two home' });
  await expectBrand('League Two', leagueTwoLogo, '/league-two-logo-6c951682.jpg');
  await expect(leagueTwoHome).toContainText('LEAGUE TWO.');
  await expect(page.getByRole('heading', { level: 1, name: 'Matchups' })).toBeVisible();

  const mobileNav = page.getByRole('navigation', { name: 'Mobile navigation' });
  await expect(mobileNav.getByRole('link', { name: 'Matchups' })).toHaveAttribute('href', '/league2/matchups');
  await expect(mobileNav.getByRole('link', { name: 'League' })).toHaveAttribute('href', '/league2/standings');
  await expect(mobileNav.getByRole('link', { name: 'Managers' })).toHaveAttribute('href', '/league2/managers');

  await mobileNav.getByRole('link', { name: 'League' }).click();
  await expect(page).toHaveURL(/\/league2\/standings$/u);
  await expect(page.getByRole('heading', { level: 1, name: 'League' })).toBeVisible();
  await expect(page.getByText('2026 season', { exact: true })).toBeVisible();

  await page.getByRole('navigation', { name: 'Mobile navigation' }).getByRole('link', { name: 'Managers' }).click();
  await expect(page).toHaveURL(/\/league2\/managers$/u);
  await expect(page.getByRole('heading', { level: 1, name: 'Managers' })).toBeVisible();
  await expect(page.getByText('2026 season', { exact: true })).toBeVisible();
  await expect(page.getByText('The people and teams of League Two.', { exact: true })).toHaveCount(0);
  const managerLink = page.locator('a[href^="/league2/managers/"]').first();
  if (await managerLink.count()) await expect(managerLink).toBeVisible();
  await expectNoPageOverflow(page);

  await mobileNav.getByRole('button', { name: 'Choose league, current League Two' }).click();
  await expect(mobileNav.getByRole('link', { name: 'View League One' }).locator('img')).toHaveAttribute('src', leagueOneLogo);
  await expect(mobileNav.getByRole('link', { name: 'View League Two' }).locator('img')).toHaveAttribute('src', leagueTwoLogo);
  await mobileNav.getByRole('link', { name: 'View League One' }).click();
  await expect(page).toHaveURL(/\/managers$/u);
  await expectBrand('League One', leagueOneLogo, '/league-one-logo-63ab193e.jpg');
});

test('selecting the active league preserves the viewed matchup week', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/matchups?week=5', { waitUntil: 'networkidle' });
  await expect(page.getByLabel('Matchup week')).toHaveValue('5');

  const mobileNav = page.getByRole('navigation', { name: 'Mobile navigation' });
  await mobileNav.getByRole('button', { name: 'Choose league, current League One' }).click();
  await mobileNav.getByRole('link', { name: 'View League One' }).click();

  await expect(page).toHaveURL(/\/matchups\?week=5$/u);
  await expect(page.getByLabel('Matchup week')).toHaveValue('5');
});

test('My Team stays in the same section when switching leagues and always shows the current week', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/my-team?week=1', { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { name: 'My Team', exact: true })).toBeVisible();
  await expect(page.getByLabel('Matchup week', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel(/^Current matchup week \d+$/u)).toBeVisible();
  const mobileNav = page.getByRole('navigation', { name: 'Mobile navigation' });
  await expect(mobileNav.getByRole('link', { name: 'My Team', exact: true })).toHaveAttribute('aria-current', 'page');
  await mobileNav.getByRole('button', { name: 'Choose league, current League One' }).click();
  await expect(mobileNav.getByRole('link', { name: 'View League Two' })).toHaveAttribute('href', '/league2/my-team');
  await mobileNav.getByRole('link', { name: 'View League Two' }).click();
  await expect(page).toHaveURL(/\/league2\/my-team$/u);
  await expect(page.getByRole('heading', { name: 'My Team', exact: true })).toBeVisible();
  await expect(page.getByLabel(/^Current matchup week \d+$/u)).toBeVisible();
  await expect(mobileNav.getByRole('link', { name: 'My Team', exact: true })).toHaveAttribute('href', '/league2/my-team');
  await expectNoPageOverflow(page);
});

test('My Team choices remain independent between League One and League Two', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/managers', { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });

  const leagueOneLink = page.locator('.manager-card-link').first();
  test.skip((await leagueOneLink.count()) === 0, 'Sleeper has not returned League One manager cards.');
  const leagueOneProfile = await leagueOneLink.getAttribute('href');
  expect(leagueOneProfile).toMatch(/^\/managers\/\d+$/u);
  await expect(page.locator('.my-team-button')).toHaveCount(0);
  await leagueOneLink.click();
  await expect(page).toHaveURL(new RegExp(`${leagueOneProfile}$`, 'u'));
  const leagueOneTeamName = await page.locator('.profile-identity h1').innerText();
  const leagueOneButton = page.locator('.manager-heading .my-team-button');
  await expect(leagueOneButton).toHaveAttribute('aria-pressed', 'false');
  await leagueOneButton.click();
  await expect(leagueOneButton).toHaveAttribute('aria-pressed', 'true');

  const mobileNav = page.getByRole('navigation', { name: 'Mobile navigation' });
  await mobileNav.getByRole('button', { name: 'Choose league, current League One' }).click();
  await page.getByRole('link', { name: 'View League Two' }).click();
  await expect(page).toHaveURL(/\/league2\/managers$/u);

  const leagueTwoLink = page.locator('.manager-card-link').first();
  test.skip((await leagueTwoLink.count()) === 0, 'Sleeper has not returned League Two manager cards.');
  const leagueTwoProfile = await leagueTwoLink.getAttribute('href');
  expect(leagueTwoProfile).toMatch(/^\/league2\/managers\/\d+$/u);
  await expect(page.locator('.my-team-button, .manager-card.selected-manager')).toHaveCount(0);
  await leagueTwoLink.click();
  await expect(page).toHaveURL(new RegExp(`${leagueTwoProfile}$`, 'u'));
  const leagueTwoTeamName = await page.locator('.profile-identity h1').innerText();
  const leagueTwoButton = page.locator('.manager-heading .my-team-button');
  await expect(leagueTwoButton).toHaveAttribute('aria-pressed', 'false');
  await leagueTwoButton.click();
  await expect(leagueTwoButton).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('navigation', { name: 'Mobile navigation' })
    .getByRole('button', { name: 'Choose league, current League Two' }).click();
  await page.getByRole('link', { name: 'View League One' }).click();
  await expect(page).toHaveURL(/\/managers$/u);
  await expect(page.locator('.manager-card.selected-manager')).toHaveCount(1);
  await expect(page.locator('.manager-card.selected-manager a')).toHaveAttribute('href', leagueOneProfile!);
  await page.locator('.manager-card.selected-manager a').click();
  await expect(page.locator('.manager-heading .my-team-button')).toHaveAttribute('aria-pressed', 'true');

  const storedKeys = await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('league-one:my-team:')).sort());
  const expectedKeys = Object.values(LEAGUE_IDS).map(id => `league-one:my-team:${id}`).sort();
  expect(storedKeys).toEqual(expectedKeys);
  const stored = await page.evaluate((keys) => keys.map(key => localStorage.getItem(key)),
    [`league-one:my-team:${LEAGUE_IDS.league1}`, `league-one:my-team:${LEAGUE_IDS.league2}`]);
  expect(stored).toEqual([leagueOneProfile!.split('/').at(-1), leagueTwoProfile!.split('/').at(-1)]);

  for (const [prefix, teamName] of [['', leagueOneTeamName], ['/league2', leagueTwoTeamName]]) {
    await page.goto(`${prefix}/my-team`, { waitUntil: 'networkidle' });
    await page.reload({ waitUntil: 'networkidle' });
    const cards = page.locator('article:has([data-matchup-toggle])');
    if (await cards.count()) {
      await expect(cards).toHaveCount(1);
      await expect(cards.locator('[data-team-name]').first()).toHaveText(teamName);
    } else {
      await expect(page.getByText(new RegExp(`${teamName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')} has no posted Week`, 'u'))).toBeVisible();
    }
    const afterReload = await page.evaluate((keys) => keys.map(key => localStorage.getItem(key)),
      [`league-one:my-team:${LEAGUE_IDS.league1}`, `league-one:my-team:${LEAGUE_IDS.league2}`]);
    expect(afterReload).toEqual(stored);
  }
});
