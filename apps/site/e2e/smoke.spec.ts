import { expect, test, type Locator, type Page } from '@playwright/test';
import { LEAGUE_IDS } from '../lib/config';

const viewports = [
  { name: 'small phone', width: 360, height: 800 },
  { name: 'iPhone width', width: 390, height: 844 },
  { name: 'large phone', width: 430, height: 932 },
  { name: 'desktop', width: 1280, height: 900 },
] as const;

const standingsViewports = [
  { name: 'minimum supported width', width: 320, height: 800 },
  { name: 'iPhone width', width: 390, height: 844 },
  { name: 'wide mobile', width: 504, height: 932 },
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
        for (const label of ['Matchups', 'League', 'Managers']) {
          await expectTouchHeight(page.getByRole('navigation', { name: 'Mobile navigation' }).getByRole('link', { name: label }));
        }
      }

      const toggle = page.locator('button[data-matchup-toggle]').first();
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

test('both standings pages reuse the Matchups title and season layout', async ({ page }) => {
  for (const viewport of [viewports[1], viewports[3]]) {
    await test.step(viewport.name, async () => {
      await page.setViewportSize(viewport);
      await page.goto('/matchups', { waitUntil: 'networkidle' });
      const matchupsIntro = page.locator('[data-page-intro]');
      await expect(matchupsIntro.getByRole('heading', { level: 1, name: 'Matchups' })).toBeVisible();
      const reference = await matchupsIntro.evaluate(element => {
        const main = element.closest('main')!;
        const heading = element.querySelector('h1')!;
        const season = element.querySelector('p')!;
        const toolbar = element.parentElement!;
        const content = main.querySelector('[class*="board"]');
        const introRect = element.getBoundingClientRect();
        const contentRect = content?.getBoundingClientRect();
        const read = (node: Element) => {
          const style = getComputedStyle(node);
          return {
            fontSize: style.fontSize,
            fontWeight: style.fontWeight,
            lineHeight: style.lineHeight,
            letterSpacing: style.letterSpacing,
          };
        };
        const mainStyle = getComputedStyle(main);
        return {
          mainPadding: [mainStyle.paddingTop, mainStyle.paddingRight, mainStyle.paddingBottom, mainStyle.paddingLeft],
          introTop: introRect.top,
          hasContent: Boolean(content),
          contentGap: main.querySelector('.data-warning') || !contentRect ? null : contentRect.top - introRect.bottom,
          toolbarMarginBottom: getComputedStyle(toolbar).marginBottom,
          contentMarginTop: content ? getComputedStyle(content).marginTop : null,
          heading: read(heading),
          season: { ...read(season), color: getComputedStyle(season).color, textTransform: getComputedStyle(season).textTransform },
          titleSeasonGap: season.getBoundingClientRect().top - heading.getBoundingClientRect().bottom,
        };
      });
      if (!reference.hasContent) {
        test.info().annotations.push({
          type: 'Sleeper data',
          description: 'No matchup board was available, so content-spacing measurements were not applicable.',
        });
      }

      for (const route of ['/standings', '/league2/standings']) {
        await page.goto(route, { waitUntil: 'networkidle' });
        const main = page.locator('main');
        const intro = main.locator('[data-page-intro]');
        await expect(intro.getByRole('heading', { level: 1, name: 'League' })).toBeVisible();
        await expect(intro.locator(':scope > h1')).toHaveText('League');
        await expect(intro.locator(':scope > p')).toHaveText('2026 season');
        await expect(main.getByText('The league, at a glance.', { exact: true })).toHaveCount(0);
        await expect(main.getByText('Standings table', { exact: true })).toHaveCount(0);
        await expect(main.getByText('Waiver table', { exact: true })).toHaveCount(0);
        await expect(main.getByLabel('Matchup week')).toHaveCount(0);
        await expect(main.getByRole('button', { name: /refresh/i })).toHaveCount(0);
        await expect(main.locator('select:visible')).toHaveCount(0);

        const actual = await intro.evaluate(element => {
          const mainElement = element.closest('main')!;
          const heading = element.querySelector('h1')!;
          const season = element.querySelector('p')!;
          const toolbar = element.parentElement!;
          const content = mainElement.querySelector('.standings-view-tabs')!;
          const introRect = element.getBoundingClientRect();
          const contentRect = content.getBoundingClientRect();
          const read = (node: Element) => {
            const style = getComputedStyle(node);
            return {
              fontSize: style.fontSize,
              fontWeight: style.fontWeight,
              lineHeight: style.lineHeight,
              letterSpacing: style.letterSpacing,
            };
          };
          const mainStyle = getComputedStyle(mainElement);
          return {
            mainPadding: [mainStyle.paddingTop, mainStyle.paddingRight, mainStyle.paddingBottom, mainStyle.paddingLeft],
            introTop: introRect.top,
            contentGap: mainElement.querySelector('.data-warning') ? null : contentRect.top - introRect.bottom,
            toolbarMarginBottom: getComputedStyle(toolbar).marginBottom,
            contentMarginTop: getComputedStyle(content).marginTop,
            heading: read(heading),
            season: { ...read(season), color: getComputedStyle(season).color, textTransform: getComputedStyle(season).textTransform },
            titleSeasonGap: season.getBoundingClientRect().top - heading.getBoundingClientRect().bottom,
          };
        });
        expect(actual.mainPadding).toEqual(reference.mainPadding);
        expect(actual.heading).toEqual(reference.heading);
        expect(actual.season).toEqual(reference.season);
        expect(actual.toolbarMarginBottom).toBe(reference.toolbarMarginBottom);
        if (reference.contentMarginTop !== null) {
          expect(actual.contentMarginTop).toBe(reference.contentMarginTop);
        }
        expect(actual.titleSeasonGap).toBe(reference.titleSeasonGap);
        expect(Math.abs(actual.introTop - reference.introTop)).toBeLessThanOrEqual(1);
        if (actual.contentGap !== null && reference.contentGap !== null) {
          expect(Math.abs(actual.contentGap - reference.contentGap)).toBeLessThanOrEqual(1);
        }
        await expectNoPageOverflow(page);

        const managerLink = main.locator(`a[href^="${route.startsWith('/league2') ? '/league2' : ''}/managers/"]`).first();
        if (await managerLink.count()) await expect(managerLink).toBeVisible();
      }
    });
  }
});

