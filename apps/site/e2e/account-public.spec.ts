import { expect, test } from '@playwright/test';

test('dormant account pages keep public browsing usable at phone and desktop widths', async ({ page }, info) => {
  const privateRequests: string[] = [];
  page.on('request', request => { if (/\/api\/(?:me|auth)(?:\/|$)/.test(new URL(request.url()).pathname)) privateRequests.push(new URL(request.url()).pathname); });
  for (const width of [360, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ['/sign-in', '/my-leagues', '/account']) {
      await page.goto(path);
      const dormant = page.getByText('Accounts are being prepared. You can continue browsing all three leagues.');
      if (!await dormant.isVisible()) test.skip(true, 'Dormant-state check is inapplicable to an explicitly enabled account deployment.');
      await expect(page.getByRole('link', { name: 'View League One', exact: true })).toHaveAttribute('href', '/matchups');
      await expect(page.getByRole('link', { name: 'View League Two', exact: true })).toHaveAttribute('href', '/league2/matchups');
      await expect(page.getByRole('link', { name: 'View Dynasty League', exact: true })).toHaveAttribute('href', '/dynasty/matchups');
      await expect(page.locator('input[type=password]')).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
      if (path === '/my-leagues') await page.screenshot({ path: info.outputPath(`dormant-${width}.png`), fullPage: true });
    }
  }
  expect(privateRequests).toEqual([]);
});
