# Release validation

Use this record for every production change. A local build, GitHub push, or successful Vercel deployment is only one part of release validation; record all applicable evidence before reporting a release complete.

## Required evidence

| Gate | Evidence to record |
| --- | --- |
| Source revision | Pull request and final commit on `main`. |
| Deterministic verification | Successful `verify` job covering ESLint, Next.js route generation, strict TypeScript, Vitest, and the production build. |
| Browser smoke verification | Successful `browser-smoke` job covering the defining browser journeys in Chromium. |
| Preview | Vercel preview address tied to the proposed commit, plus manual checks of behavior affected by the change. |
| Production | Production deployment tied to the merged commit and a successful check of [www.league1fantasy.com](https://www.league1fantasy.com). |
| Configuration | `apps/site` Root Directory, Node.js 24, pnpm 11.19.0 through Corepack, and the canonical league registry shipped from `apps/site/lib/config.ts` without Vercel league-ID overrides. |

The automated browser suite checks matchup expansion and accessible score information, document fit at 360, 390, 430, and 1280 pixels, 52px player rows when lineups are available, primary touch targets, My Team persistence after reload, transaction presentation and filtering when data permits, and the not-found route back to Owners. It consumes public Sleeper data. A test records an explicit annotation when an upstream empty state makes a data-dependent measurement inapplicable.

Run it locally after installing Chromium once:

```sh
pnpm --filter @l1/site exec playwright install chromium
pnpm test:browser
```

Without `BASE_URL`, Playwright builds the site and starts the local Next.js production server. To exercise an already-deployed preview, set `BASE_URL` to that preview address before running `pnpm test:browser`. A protected preview must be made accessible to the test runner through the normal Vercel access mechanism; do not place bypass credentials in the repository.

## Current production baseline

Before this review change, production was based on commit [`e15ef17`](https://github.com/clawmachinejed/league-one-audit/commit/e15ef17677ea18c08e2ea99ae5e499a6e401a46d). [GitHub verification run 33532262074](https://github.com/clawmachinejed/league-one-audit/actions/runs/33532262074) passed the then-current lint, type, 88-test Vitest, and production-build gate. The automated Playwright job was introduced after that baseline, so it must be verified on the new pull request rather than attributed retroactively.

The original mobile-first rebuild remains documented in [pull request #136](https://github.com/clawmachinejed/league-one-audit/pull/136). Its preview and 30-test result are historical evidence for that earlier revision, not proof of current production behavior.

## Production checklist

- Confirm the Vercel deployment identifies the merged commit.
- Open the production domain through a fresh browser session and verify there is no parking-page redirect.
- Confirm Matchups, Standings, Owners, one owner roster, and one owner transaction page load the intended league.
- Open the league selector and confirm League One stays on root routes while League 2 stays under `/league2` across Matchups, Standings, Owners, roster, and transaction navigation.
- Confirm League One and League 2 each match the canonical registry in `apps/site/lib/config.ts`, with no roster, matchup, or transaction data crossing between them.
- Expand a matchup and inspect player-row fit on a phone-sized viewport.
- Select My Team, reload, and confirm the same team remains selected.
- Select different My Team choices in the two leagues and confirm each choice returns after switching and reloading.
- Check that transaction result labels, colors, movements, and FAAB values are readable when transactions exist.
- Record any Sleeper outage, missing schedule, empty transaction history, protected-preview limitation, or other condition that prevented a check.

For rollback, revert through a pull request and apply this same validation to the resulting deployment. Do not reset or force-push `main`.
