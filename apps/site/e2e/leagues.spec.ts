import { expect, test, type Locator, type Page } from '@playwright/test';
import { LEAGUE_IDS } from '../lib/config';

const phoneWidths = [360, 390, 430] as const;

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

test('switching leagues changes identity, data routes, and every primary tab', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/matchups', { waitUntil: 'networkidle' });
  await expect(page.getByRole('link', { name: 'League One home' })).toBeVisible();

  await page.getByRole('navigation', { name: 'Mobile navigation' })
    .getByRole('button', { name: 'Choose league, current League One' }).click();
  await page.getByRole('link', { name: 'View League Two' }).click();

  await expect(page).toHaveURL(/\/league2\/matchups$/u);
  const leagueTwoHome = page.getByRole('link', { name: 'League Two home' });
  await expect(leagueTwoHome).toBeVisible();
  await expect(leagueTwoHome).toContainText('LEAGUE TWO.');
  await expect(page.getByRole('heading', { level: 1, name: 'Matchups' })).toBeVisible();

  const mobileNav = page.getByRole('navigation', { name: 'Mobile navigation' });
  await expect(mobileNav.getByRole('link', { name: 'Matchups' })).toHaveAttribute('href', '/league2/matchups');
  await expect(mobileNav.getByRole('link', { name: 'Standings' })).toHaveAttribute('href', '/league2/standings');
  await expect(mobileNav.getByRole('link', { name: 'Owners' })).toHaveAttribute('href', '/league2/owners');

  await mobileNav.getByRole('link', { name: 'Standings' }).click();
  await expect(page).toHaveURL(/\/league2\/standings$/u);
  await expect(page.getByRole('heading', { level: 1, name: 'Standings' })).toBeVisible();
  await expect(page.getByText('2026 season', { exact: true })).toBeVisible();

  await page.getByRole('navigation', { name: 'Mobile navigation' }).getByRole('link', { name: 'Owners' }).click();
  await expect(page).toHaveURL(/\/league2\/owners$/u);
  await expect(page.getByRole('heading', { level: 1, name: 'Owners' })).toBeVisible();
  await expect(page.getByText('The people and teams of League Two.')).toBeVisible();
  const ownerLink = page.locator('a[href^="/league2/owners/"]').first();
  if (await ownerLink.count()) await expect(ownerLink).toBeVisible();
  await expectNoPageOverflow(page);
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

test('My Team choices remain independent between League One and League Two', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/owners', { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });

  const leagueOneButton = page.locator('.my-team-button').first();
  test.skip((await leagueOneButton.count()) === 0, 'Sleeper has not returned League One owner cards.');
  await leagueOneButton.click();
  await expect(leagueOneButton).toHaveAttribute('aria-pressed', 'true');

  const mobileNav = page.getByRole('navigation', { name: 'Mobile navigation' });
  await mobileNav.getByRole('button', { name: 'Choose league, current League One' }).click();
  await page.getByRole('link', { name: 'View League Two' }).click();
  await expect(page).toHaveURL(/\/league2\/owners$/u);

  const leagueTwoButton = page.locator('.my-team-button').first();
  test.skip((await leagueTwoButton.count()) === 0, 'Sleeper has not returned League Two owner cards.');
  await expect(page.locator('button.my-team-button[aria-pressed="true"]')).toHaveCount(0);
  await leagueTwoButton.click();
  await expect(leagueTwoButton).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('navigation', { name: 'Mobile navigation' })
    .getByRole('button', { name: 'Choose league, current League Two' }).click();
  await page.getByRole('link', { name: 'View League One' }).click();
  await expect(page).toHaveURL(/\/owners$/u);
  await expect(page.locator('button.my-team-button[aria-pressed="true"]')).toHaveCount(1);

  const storedKeys = await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('league-one:my-team:')).sort());
  const expectedKeys = Object.values(LEAGUE_IDS).map(id => `league-one:my-team:${id}`).sort();
  expect(storedKeys).toEqual(expectedKeys);
});
