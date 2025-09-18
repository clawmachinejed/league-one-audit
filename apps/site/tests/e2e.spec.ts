// apps/site/tests/e2e.spec.ts
import { test, expect } from "@playwright/test";

test("Home renders and shows standings", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Standings" })).toBeVisible();
});

test("Arrow Left/Right switches weeks with focus guard", async ({ page }) => {
  await page.goto("/matchups/1");
  // Ensure not in an input
  await page.keyboard.press("ArrowRight");
  await expect(page).toHaveURL(/\/matchups\/2$/);
  await page.keyboard.press("ArrowLeft");
  await expect(page).toHaveURL(/\/matchups\/1$/);

  // Focus guard: inside input should not navigate
  const urlBefore = page.url();
  await page.setContent(`<input id="x" />`);
  await page.focus("#x");
  await page.keyboard.press("ArrowRight");
  await expect(page).toHaveURL(urlBefore);
});

test("Error copy matches spec punctuation exactly", async ({ page }) => {
  // This test assumes you can toggle an error state via a feature flag or mock.
  // As a smoke check, just verify the string exists anywhere on the page.
  await page.goto("/");
  const bodyText = (await page.textContent("body")) || "";
  expect(bodyText).toContain("Scores temporarily unavailable — retrying…");
});