test('both standings views share a compact five-column grid at every supported width', async ({ page }) => {
  for (const viewport of standingsViewports) {
    await test.step(viewport.name, async () => {
      await page.setViewportSize(viewport);
      for (const route of ['/standings', '/league2/standings']) {
        await page.goto(route, { waitUntil: 'networkidle' });
        const table = page.locator('.standings-table');
        const standingsTab = page.getByRole('tab', { name: 'Standings' });
        const waiversTab = page.getByRole('tab', { name: 'Waivers' });
        await expect(standingsTab).toHaveAttribute('aria-selected', 'true');
        await expect(waiversTab).toHaveAttribute('aria-selected', 'false');
        await expect(page.getByText('Standings table', { exact: true })).toHaveCount(0);
        await expect(table).toBeVisible();
        await expect(table).toHaveAttribute('data-view', 'standings');
        await expect(table.locator('.standings-sort-label')).toHaveText(['Rank', 'Team', 'W–L', 'PF', 'PA']);
        await expect(table.locator('tbody tr')).toHaveCount(12);
        await expect(table.getByRole('columnheader', { name: 'PA' })).toBeVisible();
        await expect(table.locator('.manager-meta .avatar')).toHaveCount(12);
        await expect(table.getByText('GB', { exact: true })).toHaveCount(0);

        const layout = async () => table.evaluate(element => {
          const rows = [...element.querySelectorAll<HTMLTableRowElement>('tbody tr')];
          const row = rows[0];
          const team = row.querySelector<HTMLElement>('.team-name')!;
          const manager = row.querySelector<HTMLElement>('.manager-name')!;
          const avatar = row.querySelector<HTMLElement>('.manager-meta .avatar')!;
          const teamLink = row.querySelector<HTMLAnchorElement>('.standings-team')!;
          const teamCell = row.querySelector<HTMLElement>('.team-cell')!;
          const metricCells = [...row.querySelectorAll<HTMLElement>('.metric-cell')];
          const rankCell = row.querySelector<HTMLElement>('.rank-cell')!;
          const headers = [...element.querySelectorAll<HTMLElement>('thead th')];
          return {
            rowHeights: [...new Set(rows.map(item => item.getBoundingClientRect().height))],
            linkHeight: teamLink.getBoundingClientRect().height,
            teamAlign: getComputedStyle(team).textAlign,
            managerAlign: getComputedStyle(manager).textAlign,
            managerBelowTeam: manager.getBoundingClientRect().top >= team.getBoundingClientRect().bottom,
            avatarBesideManager: Math.abs((avatar.getBoundingClientRect().top + avatar.getBoundingClientRect().bottom) / 2
              - (manager.getBoundingClientRect().top + manager.getBoundingClientRect().bottom) / 2) <= 1
              && avatar.getBoundingClientRect().right <= manager.getBoundingClientRect().left,
            avatarSize: [avatar.getBoundingClientRect().width, avatar.getBoundingClientRect().height],
            rankWeights: rows.map(item => getComputedStyle(item.querySelector<HTMLElement>('.rank-cell span')!).fontWeight),
            rankAlign: getComputedStyle(rankCell).textAlign,
            metricAlignments: metricCells.map(cell => getComputedStyle(cell).textAlign),
            noCollision: team.getBoundingClientRect().right <= metricCells[0].getBoundingClientRect().left,
            fullNamesAccessible: rows.every(item => {
              const name = item.querySelector<HTMLElement>('.team-name')!.textContent!.trim();
              return item.querySelector<HTMLAnchorElement>('.standings-team')!.ariaLabel?.includes(name);
            }),
            headingsUntruncated: headers.every(header => {
              const label = header.querySelector<HTMLElement>('.standings-sort-label')!;
              return label.scrollWidth <= label.clientWidth;
            }),
            columns: headers.map(header => ({ left: header.getBoundingClientRect().left, width: header.getBoundingClientRect().width })),
            visibleHeaders: headers.filter(header => getComputedStyle(header).display !== 'none').length,
            teamCellWidth: teamCell.getBoundingClientRect().width,
          };
        });
        const standingsLayout = await layout();
        expect(standingsLayout.visibleHeaders).toBe(5);
        expect(standingsLayout.teamAlign).toBe('left');
        expect(standingsLayout.managerAlign).toBe('left');
        expect(standingsLayout.managerBelowTeam).toBe(true);
        expect(standingsLayout.avatarBesideManager).toBe(true);
        expect(standingsLayout.avatarSize).toEqual([14, 14]);
        expect(standingsLayout.rankWeights.every(weight => Number(weight) === 400)).toBe(true);
        expect(standingsLayout.rankAlign).toBe('center');
        expect(standingsLayout.metricAlignments.every(alignment => alignment === 'center')).toBe(true);
        expect(standingsLayout.noCollision).toBe(true);
        expect(standingsLayout.fullNamesAccessible).toBe(true);
        expect(standingsLayout.headingsUntruncated).toBe(true);
        expect(standingsLayout.linkHeight).toBeGreaterThanOrEqual(Math.min(...standingsLayout.rowHeights) - 1);
        const standingsPoints = await table.locator('tbody tr').evaluateAll(rows => rows.map(row => ({
          pf: row.querySelector<HTMLElement>('.points-cell:nth-last-child(2)')?.textContent?.trim(),
          pa: row.querySelector<HTMLElement>('.points-cell:last-child')?.textContent?.trim(),
        })));
        expect(standingsPoints.every(({ pf, pa }) => pf !== '0.00' && pa !== '0.00')).toBe(true);
        if (viewport.width < 760) {
          expect(Math.min(...standingsLayout.rowHeights)).toBeGreaterThanOrEqual(44);
          expect(Math.max(...standingsLayout.rowHeights)).toBeLessThanOrEqual(48);
        } else {
          expect(Math.min(...standingsLayout.rowHeights)).toBeGreaterThanOrEqual(50);
          expect(Math.max(...standingsLayout.rowHeights)).toBeLessThanOrEqual(54);
        }
        await expect(page.getByText('PF = points for · PA = points against', { exact: true })).toBeVisible();

        const beforeSwitch = page.url();
        await waiversTab.click();
        await expect(page).toHaveURL(beforeSwitch);
        await expect(table).toHaveAttribute('data-view', 'waivers');
        await expect(page.getByText('Waiver table', { exact: true })).toHaveCount(0);
        await expect(table.locator('.standings-sort-label')).toHaveText(['Rank', 'Team', 'W–L', 'Order', '$']);
        await expect(table.getByText('GB', { exact: true })).toHaveCount(0);
        await expect(table.locator('.manager-meta .avatar')).toHaveCount(12);
        await expect(table.getByRole('columnheader', { name: 'Order' })).toHaveAttribute('aria-sort', 'ascending');
        const waiverLayout = await layout();
        expect(waiverLayout.columns).toEqual(standingsLayout.columns);
        expect(waiverLayout.rowHeights).toEqual(standingsLayout.rowHeights);
        expect(waiverLayout.teamCellWidth).toBe(standingsLayout.teamCellWidth);
        expect(waiverLayout.rankAlign).toBe('center');
        expect(waiverLayout.metricAlignments.every(alignment => alignment === 'center')).toBe(true);
        expect(waiverLayout.noCollision).toBe(true);
        expect(waiverLayout.avatarBesideManager).toBe(true);
        expect(waiverLayout.avatarSize).toEqual([14, 14]);
        expect(waiverLayout.rankWeights.every(weight => Number(weight) === 400)).toBe(true);
        expect(waiverLayout.headingsUntruncated).toBe(true);
        const waiverValues = (await table.locator('tbody .budget-cell').allTextContents()).map(value => value.trim());
        const orderValues = (await table.locator('tbody .order-cell').allTextContents()).map(value => value.trim());
        for (const value of waiverValues) expect(value).toMatch(/^(?:—|\$-?\d+)$/u);
        for (const value of orderValues) expect(value).toMatch(/^(?:—|\d+)$/u);
        const numericOrders = orderValues.filter(value => value !== '—').map(Number);
        expect(numericOrders).toEqual([...numericOrders].sort((a, b) => a - b));
        expect(orderValues.slice(numericOrders.length).every(value => value === '—')).toBe(true);
        const prefix = route.startsWith('/league2') ? '/league2' : '';
        const managerHrefs = await table.locator('.standings-team').evaluateAll(links => links.map(link => link.getAttribute('href')));
        expect(managerHrefs).toHaveLength(12);
        for (const href of managerHrefs) expect(href).toMatch(new RegExp(`^${prefix}/managers/\\d+$`, 'u'));
        await expect(page.getByText('Order = current waiver claim priority · $ = budget remaining', { exact: true })).toBeVisible();
        await expectNoPageOverflow(page);
      }
    });
  }
});

