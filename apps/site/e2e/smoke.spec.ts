import { expect, test, type Locator, type Page } from '@playwright/test';

const viewports = [
  { name: 'small phone', width: 360, height: 800 },
  { name: 'iPhone width', width: 390, height: 844 },
  { name: 'large phone', width: 430, height: 932 },
  { name: 'desktop', width: 1280, height: 900 },
] as const;

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

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

function relativeLuminance(color: string) {
  const match = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/iu.exec(color);
  if (!match) throw new Error(`Expected a six-digit hex color, received ${color}.`);
  const channels = match.slice(1).map(value => Number.parseInt(value, 16) / 255)
    .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrastRatio(foreground: string, background: string) {
  const lighter = Math.max(relativeLuminance(foreground), relativeLuminance(background));
  const darker = Math.min(relativeLuminance(foreground), relativeLuminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

test('the site follows the system color scheme while it is open', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/matchups', { waitUntil: 'networkidle' });

  const readTheme = () => page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const body = getComputedStyle(document.body);
    const header = getComputedStyle(document.querySelector<HTMLElement>('.site-header')!);
    const tokens = [
      '--paper', '--surface', '--ink', '--navy', '--muted', '--green', '--warning-bg', '--warning-ink',
      '--positive-bg', '--positive-ink', '--negative-bg', '--negative-ink', '--neutral-bg', '--neutral-ink',
      '--injury', '--questionable',
    ];
    return {
      darkPreference: matchMedia('(prefers-color-scheme: dark)').matches,
      colorScheme: root.colorScheme,
      bodyBackground: body.backgroundColor,
      bodyColor: body.color,
      headerBackground: header.backgroundColor,
      tokens: Object.fromEntries(tokens.map(token => [token, root.getPropertyValue(token).trim()])),
    };
  });

  const light = await readTheme();
  expect(light.darkPreference).toBe(false);
  expect(light.colorScheme).toBe('light');

  await page.emulateMedia({ colorScheme: 'dark' });
  const dark = await readTheme();
  expect(dark.darkPreference).toBe(true);
  expect(dark.colorScheme).toBe('dark');
  expect(dark.bodyBackground).not.toBe(light.bodyBackground);
  expect(dark.bodyColor).not.toBe(light.bodyColor);
  expect(dark.headerBackground).not.toBe(light.headerBackground);
  expect(dark.tokens['--paper']).not.toBe(light.tokens['--paper']);
  expect(dark.tokens['--surface']).not.toBe(light.tokens['--surface']);

  const readablePairs = [
    ['--ink', '--paper'],
    ['--ink', '--surface'],
    ['--muted', '--paper'],
    ['--muted', '--surface'],
    ['--green', '--paper'],
    ['--green', '--surface'],
    ['--warning-ink', '--warning-bg'],
    ['--positive-ink', '--positive-bg'],
    ['--negative-ink', '--negative-bg'],
    ['--neutral-ink', '--neutral-bg'],
    ['--injury', '--surface'],
    ['--questionable', '--surface'],
  ] as const;
  for (const [foreground, background] of readablePairs) {
    expect(
      contrastRatio(dark.tokens[foreground], dark.tokens[background]),
      `${foreground} should remain readable against ${background} in dark mode`,
    ).toBeGreaterThanOrEqual(4.5);
  }

  const themeColors = await page.locator('meta[name="theme-color"]').evaluateAll(elements => elements.map(element => ({
    color: element.getAttribute('content'),
    media: element.getAttribute('media'),
  })));
  expect(themeColors).toEqual(expect.arrayContaining([
    { color: '#f6f5f0', media: '(prefers-color-scheme: light)' },
    { color: '#0e1511', media: '(prefers-color-scheme: dark)' },
  ]));
  await expectNoPageOverflow(page);

  await page.emulateMedia({ colorScheme: 'light' });
  expect(await readTheme()).toEqual(light);
});

