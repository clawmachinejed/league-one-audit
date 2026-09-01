# League One

A mobile-first home for League One, powered by public Sleeper league data. The site keeps the weekly experience focused: Matchups, Standings, and Owners, with rosters and transaction history inside each owner profile.

## What stays central

- Expandable matchup cards: scan team scores, then open the player and lineup comparison.
- Player projections derived from Tank01's raw weekly statistics using the league's Sleeper scoring settings.
- A persistent My Team selection, scoped to the league and validated against its current teams.
- Owner transaction history with adds, drops, trades, FAAB bids, and clearly labeled outcomes. Green, red, and muted result colors supplement the text.
- Phone layouts that fit the screen, keep names and scores readable, and provide comfortable touch controls.

The current league ID is `1378850182409490432`. Sleeper IDs must remain strings because they can exceed JavaScript's safe integer range. The default lives in `apps/site/lib/config.ts`; `SLEEPER_LEAGUE_ID` can override it. The site uses real data, shows empty states when appropriate, and reports unavailable or incomplete data without substituting demonstration teams or results.

History, rivalries, awards, a separate statistics section, and a separate schedule section are outside this rebuild's scope.

## Repository and hosting

| Service | Location |
| --- | --- |
| GitHub repository | [clawmachinejed/league-one-audit](https://github.com/clawmachinejed/league-one-audit) |
| Production branch | `main` |
| Vercel project | [league_one_fantasy overview](https://vercel.com/robert-finchums-projects/league_one_fantasy) |
| Production address | [www.league1fantasy.com](https://www.league1fantasy.com) |

The existing Vercel project is linked to this repository and deploys `main` from `apps/site`, with access to files outside that root enabled for the pnpm workspace. Use the Vercel project overview to check the current production deployment and revision. The [release validation guide](docs/release-validation.md) defines the evidence to record for each release. A release is complete only after its GitHub revision, successful deployment, and production behavior have been checked.

## Local development

Use Node.js 24 and pnpm 11.19.0, as specified in the root `package.json`. The workspace contains one application, `apps/site`.

Run these commands from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Open [localhost:3000](http://localhost:3000). No Sleeper API token is required for the public league data used here.

The built-in league default works without an environment file. To override it or enable projections locally, copy `.env.example` to `apps/site/.env.local`, then set the needed values there.

| Environment variable | Purpose |
| --- | --- |
| `SLEEPER_LEAGUE_ID` | Optional public league override; defaults to `1378850182409490432`. |
| `TANK01_API_KEY` | Private, server-only Tank01 credential used to load raw projection statistics. Keep it out of browser code, logs, and commits. |

Sleeper remains the official source for league identity, rosters, lineups, live scores, and scoring rules. The application computes projections locally from Tank01's raw weekly statistics by applying the active Sleeper scoring settings; Tank01 does not replace Sleeper's official or live results. Tank data is cached for one hour. If an available Tank01 slate omits a starter or has incomplete projected statistics for that starter, the site displays `0.00` and includes that zero in the team projection. Unsafe player-identity matches, invalid scoring settings, and Tank01 outages remain unavailable and display a dash.

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Start the development website. |
| `pnpm lint` | Check source quality with ESLint. |
| `pnpm typecheck` | Generate Next.js route types and check TypeScript. |
| `pnpm test` | Run the Vitest unit tests. |
| `pnpm test:browser` | Run Playwright smoke tests against a local server, or against `BASE_URL` when supplied. |
| `pnpm build` | Create the production build. |
| `pnpm start` | Run an existing production build locally. |
| `pnpm verify` | Run lint, type checks, unit tests, and the production build, stopping on failure. |

Install Playwright's Chromium browser once with `pnpm --filter @l1/site exec playwright install chromium`. With no `BASE_URL`, `pnpm test:browser` builds the site and starts the local production server automatically. Set `BASE_URL` to test an existing Vercel preview or production deployment instead.

`pnpm verify` remains the fast deterministic code gate. GitHub Actions runs it first for pull requests and pushes to `main`, then runs the separate Chromium smoke job. Keeping browser tests separate makes an upstream Sleeper or browser-installation problem distinguishable from a source, unit-test, or build failure.

## Code map

| Location | Responsibility |
| --- | --- |
| `apps/site/app` | Routes, metadata, loading, error, and not-found pages. |
| `apps/site/components` | Shared website views and browser interactions. |
| `apps/site/lib/config.ts` | League configuration. |
| `apps/site/lib/sleeper.ts` | Server-side Sleeper requests, caching, and data availability handling. |
| `apps/site/lib/transform.ts` | League, team, matchup, lineup, and transaction normalization. |
| `apps/site/lib/types.ts` | Shared application data contracts. |
| `apps/site/e2e` | Playwright browser smoke journeys. |
| `apps/site/playwright.config.ts` | Local-server and `BASE_URL` browser-test configuration. |
| `.github/workflows/verify.yml` | Pull request and main-branch verification. |

League data is cached to limit upstream requests; each feed's cache duration is defined beside its request in `apps/site/lib/sleeper.ts`. Matchup injury labels use Sleeper's current `injury_status`, including when viewing an earlier matchup week; they are not historical injury reports. Questionable is shown as QUES in golden yellow, other designations in red, and missing values remain blank. Displayed values can lag Sleeper. The site is a league companion: roster moves and fantasy league administration remain in Sleeper.

## Vercel setup

Use the existing Vercel project rather than creating a duplicate project or moving its domain without a request. These settings were configured and verified on August 31, 2026:

| Setting | Value |
| --- | --- |
| Git repository | `clawmachinejed/league-one-audit` |
| Production branch | `main` |
| Root Directory | `apps/site` |
| Include files outside Root Directory | Enabled, for the workspace configuration and lockfile |
| Framework | Next.js |
| Node.js version | 24.x |
| Package manager | pnpm 11.19.0, selected through Corepack and `packageManager` |
| Install command | `pnpm install --frozen-lockfile` using the repository workspace lockfile, with Corepack enabled |
| Build command | `pnpm build` from the configured application root |
| Output Directory | Next.js default, `.next` |
| `SLEEPER_LEAGUE_ID` | `1378850182409490432`, in Vercel Project Settings for Preview and Production |
| `TANK01_API_KEY` | Private server-only secret, in Vercel Project Settings for Preview and Production; never commit it or expose it to the browser |
| `ENABLE_EXPERIMENTAL_COREPACK` | `1`, available during builds for Preview and Production |

Corepack must remain enabled so Vercel uses pnpm 11.19.0 instead of inferring another pnpm version from the lockfile. The project's Preview and Production environments have `ENABLE_EXPERIMENTAL_COREPACK=1`, following [Vercel's Corepack instructions](https://vercel.com/docs/builds/configure-a-build#corepack). `apps/site/vercel.json`, the only committed Vercel configuration, retains a build-time Corepack fallback. Vercel's schema still accepts `build.env`, but marks it as legacy, so retain the project-level setting as the durable control. Never use committed configuration for private credentials.

Because the Vercel Root Directory is `apps/site`, its `vercel.json` is the single effective configuration file. The league override is deliberately absent from that file: Vercel Project Settings is the single deployment source for `SLEEPER_LEAGUE_ID`. The application still has its documented built-in default for local development and safe startup. Both package files pin the same Node major and pnpm version. Confirm the selected root, lockfile, actual Node and pnpm versions, framework, and league environment value in the first preview's build logs and deployed behavior.

The rebuild does not require the former scheduled cron jobs. Do not restore old cron endpoints or schedules as part of deployment. The existing Git integration is connected; still inspect the actual preview and production deployment for each release rather than assuming a push succeeded.

## Making changes through GPT

The user describes the desired change in GPT. GPT carries it through the repository and deployment process using the available, authorized GitHub and Vercel connections. A request starts work; this workflow does not schedule background changes or authorize unrelated ongoing work.

1. Read the request, inspect current `main` and any existing work, and check `AGENTS.md`. Identify the requested behavior and preserve unrelated changes.
2. Create an isolated branch for the change. Implement the smallest complete change that fits the three-page scope, adding meaningful regression tests when behavior warrants them.
3. Run `pnpm verify` and `pnpm test:browser`. Test the affected experience in a browser at 360, 390, and 430 pixels wide, with a desktop check. Check screen fit, wrapping, touch controls, navigation, and relevant empty or error states.
4. Push the branch and open a pull request that explains the change and its validation. Inspect GitHub checks and the Vercel preview, including the deployed behavior.
5. When the request authorizes release, merge through the repository's normal protected-branch process after its requirements pass. Do not request duplicate approval for an already authorized deployment, bypass required reviews, override protections, or force-push.
6. Verify production after the merge. Confirm the deployed revision, league identity, core navigation, matchup expansion, My Team persistence, and owner transactions as relevant to the change.
7. Report the pull request, final commit, preview and production links, completed checks, and any remaining limitations. If access or an account approval blocks release, finish all available work and state the exact remaining action; do not report a deployment that has not occurred.

If a release needs to be undone, revert the offending commit through a reviewed pull request and verify the resulting deployment. Preserve history rather than resetting or force-pushing `main`.
