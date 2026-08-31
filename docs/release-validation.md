# Pre-merge validation — August 31, 2026

This record covers the mobile-first rebuild's preview at commit [`2953ef1`](https://github.com/clawmachinejed/league-one-audit/commit/2953ef1). It records pre-merge checks, not production verification.

| Evidence | Result |
| --- | --- |
| [Pull request #136](https://github.com/clawmachinejed/league-one-audit/pull/136) | Rebuild review and checks. |
| [Vercel preview](https://leagueonefantasy-git-codex-mobi-67b912-robert-finchums-projects.vercel.app) | Deployment succeeded for `2953ef1`. This branch address can move to later revisions. |
| [GitHub verification run 33404911733](https://github.com/clawmachinejed/league-one-audit/actions/runs/33404911733) | Passed lint, type checks, all 30 unit tests, and the production build. |
| Expanded matchups and Owners | Browser checks completed at widths of 360, 390, 430, and 1280 pixels. |
| My Team preference | Selected team persisted after reloading the browser. |

The existing Vercel project was confirmed linked to this repository, with production branch `main`, Root Directory `apps/site`, and access to files outside that root enabled. Saved build settings use Node.js 24, `pnpm build`, the default Next.js output directory, and a frozen dependency installation. `SLEEPER_LEAGUE_ID=1378850182409490432` is configured for All Environments; `ENABLE_EXPERIMENTAL_COREPACK=1` is configured for Preview and Production.

After merge, check the resulting production revision in the [Vercel project overview](https://vercel.com/robert-finchums-projects/league_one_fantasy) and verify the relevant journeys on [www.league1fantasy.com](https://www.league1fantasy.com). The preview checks above do not establish that production has been tested.