test('Standings and Waivers switch locally, support keyboard tabs, and retain independent sorts', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto('/standings', { waitUntil: 'networkidle' });
  const url = page.url();
  const requests: string[] = [];
  const recordRequest = (request: { url: () => string }) => requests.push(request.url());
  page.on('request', recordRequest);
  const standingsTab = page.getByRole('tab', { name: 'Standings' });
  const waiversTab = page.getByRole('tab', { name: 'Waivers' });
  await standingsTab.focus();
  await standingsTab.press('ArrowRight');
  await expect(waiversTab).toBeFocused();
  await expect(waiversTab).toHaveAttribute('aria-selected', 'true');
  await waiversTab.press('ArrowLeft');
  await expect(standingsTab).toBeFocused();
  await expect(standingsTab).toHaveAttribute('aria-selected', 'true');
  await page.waitForTimeout(100);
  page.off('request', recordRequest);
  expect(page.url()).toBe(url);
  expect(requests).toEqual([]);

  const table = page.locator('.standings-table');
  const originalRanks = new Map(await table.locator('tbody tr').evaluateAll(rows => rows.map(row => [
    row.querySelector('.standings-team')!.getAttribute('href')!,
    row.querySelector('.rank-cell')!.textContent!.trim(),
  ])));
  await page.getByRole('button', { name: 'Sort by Team' }).click();
  await expect(table.getByRole('columnheader', { name: 'Team' })).toHaveAttribute('aria-sort', 'ascending');
  const sortedNames = await table.locator('.team-name').allTextContents();
  expect(sortedNames).toEqual([...sortedNames].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })));
  const sortedRanks = new Map(await table.locator('tbody tr').evaluateAll(rows => rows.map(row => [
    row.querySelector('.standings-team')!.getAttribute('href')!,
    row.querySelector('.rank-cell')!.textContent!.trim(),
  ])));
  expect(sortedRanks).toEqual(originalRanks);

  await waiversTab.click();
  await expect(table.getByRole('columnheader', { name: 'Order' })).toHaveAttribute('aria-sort', 'ascending');
  await expect(table.getByRole('columnheader', { name: 'Team' })).toHaveAttribute('aria-sort', 'none');
  await page.getByRole('button', { name: 'Sort by $' }).click();
  await expect(table.getByRole('columnheader', { name: '$' })).toHaveAttribute('aria-sort', 'descending');
  await standingsTab.click();
  await expect(table.getByRole('columnheader', { name: 'Team' })).toHaveAttribute('aria-sort', 'ascending');

  const syntheticName = 'A synthetic team name that is intentionally far too long for the narrow standings column';
  const firstRow = table.locator('tbody tr').first();
  await firstRow.locator('.team-name').evaluate((element, value) => { element.textContent = value; }, syntheticName);
  await firstRow.locator('.standings-team').evaluate((element, value) => element.setAttribute('aria-label', `${value}, managed by Test Manager`), syntheticName);
  const truncation = await firstRow.evaluate(row => {
    const name = row.querySelector<HTMLElement>('.team-name')!;
    const metric = row.querySelector<HTMLElement>('.metric-cell')!;
    return {
      truncated: name.scrollWidth > name.clientWidth,
      noCollision: name.getBoundingClientRect().right <= metric.getBoundingClientRect().left,
      fullName: name.textContent,
      accessibleName: row.querySelector<HTMLAnchorElement>('.standings-team')!.ariaLabel,
    };
  });
  expect(truncation).toEqual({ truncated: true, noCollision: true, fullName: syntheticName, accessibleName: `${syntheticName}, managed by Test Manager` });
  await expectNoPageOverflow(page);
});

