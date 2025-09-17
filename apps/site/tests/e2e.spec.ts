// apps/site/tests/e2e.spec.ts
import { test, expect } from "@playwright/test";
import { ERROR_COPY } from "@l1/contracts";

// Ensure sitemap/rss are up
test("sitemap.xml & rss.xml return 200", async ({ request }) => {
  expect((await request.get("/sitemap.xml")).status()).toBe(200);
  expect((await request.get("/rss.xml")).status()).toBe(200);
});

// Assert LIVE badge appears during ET live window by mocking time to Sunday 8:00 PM ET
test("LIVE badge visible during live window", async ({ page }) => {
  await page.addInitScript(() => {
    // Sunday, Sept 15 2024 20:00:00 -04:00 (within Sunday window 12:30 PM → 12:15 AM)
    const fakeNow = Date.parse("2024-09-15T20:00:00-04:00");
    // @ts-ignore
    const OriginalDate = Date;
    // @ts-ignore
    class MockDate extends Date {
      constructor(...args: any[]) {
        if (args.length === 0) super(fakeNow);
        else super(...(args as any));
      }
      static now() {
        return fakeNow;
      }
      static UTC = OriginalDate.UTC;
      static parse = OriginalDate.parse;
    }
    // @ts-ignore
    window.Date = MockDate;
    // Keep performance.now stable enough; not required but helps
  });
  await page.goto("/");
  await expect(page.getByText("LIVE").first()).toBeVisible();
});

// Snapshot error-copy strings from contracts to ensure presence & stability
test("error copy strings present & stable", async () => {
  expect(ERROR_COPY.scoresUnavailable).toBe(
    "Scores temporarily unavailable — retrying",
  );
  expect(ERROR_COPY.leagueConfigIssue).toBe(
    "League configuration issue — check SLEEPER_LEAGUE_ID.",
  );
  expect(ERROR_COPY.weekNotAvailable).toBe(
    "Week not available yet — standings and history are up-to-date.",
  );
  expect(ERROR_COPY.ownerUnavailable).toBe("(Owner unavailable)");
  expect(ERROR_COPY.couldntCompute).toBe(
    "Couldn’t compute this section right now.",
  );
});