test('matchups fit supported widths and expanded lineup rows remain 52px', async ({ page }) => {
  for (const viewport of viewports) {
    await test.step(viewport.name, async () => {
      await page.setViewportSize(viewport);
      await page.goto('/matchups', { waitUntil: 'networkidle' });
      await expect(page.getByRole('heading', { level: 1, name: 'Matchups' })).toBeVisible();
      await expectNoPageOverflow(page);

      await expectTouchHeight(page.getByRole('button', { name: /refresh matchups/i }));
      await expectTouchHeight(page.getByLabel('Matchup week'));

      if (viewport.width < 760) {
        for (const label of ['Matchups', 'Standings', 'Owners']) {
          await expectTouchHeight(page.getByRole('navigation', { name: 'Mobile navigation' }).getByRole('link', { name: label }));
        }
      }

      const toggle = page.locator('button[aria-controls]').first();
      if ((await toggle.count()) === 0) {
        test.info().annotations.push({
          type: 'Sleeper data',
          description: 'No matchup cards were available, so expanded-row measurements were not applicable.',
        });
        await expect(page.getByText(/No matchups posted|could not be loaded|unavailable/i).first()).toBeVisible();
        return;
      }

      await expectTouchHeight(toggle);
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      await expectNoPageOverflow(page);

      const panelId = await toggle.getAttribute('aria-controls');
      expect(panelId).toBeTruthy();
      const heights = await page.locator(`#${panelId} [data-player-name]`).evaluateAll(nodes => {
        const rows = new Set<Element>();
        for (const node of nodes) {
          const row = node.closest('div[class*="playerRow"]');
          if (row) rows.add(row);
        }
        return [...rows].map(row => row.getBoundingClientRect().height);
      });

      if (heights.length === 0) {
        test.info().annotations.push({
          type: 'Sleeper data',
          description: 'Starting lineups were not posted, so the fixed-height row assertion was not applicable.',
        });
      } else {
        for (const height of heights) expect(height).toBeCloseTo(52, 0);
      }
    });
  }
});

test('a matchup exposes scores to assistive technology and expands from the keyboard', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/matchups', { waitUntil: 'networkidle' });
  const toggle = page.locator('button[aria-controls]').first();
  test.skip((await toggle.count()) === 0, 'Sleeper has not posted matchup cards for the selected week.');

  const scores = (await toggle.locator('[data-score-number]').allTextContents()).map(score => score.trim());
  expect(scores).toHaveLength(2);
  for (const score of scores) {
    await expect(toggle).toHaveAccessibleName(score === '—' ? /score unavailable/i : new RegExp(escapeRegExp(score)));
  }
  const projections = (await toggle.locator('[data-team-projection-number]').allTextContents()).map(score => score.trim());
  expect(projections).toHaveLength(2);
  const toggleName = await toggle.getAttribute('aria-label');
  expect(toggleName?.match(/projected score/gi)).toHaveLength(2);
  for (const projection of projections) {
    expect(projection).toMatch(/^(?:—|-?\d+\.\d{2})$/u);
    await expect(toggle).toHaveAccessibleName(projection === '—'
      ? /projected score unavailable/i
      : new RegExp(`projected score ${escapeRegExp(projection)}`));
  }

  const teamAlignment = await toggle.locator('[data-score-side]').evaluateAll(stacks => stacks.map(stack => {
    const official = stack.querySelector<HTMLElement>('[data-score-number]')!.getBoundingClientRect();
    const projection = stack.querySelector<HTMLElement>('[data-team-projection-number]')!.getBoundingClientRect();
    return stack.getAttribute('data-score-side') === 'left'
      ? Math.abs(official.right - projection.right)
      : Math.abs(official.left - projection.left);
  }));
  for (const difference of teamAlignment) expect(difference).toBeLessThanOrEqual(1);

  const panelId = await toggle.getAttribute('aria-controls');
  expect(panelId).toBeTruthy();
  const panel = page.locator(`#${panelId}`);
  await expect(panel).toBeHidden();
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(panel).toBeVisible();

  const playerProjections = panel.locator('[data-player-projection-number]');
  if ((await playerProjections.count()) > 0) {
    const playerScoreGroups = panel.locator('[data-player-score-side]');
    for (let index = 0; index < await playerScoreGroups.count(); index += 1) {
      const projection = (await playerScoreGroups.nth(index).locator('[data-player-projection-number]').textContent())?.trim() ?? '';
      expect(projection).toMatch(/^(?:—|-?\d+\.\d{2})$/u);
      await expect(playerScoreGroups.nth(index)).toHaveAccessibleName(projection === '—'
        ? /official score .*; projected score unavailable/i
        : new RegExp(`official score .*; projected score ${escapeRegExp(projection)}`, 'i'));
    }
    const playerAlignment = await panel.locator('[data-player-score-side]').evaluateAll(stacks => stacks.map(stack => {
      const official = stack.querySelector<HTMLElement>('[data-player-score-number]')!.getBoundingClientRect();
      const projection = stack.querySelector<HTMLElement>('[data-player-projection-number]')!.getBoundingClientRect();
      return stack.getAttribute('data-player-score-side') === 'left'
        ? Math.abs(official.right - projection.right)
        : Math.abs(official.left - projection.left);
    }));
    for (const difference of playerAlignment) expect(difference).toBeLessThanOrEqual(1);
  }

  const toggles = page.locator('button[aria-controls]');
  if ((await toggles.count()) > 1) {
    const secondToggle = toggles.nth(1);
    await secondToggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(secondToggle).toHaveAttribute('aria-expanded', 'true');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(secondToggle).toHaveAttribute('aria-expanded', 'true');
  }
});