test('Rosters stays in League, is exact-week cached, accessible, and responsive', async ({ page }) => {
  const requests: string[] = [];
  const currentWeeks = new Map<string, number>();
  await page.route('**/api/transactions/*', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ league: { season: '2026', week: 3, maxWeek: 18, rosterPositions: [] }, activities: [], updatedAt: '2026-09-08T12:00:00.000Z' }),
  }));
  await page.route('**/api/rosters/*?week=*', async route => {
    const url = new URL(route.request().url());
    const leagueKey = url.pathname.split('/').at(-1)!;
    const week = Number(url.searchParams.get('week'));
    if (!currentWeeks.has(leagueKey)) currentWeeks.set(leagueKey, week);
    const currentWeek = currentWeeks.get(leagueKey)!;
    requests.push(`${leagueKey}:${week}`);
    const available = week !== 18;
    const current = week === currentWeek;
    const playerName = leagueKey === 'league1'
      ? 'An Exceptionally Long League One Quarterback Name'
      : 'League Two Quarterback';
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        league: { season: '2026', rosterPositions: ['QB', 'BN'], week: 3, maxWeek: 18 },
        week, currentWeek, rostersAvailable: available, updatedAt: '2026-09-08T12:00:00.000Z',
        warning: available ? undefined : 'Sleeper has not established complete lineups for this future week.',
        teams: [{
          id: 1, name: `${leagueKey} First Place`, managerName: `${leagueKey} Manager One`, avatar: null,
          wins: 7, losses: 1, ties: 0, pointsFor: 900, pointsAgainst: 700,
          waiverOrder: null, waiverBudgetRemaining: null, standingsRank: 1,
          averagePpg: 115.2, averagePpgRank: 1, rosterAvailable: available,
          sections: available ? [{ name: 'Starters', players: [{
            id: 'qb-1', name: playerName, position: 'QB', nflTeam: 'IND',
            injuryStatus: current ? 'Questionable' : null, slot: 'QB', byeWeek: 12,
            game: current ? { kind: 'scheduled', opponent: 'HOU', location: 'home', date: '2026-09-13', kickoffAt: '2026-09-13T17:00:00.000Z' } : null,
          }] }, { name: 'Bench', players: [] }] : [],
        }, {
          id: 2, name: `${leagueKey} My Very Long Team Name`, managerName: 'A Very Long Manager Name', avatar: null,
          wins: 6, losses: 2, ties: 0, pointsFor: 850, pointsAgainst: 710,
          waiverOrder: null, waiverBudgetRemaining: null, standingsRank: 2,
          averagePpg: 109.4, averagePpgRank: 2, rosterAvailable: available,
          sections: available ? [{ name: 'Starters', players: [{
            id: 'qb-2', name: 'My Quarterback', position: 'QB', nflTeam: null,
            injuryStatus: null, slot: 'SUPER_FLEX', byeWeek: null, game: null,
          }] }, { name: 'Bench', players: [] }] : [],
        }],
      }),
    });
  });

  for (const viewport of standingsViewports) {
    await page.setViewportSize(viewport);
    for (const route of ['/standings', '/league2/standings']) {
      const leagueKey = route.startsWith('/league2') ? 'league2' : 'league1';
      const prefix = leagueKey === 'league2' ? '/league2' : '';
      const storageLeagueId = leagueKey === 'league2' ? LEAGUE_IDS.league2 : LEAGUE_IDS.league1;
      const selectedId = leagueKey === 'league2' ? '1' : '2';
      await page.goto(`${prefix}/matchups`, { waitUntil: 'networkidle' });
      const matchupToggle = page.locator('[data-matchup-toggle]').first();
      const matchupHeight = await matchupToggle.count() ? (await matchupToggle.boundingBox())?.height ?? null : null;
      await page.goto(route, { waitUntil: 'networkidle' });
      await page.evaluate(({ key, selected }) => localStorage.setItem(key, selected), {
        key: `league-one:my-team:${storageLeagueId}`, selected: selectedId,
      });
      await page.reload({ waitUntil: 'networkidle' });
      const initialUrl = page.url();
      const tabs = page.getByRole('tablist', { name: 'Standings views' });
      await expect(tabs.getByRole('tab')).toHaveText(['Standings', 'Waivers', 'Transactions', 'Rosters']);
      await expect(tabs.getByRole('tab', { name: 'Standings' })).toHaveAttribute('aria-selected', 'true');

      const before = requests.length;
      await tabs.getByRole('tab', { name: 'Rosters' }).click();
      await expect(page).toHaveURL(initialUrl);
      await expect(page.getByText('Loading the league…')).toHaveCount(0);
      const currentWeek = await page.getByLabel('Roster week').inputValue();
      await expect(page.getByLabel('Roster week').locator('option:checked')).toContainText('Current');
      await expect(page.locator('[data-team-headings]')).toHaveText(/TEAM\s*RECORD\s*AVG PPG/u);
      await expect(page.locator('[data-team-headings]')).toHaveCount(1);
      const cards = page.locator('[data-roster-card]');
      await expect(cards).toHaveCount(2);
      await expect(cards.first()).toHaveAttribute('data-team-id', selectedId);
      await expect(cards.first()).toHaveAttribute('data-standings-rank', selectedId);
      await expect(cards.nth(1)).toHaveAttribute('data-team-id', selectedId === '1' ? '2' : '1');
      await expect(cards.first()).toContainText(selectedId === '1' ? `${leagueKey} First Place` : `${leagueKey} My Very Long Team Name`);
      await expect(cards.first()).not.toContainText(`${leagueKey === 'league1' ? 'league2' : 'league1'} My Very Long Team Name`);
      const toggle = cards.first().locator('[data-roster-toggle]');
      await expectTouchHeight(toggle);
      await expect(cards.locator('[data-roster-toggle][aria-expanded="true"]')).toHaveCount(0);
      await expect(cards.locator('[data-roster-toggle][aria-expanded="false"]')).toHaveCount(2);
      if (matchupHeight !== null) {
        const ordinaryRosterHeight = (await page.locator('[data-roster-card][data-team-id="1"] [data-roster-toggle]').boundingBox())!.height;
        expect(ordinaryRosterHeight).toBeLessThanOrEqual(matchupHeight + 1);
      }
      await expect(toggle).toHaveAccessibleName(/My Team/iu);
      await expect(toggle).toContainText(selectedId === '1'
        ? /7–1\s*1st\s*115\.2\s*1st/u : /6–2\s*2nd\s*109\.4\s*2nd/u);
      await expect(toggle).not.toContainText(/standings|average position|rank/iu);
      const panel = cards.first().locator('[data-roster-content]');
      await expect(panel).toBeHidden();
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      await panel.locator('[data-roster-player]').first().click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      await expect(panel.locator('[data-roster-section]').first()).toContainText('BYE');
      await expect(panel).not.toContainText(/actual|projected|player ppg|position rank|time remaining/iu);

      const scheduledCard = page.locator('[data-roster-card][data-team-id="1"]');
      const scheduledToggle = scheduledCard.locator('[data-roster-toggle]');
      if (await scheduledToggle.getAttribute('aria-expanded') !== 'true') await scheduledToggle.click();
      const scheduledPanel = scheduledCard.locator('[data-roster-content]');
      await expect(scheduledPanel).toContainText('QUES');
      await expect(scheduledPanel).toContainText('Sun 1:00 PM vs HOU');
      await expect(scheduledPanel.locator('[data-roster-player]').first()).toContainText('12');

      const otherToggle = cards.nth(1).locator('[data-roster-toggle]');
      if (await otherToggle.getAttribute('aria-expanded') !== 'true') await otherToggle.click();
      await expect(cards.locator('[data-roster-toggle][aria-expanded="true"]')).toHaveCount(2);
      if (viewport.width === 320) {
        const longName = page.locator('[data-roster-card][data-team-id="2"] [data-roster-toggle] strong').first();
        const wrapping = await longName.evaluate(element => {
          const style = getComputedStyle(element);
          return { whiteSpace: style.whiteSpace, textOverflow: style.textOverflow, height: element.getBoundingClientRect().height, lineHeight: Number.parseFloat(style.lineHeight) };
        });
        expect(wrapping.whiteSpace).toBe('normal');
        expect(wrapping.textOverflow).not.toBe('ellipsis');
        expect(wrapping.height).toBeGreaterThan(wrapping.lineHeight);
      }
      await expectNoPageOverflow(page);
      expect(requests.slice(before)).toEqual([`${leagueKey}:${currentWeek}`]);

      for (const tabName of ['Standings', 'Waivers', 'Transactions']) {
        await tabs.getByRole('tab', { name: tabName, exact: true }).click();
        await tabs.getByRole('tab', { name: 'Rosters', exact: true }).click();
        await expect(cards.locator('[data-roster-toggle][aria-expanded="true"]')).toHaveCount(2);
        expect(requests.slice(before)).toEqual([`${leagueKey}:${currentWeek}`]);
      }

      const secondaryWeek = currentWeek === '1' ? '2' : '1';
      await page.getByLabel('Roster week').selectOption(secondaryWeek);
      await expect(page.locator('[data-roster-card]').first()).toBeVisible();
      await expect(page.locator('[data-roster-toggle][aria-expanded="true"]')).toHaveCount(0);
      await expect(page.locator('[data-roster-content]').first()).not.toContainText('Questionable');
      await expect(page.locator('[data-roster-section]')).toHaveCount(4);
      expect(requests.slice(before)).toEqual([`${leagueKey}:${currentWeek}`, `${leagueKey}:${secondaryWeek}`]);

      await page.getByLabel('Roster week').selectOption(currentWeek);
      await expect(page.locator('[data-roster-card]').first()).toBeVisible();
      await expect(page.locator('[data-roster-toggle][aria-expanded="true"]')).toHaveCount(0);
      expect(requests.slice(before)).toEqual([`${leagueKey}:${currentWeek}`, `${leagueKey}:${secondaryWeek}`]);

      await page.getByLabel('Roster week').selectOption('18');
      await expect(page.getByRole('heading', { name: 'Week 18 rosters unavailable' })).toBeVisible();
      await expect(page.locator('[data-roster-card]')).toHaveCount(0);
      expect(requests.slice(before)).toEqual([`${leagueKey}:${currentWeek}`, `${leagueKey}:${secondaryWeek}`, `${leagueKey}:18`]);
      await expectNoPageOverflow(page);
    }
  }
  expect(await page.evaluate(({ one, two }) => [localStorage.getItem(one), localStorage.getItem(two)], {
    one: `league-one:my-team:${LEAGUE_IDS.league1}`,
    two: `league-one:my-team:${LEAGUE_IDS.league2}`,
  })).toEqual(['2', '1']);
});

test('league Transactions loads once, filters locally, groups bids compactly, and remains league-isolated', async ({ page }) => {
  const payload = (league: 'league1' | 'league2') => ({
    league: { season: '2026', week: 1, maxWeek: 18, rosterPositions: [] },
    updatedAt: '2026-09-09T12:30:00.000Z',
    activities: [
      {
        kind: 'waiver', id: `${league}:waiver:p1:2026-09-09`, timestamp: '2026-09-09T12:00:00.000Z',
        processedAt: '2026-09-09T12:00:00.000Z', day: '2026-09-09',
        player: { id: 'p1', name: `${league} Waiver Player`, position: 'WR', nflTeam: 'IND' },
        winners: [{ id: 'winner', team: `${league} Winning Team`, added: [{ id: 'p1', name: `${league} Waiver Player`, position: 'WR', nflTeam: 'IND' }], dropped: [] }],
        claims: [
          { id: 'winner', team: `${league} Winning Team`, bid: 0, result: 'Won' },
          { id: 'loser-high', team: 'A losing team with an intentionally very long name', bid: 9, result: 'Lost' },
          { id: 'loser-low', team: 'Another Team', bid: 3, result: 'Lost' },
        ],
      },
      {
        kind: 'add_drop', id: `${league}-move`, timestamp: '2026-09-08T12:00:00.000Z', title: `${league} Move Team`,
        type: 'Free agent', result: 'Complete', lines: [{ label: 'Added', text: 'Player Two (RB · SEA)' }],
      },
      {
        kind: 'trade', id: `${league}-trade`, timestamp: '2026-09-07T12:00:00.000Z', title: 'Trade Completed',
        result: 'Complete', participants: [
          { id: 1, team: `${league} Alpha`, receives: [
            { type: 'Player', text: 'Player Three (TE · BUF)' },
            { type: 'Pick', text: '2027 Round 2' },
          ] },
          { id: 2, team: `${league} Beta`, receives: [{ type: 'FAAB', text: '$10' }] },
        ],
      },
    ],
  });
  const requests: string[] = [];
  await page.route('**/api/transactions/*', async route => {
    const key = new URL(route.request().url()).pathname.split('/').at(-1) as 'league1' | 'league2';
    requests.push(key);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload(key)) });
  });

  for (const route of ['/standings', '/league2/standings']) {
    const league = route.startsWith('/league2') ? 'league2' : 'league1';
    await page.goto(route, { waitUntil: 'networkidle' });
    const url = page.url();
    const viewTabs = page.getByRole('tablist', { name: 'Standings views' });
    const mainTabs = viewTabs.getByRole('tab');
    await expect(mainTabs).toHaveText(['Standings', 'Waivers', 'Transactions', 'Rosters']);
    await expect(mainTabs.nth(0)).toHaveAttribute('aria-selected', 'true');
    expect(requests.filter(key => key === league)).toHaveLength(0);
    const panelGap = async () => page.locator('.standings-view-panel:visible').evaluate(panel =>
      panel.getBoundingClientRect().top - document.querySelector<HTMLElement>('.standings-view-tabs')!.getBoundingClientRect().bottom);
    const standingsGap = await panelGap();
    await viewTabs.getByRole('tab', { name: 'Waivers' }).click();
    expect(Math.abs(await panelGap() - standingsGap)).toBeLessThanOrEqual(1);

    const transactionsTab = viewTabs.getByRole('tab', { name: 'Transactions' });
    await transactionsTab.click();
    await expect(page).toHaveURL(url);
    await expect(page.getByRole('heading', { name: 'League Activity', exact: true })).toBeVisible();
    expect(Math.abs(await panelGap() - standingsGap)).toBeLessThanOrEqual(1);
    await expect(page.locator('.waiver-card .transaction-movement-rows')).toContainText(`${league} Waiver Player`);
    await expect(page.locator('.waiver-card .transaction-movement-rows')).not.toContainText(`${league === 'league1' ? 'league2' : 'league1'} Waiver Player`);
    await expect(page.getByText('3 reported bids', { exact: false })).toBeVisible();
    const bidRows = page.locator('.waiver-bid-row');
    await expect(bidRows).toHaveCount(3);
    await expect(bidRows.nth(0)).toContainText('Won');
    await expect(bidRows.nth(0)).toContainText('$0');
    await expect(bidRows.nth(1)).toContainText('Lost');
    await expect(bidRows.nth(1)).toHaveClass(/result-negative/u);
    await expect(page.getByText('Pending', { exact: true })).toHaveCount(0);
    const bidLayout = await bidRows.evaluateAll(rows => rows.map(row => {
      const style = getComputedStyle(row);
      return { borderTop: style.borderTopWidth, borderBottom: style.borderBottomWidth, height: row.getBoundingClientRect().height };
    }));
    expect(bidLayout.every(row => row.borderTop === '0px' && row.borderBottom === '0px')).toBe(true);
    expect(bidLayout.every(row => row.height <= 28)).toBe(true);
    expect(await bidRows.locator('.transaction-date').count()).toBe(0);
    await expect(page.locator('.waiver-card .transaction-date')).toHaveCount(1);
    await expect(page.locator('.league-activity-card .result-badge')).toHaveCount(0);
    await expect(page.locator('.waiver-card .transaction-title-row')).toContainText(`${league} Winning Team`);
    await expect(page.locator('.waiver-card .transaction-title-row')).toContainText('Waiver');
    await expect(page.locator('.waiver-card .transaction-movement-rows')).not.toContainText(`${league} Winning Team`);

    const beforeFilters = requests.length;
    const filterTabs = page.getByRole('tablist', { name: 'Transaction filters' });
    await filterTabs.getByRole('tab', { name: 'Adds & Drops' }).click();
    await expect(page.locator('.league-activity-card')).toHaveCount(1);
    await expect(page.locator('.league-activity-card')).toHaveAttribute('data-kind', 'add_drop');
    await expect(page.locator('.league-activity-card .transaction-title-row')).toContainText(`${league} Move Team`);
    await expect(page.locator('.league-activity-card .transaction-title-row')).toContainText('Free agent');
    await expect(page.locator('.league-activity-card .transaction-lines')).not.toContainText(`${league} Move Team`);
    await filterTabs.getByRole('tab', { name: 'Waivers' }).click();
    await expect(page.locator('.league-activity-card')).toHaveAttribute('data-kind', 'waiver');
    await filterTabs.getByRole('tab', { name: 'Trades' }).click();
    await expect(page.locator('.league-activity-card')).toHaveAttribute('data-kind', 'trade');
    await expect(page.locator('.trade-card .transaction-type')).toHaveText('Trade Completed');
    await expect(page.getByRole('heading', { name: `${league} Alpha receives`, exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: `${league} Beta receives`, exact: true })).toBeVisible();
    await expect(page.getByText('Player Three (TE · BUF)', { exact: true })).toHaveCount(1);
    await expect(page.getByText('2027 Round 2', { exact: true })).toHaveCount(1);
    await expect(page.getByText('$10', { exact: true })).toHaveCount(1);
    const tradeHeaderDivider = await page.locator('.trade-card .transaction-header').evaluate(header => getComputedStyle(header).borderBottomWidth);
    expect(tradeHeaderDivider).toBe('0px');
    expect(requests).toHaveLength(beforeFilters);

    await viewTabs.getByRole('tab', { name: 'Standings' }).click();
    await viewTabs.getByRole('tab', { name: 'Waivers' }).click();
    await transactionsTab.click();
    await expect(page.locator('.trade-card .transaction-type')).toHaveText('Trade Completed');
    expect(requests.filter(key => key === league)).toHaveLength(1);
    await expectNoPageOverflow(page);
  }
  expect(requests).toEqual(['league1', 'league2']);
});