test('week navigation reaches the final week and returns to the prior week', async ({ page }) => {
  await page.goto('/matchups', { waitUntil: 'networkidle' });
  const weekSelect = page.getByLabel('Matchup week');

  await weekSelect.selectOption('18');
  await expect(page).toHaveURL(/\/matchups\?week=18$/);
  await expect(weekSelect).toHaveValue('18');
  await expect(page.getByRole('link', { name: /next week/i })).toHaveCount(0);

  await page.getByRole('link', { name: 'Previous week, week 17' }).click();
  await expect(page).toHaveURL(/\/matchups\?week=17$/);
  await expect(weekSelect).toHaveValue('17');
});

test('My Team remains selected after a reload', async ({ page }) => {
  await page.goto('/owners', { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });

  const selectButton = page.locator('.my-team-button').first();
  test.skip((await selectButton.count()) === 0, 'Sleeper has not returned any owner cards.');

  await expect(selectButton).toHaveAttribute('aria-pressed', 'false');
  await selectButton.click();
  await expect(selectButton).toHaveAttribute('aria-pressed', 'true');

  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.locator('button[aria-pressed="true"]')).toHaveCount(1);
  await expect(page.getByText('Saved in this browser. Highlighted across the league.')).toBeVisible();
});

test('owner transactions remain readable and filtering works when available', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/owners', { waitUntil: 'networkidle' });
  const ownerLink = page.locator('a[href^="/owners/"]').first();
  test.skip((await ownerLink.count()) === 0, 'Sleeper has not returned any owner cards.');
  await ownerLink.click();
  await expect(page).toHaveURL(/\/owners\/\d+$/);
  await page.getByRole('navigation', { name: 'Team pages' }).getByRole('link', { name: 'Transactions', exact: true }).click();

  await expect(page.getByRole('heading', { level: 2, name: 'Team activity' })).toBeVisible();
  await expectNoPageOverflow(page);

  const cards = page.locator('.transaction-card');
  if ((await cards.count()) === 0) {
    await expect(page.getByRole('heading', { name: /fresh season|no moves/i })).toBeVisible();
    return;
  }

  await expect(cards.first()).toBeVisible();
  await expect(cards.first().locator('.result-badge')).toBeVisible();

  const filter = page.getByLabel('Filter transaction type');
  if ((await filter.count()) > 0) {
    const values = await filter.locator('option').evaluateAll(options => options.map(option => (option as HTMLOptionElement).value));
    expect(values.length).toBeGreaterThan(2);
    await filter.selectOption(values[1]);
    await expect(cards.first()).toBeVisible();
    await filter.selectOption('all');
  }

  await expectNoPageOverflow(page);
});

test('the not-found page offers a usable route back to Owners', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/this-page-does-not-exist', { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
  const backLink = page.getByRole('link', { name: 'Back to owners' });
  await expectTouchHeight(backLink);
  await backLink.click();
  await expect(page).toHaveURL(/\/owners$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Owners' })).toBeVisible();
});