test('league Transactions remains usable without overflow at every supported width', async ({ page }) => {
  await page.route('**/api/transactions/*', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      league: { season: '2026', week: 1, maxWeek: 18, rosterPositions: [] }, updatedAt: '2026-09-09T12:30:00.000Z',
      activities: [
        {
          kind: 'waiver', id: 'league1:waiver:p1:2026-09-09', timestamp: '2026-09-09T12:00:00.000Z', processedAt: '2026-09-09T12:00:00.000Z', day: '2026-09-09',
          player: { id: 'p1', name: 'An exceptionally long player name that must wrap without colliding', position: 'WR', nflTeam: 'IND' },
          winners: [{
            id: 'win', team: 'An exceptionally long winning fantasy team name',
            added: [
              { id: 'p1', name: 'An exceptionally long player name that must wrap without colliding', position: 'WR', nflTeam: 'IND' },
              { id: 'p2', name: 'Green Bay Packers', position: 'DEF', nflTeam: 'GB' },
            ],
            dropped: [{ id: 'p3', name: 'Tank Bigsby', position: 'RB', nflTeam: 'PHI' }],
          }],
          claims: [{ id: 'win', team: 'An exceptionally long winning fantasy team name', bid: 12, result: 'Won' }, { id: 'loss', team: 'An exceptionally long losing fantasy team name', bid: null, result: 'Lost' }],
        },
        {
          kind: 'add_drop', id: 'long-move', timestamp: '2026-09-08T12:00:00.000Z', title: 'An exceptionally long add and drop team name that must wrap safely',
          type: 'Free agent', result: 'Complete',
          lines: [
            { label: 'Added', text: 'An exceptionally long added player name (WR · GB), Green Bay Packers (DEF · GB)' },
            { label: 'Dropped', text: 'Tank Bigsby (RB · PHI)' },
          ],
        },
        {
          kind: 'trade', id: 'long-trade', timestamp: '2026-09-07T12:00:00.000Z', title: 'Trade Completed', result: 'Complete',
          participants: [
            { id: 1, team: 'An exceptionally long first trade team name', receives: [{ type: 'Player', text: 'An exceptionally long received player name (TE · BUF)' }, { type: 'Pick', text: '2028 Round 1' }] },
            { id: 2, team: 'An exceptionally long second trade team name', receives: [{ type: 'FAAB', text: '$27' }] },
          ],
        },
      ],
    }),
  }));
  for (const viewport of standingsViewports) {
    await page.setViewportSize(viewport);
    for (const route of ['/standings', '/league2/standings']) {
      await page.goto(route, { waitUntil: 'networkidle' });
      const viewTabs = page.getByRole('tablist', { name: 'Standings views' });
      const panelGap = async () => page.locator('.standings-view-panel:visible').evaluate(panel =>
        panel.getBoundingClientRect().top - document.querySelector<HTMLElement>('.standings-view-tabs')!.getBoundingClientRect().bottom);
      const standingsGap = await panelGap();
      await viewTabs.getByRole('tab', { name: 'Waivers' }).click();
      expect(Math.abs(await panelGap() - standingsGap)).toBeLessThanOrEqual(1);
      await viewTabs.getByRole('tab', { name: 'Transactions' }).click();
      await expect(page.getByRole('heading', { name: 'League Activity', exact: true })).toBeVisible();
      expect(Math.abs(await panelGap() - standingsGap)).toBeLessThanOrEqual(1);
      await expect(page.locator('.league-activity-card .result-badge')).toHaveCount(0);
      const movementCards = page.locator('.league-activity-card[data-kind="waiver"], .league-activity-card[data-kind="add_drop"]');
      await expect(movementCards).toHaveCount(2);
      const movementLayout = await movementCards.evaluateAll(cards => cards.map(card => {
        const cardRect = card.getBoundingClientRect();
        const body = card.querySelector<HTMLElement>('.transaction-body')!;
        const list = card.querySelector<HTMLElement>('.transaction-movement-rows')!;
        const rows = [...list.children] as HTMLElement[];
        const firstLabel = rows[0].querySelector<HTMLElement>('dt')!;
        const firstContent = rows[0].querySelector<HTMLElement>('dd')!;
        const bodyStyle = getComputedStyle(body);
        const listStyle = getComputedStyle(list);
        const rowStyle = getComputedStyle(rows[0]);
        return {
          bodyPadding: [bodyStyle.paddingTop, bodyStyle.paddingRight, bodyStyle.paddingBottom, bodyStyle.paddingLeft],
          columns: rowStyle.gridTemplateColumns,
          columnGap: rowStyle.columnGap,
          rowGap: listStyle.rowGap,
          alignItems: rowStyle.alignItems,
          lineHeight: getComputedStyle(firstContent).lineHeight,
          labelLeft: Math.round(firstLabel.getBoundingClientRect().left - cardRect.left),
          contentLeft: Math.round(firstContent.getBoundingClientRect().left - cardRect.left),
          verticalGap: Math.round(rows[1].getBoundingClientRect().top - rows[0].getBoundingClientRect().bottom),
        };
      }));
      expect(movementLayout).toHaveLength(2);
      expect(movementLayout[1]).toEqual(movementLayout[0]);
      const commonSpacing = await page.locator('.league-activity-card').evaluateAll(cards => cards.map(card => {
        const header = card.querySelector<HTMLElement>('.transaction-header')!;
        const body = card.querySelector<HTMLElement>('.transaction-body')!;
        const date = header.querySelector<HTMLElement>('.transaction-date')!;
        const titleBlock = date.previousElementSibling as HTMLElement;
        const headerStyle = getComputedStyle(header);
        const bodyStyle = getComputedStyle(body);
        return {
          headerPadding: [headerStyle.paddingTop, headerStyle.paddingRight, headerStyle.paddingBottom, headerStyle.paddingLeft],
          bodyPadding: [bodyStyle.paddingTop, bodyStyle.paddingRight, bodyStyle.paddingBottom, bodyStyle.paddingLeft],
          titleDateGap: Math.round(date.getBoundingClientRect().top - titleBlock.getBoundingClientRect().bottom),
        };
      }));
      expect(commonSpacing).toHaveLength(3);
      expect(commonSpacing.every(spacing => spacing.headerPadding.join() === commonSpacing[0].headerPadding.join())).toBe(true);
      expect(commonSpacing.every(spacing => spacing.bodyPadding.join() === commonSpacing[0].bodyPadding.join())).toBe(true);
      expect(commonSpacing.every(spacing => spacing.titleDateGap === commonSpacing[0].titleDateGap)).toBe(true);
      expect(commonSpacing[0].headerPadding).toEqual(['7px', '10px', '6px', '10px']);
      expect(commonSpacing[0].bodyPadding).toEqual(['7px', '10px', '8px', '10px']);
      expect(await page.locator('.league-transactions-list').evaluate(list => getComputedStyle(list).rowGap)).toBe('8px');
      const movementTypography = await page.locator('.transaction-movement-rows').evaluateAll(lists => lists.map(list => ({
        names: [...list.querySelectorAll('.transaction-movement-player-name')].map(node => getComputedStyle(node).fontWeight),
        details: [...list.querySelectorAll('.transaction-movement-player-details')].map(node => getComputedStyle(node).fontWeight),
        separators: [...list.querySelectorAll('.transaction-movement-separator')].map(node => getComputedStyle(node).fontWeight),
      })));
      expect(movementTypography.every(row => row.names.every(weight => Number(weight) >= 600))).toBe(true);
      expect(movementTypography.every(row => row.details.every(weight => Number(weight) === 400))).toBe(true);
      expect(movementTypography.every(row => row.separators.every(weight => Number(weight) === 400))).toBe(true);
      const tradeSections = page.locator('.trade-receiver');
      await expect(tradeSections).toHaveCount(2);
      const tradeLayout = await tradeSections.evaluateAll(sections => sections.map(section => {
        const rect = section.getBoundingClientRect();
        const style = getComputedStyle(section);
        return { left: rect.left, top: rect.top, borderLeft: style.borderLeftWidth, borderTop: style.borderTopWidth };
      }));
      if (viewport.width >= 760) {
        expect(tradeLayout[1].left).toBeGreaterThan(tradeLayout[0].left);
        expect(tradeLayout[1].borderLeft).toBe('1px');
        expect(tradeLayout[1].borderTop).toBe('0px');
      } else {
        expect(tradeLayout[1].top).toBeGreaterThan(tradeLayout[0].top);
        expect(tradeLayout[1].borderLeft).toBe('0px');
        expect(tradeLayout[1].borderTop).toBe('1px');
      }
      await expectNoPageOverflow(page);
      for (const tab of await page.getByRole('tablist', { name: 'Transaction filters' }).getByRole('tab').all()) await expectTouchHeight(tab);
      if (viewport.width < 760) await expect(page.getByRole('navigation', { name: 'Mobile navigation' })).toBeVisible();
    }
  }
});

test('league Transactions total failure stays inline while Standings remains usable', async ({ page }) => {
  await page.route('**/api/transactions/*', route => route.fulfill({
    status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'League transaction history is temporarily unavailable. Please try again.' }),
  }));
  await page.goto('/standings', { waitUntil: 'networkidle' });
  const viewTabs = page.getByRole('tablist', { name: 'Standings views' });
  await viewTabs.getByRole('tab', { name: 'Transactions' }).click();
  await expect(page.getByRole('heading', { name: 'League transactions unavailable' })).toBeVisible();
  await expect(page.getByText('Loading the league…')).toHaveCount(0);
  await viewTabs.getByRole('tab', { name: 'Standings' }).click();
  await expect(page.locator('.standings-table')).toBeVisible();
});

test('My Team standings highlighting remains isolated by league and survives reloads', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/standings', { waitUntil: 'networkidle' });
  const leagueOneTeamId = await page.locator('.standings-table tbody tr').nth(1).locator('.standings-team')
    .getAttribute('href').then(href => href?.split('/').at(-1));
  expect(leagueOneTeamId).toBeTruthy();
  await page.evaluate(({ key, id }) => localStorage.setItem(key, id), {
    key: `league-one:my-team:${LEAGUE_IDS.league1}`,
    id: leagueOneTeamId!,
  });
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.locator('.standings-table .selected-row')).toHaveCount(1);
  await expect(page.locator('.standings-table .selected-row .standings-team'))
    .toHaveAttribute('href', `/managers/${leagueOneTeamId}`);
  await expect(page.locator('.standings-table .selected-row .my-team-label')).toContainText('MY TEAM');

  await page.goto('/league2/standings', { waitUntil: 'networkidle' });
  const leagueTwoTeamId = await page.locator('.standings-table tbody tr').nth(2).locator('.standings-team')
    .getAttribute('href').then(href => href?.split('/').at(-1));
  expect(leagueTwoTeamId).toBeTruthy();
  await page.evaluate(({ key, id }) => localStorage.setItem(key, id), {
    key: `league-one:my-team:${LEAGUE_IDS.league2}`,
    id: leagueTwoTeamId!,
  });
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.locator('.standings-table .selected-row .standings-team'))
    .toHaveAttribute('href', `/league2/managers/${leagueTwoTeamId}`);

  await page.goto('/standings', { waitUntil: 'networkidle' });
  await expect(page.locator('.standings-table .selected-row .standings-team'))
    .toHaveAttribute('href', `/managers/${leagueOneTeamId}`);
});

test('both Managers pages reuse the Matchups intro without matchup controls', async ({ page }) => {
  for (const viewport of [viewports[1], viewports[3]]) {
    await test.step(viewport.name, async () => {
      await page.setViewportSize(viewport);
      await page.goto('/matchups', { waitUntil: 'networkidle' });
      const matchupsIntro = page.locator('[data-page-intro]');
      const reference = await matchupsIntro.evaluate(element => {
        const main = element.closest('main')!;
        const heading = element.querySelector('h1')!;
        const season = element.querySelector('p')!;
        const toolbar = element.parentElement!;
        const content = main.querySelector('[class*="board"]');
        const introRect = element.getBoundingClientRect();
        const contentRect = content?.getBoundingClientRect();
        const read = (node: Element) => {
          const style = getComputedStyle(node);
          return {
            fontSize: style.fontSize,
            fontWeight: style.fontWeight,
            lineHeight: style.lineHeight,
            letterSpacing: style.letterSpacing,
          };
        };
        const mainStyle = getComputedStyle(main);
        return {
          mainPadding: [mainStyle.paddingTop, mainStyle.paddingRight, mainStyle.paddingBottom, mainStyle.paddingLeft],
          introTop: introRect.top,
          contentGap: main.querySelector('.data-warning') || !contentRect ? null : contentRect.top - introRect.bottom,
          toolbarMarginBottom: getComputedStyle(toolbar).marginBottom,
          heading: read(heading),
          season: { ...read(season), color: getComputedStyle(season).color, textTransform: getComputedStyle(season).textTransform },
          titleSeasonGap: season.getBoundingClientRect().top - heading.getBoundingClientRect().bottom,
        };
      });

      for (const route of ['/managers', '/league2/managers']) {
        await page.goto(route, { waitUntil: 'networkidle' });
        const main = page.locator('main');
        const intro = main.locator('[data-page-intro]');
        await expect(intro.locator(':scope > h1')).toHaveText('Managers');
        await expect(intro.locator(':scope > p')).toHaveText('2026 season');
        expect(await intro.locator(':scope > *').allTextContents()).toEqual(['Managers', '2026 season']);
        await expect(main.getByText(/The people and teams of/u)).toHaveCount(0);
        await expect(main.getByLabel('Matchup week')).toHaveCount(0);
        await expect(main.getByRole('button', { name: 'Refresh matchups' })).toHaveCount(0);
        await expect(main.locator('select')).toHaveCount(0);

        const actual = await intro.evaluate(element => {
          const mainElement = element.closest('main')!;
          const heading = element.querySelector('h1')!;
          const season = element.querySelector('p')!;
          const toolbar = element.parentElement!;
          const content = mainElement.querySelector('.preference-banner')!;
          const introRect = element.getBoundingClientRect();
          const toolbarRect = toolbar.getBoundingClientRect();
          const contentRect = content.getBoundingClientRect();
          const read = (node: Element) => {
            const style = getComputedStyle(node);
            return {
              fontSize: style.fontSize,
              fontWeight: style.fontWeight,
              lineHeight: style.lineHeight,
              letterSpacing: style.letterSpacing,
            };
          };
          const mainStyle = getComputedStyle(mainElement);
          return {
            mainPadding: [mainStyle.paddingTop, mainStyle.paddingRight, mainStyle.paddingBottom, mainStyle.paddingLeft],
            introTop: introRect.top,
            contentGap: mainElement.querySelector('.data-warning') ? null : contentRect.top - introRect.bottom,
            contentAlignment: [contentRect.left - toolbarRect.left, toolbarRect.right - contentRect.right],
            toolbarMarginBottom: getComputedStyle(toolbar).marginBottom,
            heading: read(heading),
            season: { ...read(season), color: getComputedStyle(season).color, textTransform: getComputedStyle(season).textTransform },
            titleSeasonGap: season.getBoundingClientRect().top - heading.getBoundingClientRect().bottom,
          };
        });
        expect(actual.mainPadding).toEqual(reference.mainPadding);
        expect(actual.heading).toEqual(reference.heading);
        expect(actual.season).toEqual(reference.season);
        expect(actual.toolbarMarginBottom).toBe(reference.toolbarMarginBottom);
        expect(actual.titleSeasonGap).toBe(reference.titleSeasonGap);
        expect(actual.contentAlignment).toEqual([0, 0]);
        expect(Math.abs(actual.introTop - reference.introTop)).toBeLessThanOrEqual(1);
        if (actual.contentGap !== null && reference.contentGap !== null) {
          expect(Math.abs(actual.contentGap - reference.contentGap)).toBeLessThanOrEqual(1);
        }
        await expectNoPageOverflow(page);

        const prefix = route.startsWith('/league2') ? '/league2' : '';
        const managerLinks = main.locator(`a[href^="${prefix}/managers/"]`);
        const teamCountText = await main.locator('.section-label > span').textContent();
        const teamCount = Number(teamCountText?.match(/^\d+/u)?.[0]);
        expect(teamCount).toBeGreaterThan(0);
        await expect(managerLinks).toHaveCount(teamCount);
        for (const href of await managerLinks.evaluateAll(links => links.map(link => link.getAttribute('href')))) {
          expect(href).toMatch(new RegExp(`^${prefix}/managers/\\d+$`, 'u'));
        }
      }
    });
  }
});

test('a matchup exposes scores to assistive technology and expands from the keyboard', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/matchups', { waitUntil: 'networkidle' });
  const toggle = page.locator('button[data-matchup-toggle]').first();
  test.skip((await toggle.count()) === 0, 'Sleeper has not posted matchup cards for the selected week.');

  const scores = (await toggle.locator('[data-score-number]').allTextContents()).map(score => score.trim());
  expect(scores).toHaveLength(2);
  for (const score of scores) {
    await expect(toggle).toHaveAccessibleName(score === '—' ? /score unavailable/i : new RegExp(escapeRegExp(score)));
  }
  const projections = (await toggle.locator('[data-team-projection-number]').allTextContents()).map(score => score.trim());
  expect(projections).toHaveLength(2);
  const toggleName = await toggle.getAttribute('aria-label');
  expect(toggleName).toMatch(/managed by/i);
  expect(toggleName).not.toMatch(/owned by/i);
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

  const toggles = page.locator('button[data-matchup-toggle]');
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
  await page.goto('/managers', { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });

  const selectButton = page.locator('.my-team-button').first();
  test.skip((await selectButton.count()) === 0, 'Sleeper has not returned any manager cards.');

  await expect(selectButton).toHaveAttribute('aria-pressed', 'false');
  await selectButton.click();
  await expect(selectButton).toHaveAttribute('aria-pressed', 'true');

  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.locator('button[aria-pressed="true"]')).toHaveCount(1);
  await expect(page.getByText('Saved in this browser. Highlighted across the league.')).toBeVisible();
});

test('manager transactions remain readable and filtering works when available', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/managers', { waitUntil: 'networkidle' });
  const managerLink = page.locator('a[href^="/managers/"]').first();
  test.skip((await managerLink.count()) === 0, 'Sleeper has not returned any manager cards.');
  await managerLink.click();
  await expect(page).toHaveURL(/\/managers\/\d+$/);
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

test('the not-found page offers a usable route back to Managers', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/this-page-does-not-exist', { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
  const backLink = page.getByRole('link', { name: 'Back to managers' });
  await expectTouchHeight(backLink);
  await backLink.click();
  await expect(page).toHaveURL(/\/managers$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Managers' })).toBeVisible();
});

test('League Two not-found pages return to League Two Managers', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  const response = await page.goto('/league2/this-page-does-not-exist', { waitUntil: 'networkidle' });
  expect(response?.status()).toBe(404);
  await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
  const backLink = page.getByRole('link', { name: 'Back to managers' });
  await expectTouchHeight(backLink);
  await backLink.click();
  await expect(page).toHaveURL(/\/league2\/managers$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Managers' })).toBeVisible();
});

test('former participant routes return 404 and are never redirected', async ({ request }) => {
  const removedRoutes = [
    '/owners',
    '/owners/1',
    '/owners/1/transactions',
    '/league2/owners',
    '/league2/owners/1',
    '/league2/owners/1/transactions',
  ];

  for (const route of removedRoutes) {
    const response = await request.get(route, { maxRedirects: 0 });
    expect(response.status(), `${route} should not remain routable`).toBe(404);
    expect(response.headers().location, `${route} should not redirect`).toBeUndefined();
    expect(new URL(response.url()).pathname).toBe(route);
  }
});
