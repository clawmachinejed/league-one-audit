# League One and League 2

A mobile-first home for League One and its League 2 promotion and relegation league, powered by public Sleeper league data. The site keeps the weekly experience focused: Matchups, Standings, and Owners, with rosters and transaction history inside each owner profile.

## What stays central

- Expandable matchup cards: scan team scores, then open the player and lineup comparison.
- Pregame player projections derived from Tank01's raw weekly statistics using each league's Sleeper scoring settings.
- Live projected finishes that combine official Sleeper points already scored with the frozen pregame projection scaled by the share of the NFL game remaining.
- A persistent My Team selection, stored independently for each league and validated against that league's current teams.
- Owner transaction history with adds, drops, trades, FAAB bids, and clearly labeled outcomes. Green, red, and muted result colors supplement the text.
- Phone layouts that fit the screen, keep names and scores readable, and provide comfortable touch controls.

The two public Sleeper league IDs have one canonical source in [`apps/site/lib/config.ts`](apps/site/lib/config.ts). Change a league ID only in that registry; every route and browser storage key references it. Sleeper IDs remain strings because they can exceed JavaScript's safe integer range. The site uses real data, shows empty states when appropriate, and reports unavailable or incomplete data without substituting demonstration teams or results.

League One keeps its existing routes, such as `/matchups`. League 2 mirrors the same experience under `/league2`, such as `/league2/matchups`. The league selector changes the active league across Matchups, Standings, and Owners. Switching from a team-specific page returns to the selected league's Owners page because Sleeper roster numbers are only unique within one league.

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

The committed league registry works without an environment file. To run the live projection pipeline locally, copy `.env.example` to `apps/site/.env.local` and supply its server-only values.

| Environment variable | Purpose |
| --- | --- |
| `TANK01_API_KEY` | Private, server-only Tank01 credential used to load raw projection statistics and NFL game clocks. |
| `DATABASE_URL` | Pooled, server-only Neon PostgreSQL connection for the restricted `league_one_runtime` role. |
| `MIGRATION_DATABASE_URL` | Direct schema-owner Neon connection used only by the migration command; do not add it to the deployed application. |
| `CRON_SECRET` | Long random secret Vercel sends as a bearer token when it runs the projection worker. |

For a new Neon database, set the schema owner's direct connection as `MIGRATION_DATABASE_URL` locally and run `pnpm db:migrate`. Then run `apps/site/scripts/provision-runtime-role.sql` in Neon's SQL Editor. That script creates the application role through SQL so it does not inherit Neon's administrative role, grants only the tables and operations the worker needs, and fails if the role can create database objects or read the migration ledger. Set a generated password with an unsaved SQL statement, rerun the provisioning script to verify its postconditions, and use that role's pooled connection as `DATABASE_URL`. Never use the schema-owner URL as the application's runtime credential.

Sleeper remains the official source for league identity, rosters, lineups, live scores, and scoring rules. Tank01 supplies pregame projected statistics plus NFL game status and clock data. The application converts the projected statistics with the active Sleeper scoring settings, freezes the last safe pregame result at kickoff, and calculates each live offensive player or kicker as `official Sleeper points + frozen pregame points × game fraction remaining`. Team projections are exact sums of the displayed starter projections. Live D/ST projections hold their frozen baseline because adding Sleeper's provisional D/ST score would double-count points-allowed scoring; final projections become the exact Sleeper result.

Neon stores normalized provider identities, scoring profiles, NFL games, raw observations, immutable kickoff baselines, job leases, and versioned matchup snapshots. It is a persistence and publication layer rather than the scoring authority. A failed or partial refresh never replaces the last complete snapshot. If an available Tank01 slate omits a starter or has incomplete projected statistics for that starter, the engine records a zero baseline and includes that zero in the team projection. Unsafe player-identity matches, invalid scoring settings, and provider outages fail closed.

Vercel invokes the authenticated worker every minute. The worker exits without contacting Tank01 outside an active sync window, checks hourly before games to keep lineups and pregame projections warm, and runs each minute from two hours before through seven hours after a scheduled kickoff. All leagues for the same NFL week reuse the same Tank01 projection and game-state fetches. Browsers request one compact, already-calculated league snapshot every minute while the current matchup page is visible; they do not call Sleeper, Tank01, or Neon directly.

The current worker is sized for the two-league MVP. Its provider grouping and tenant-aware schema avoid duplicating NFL data, but hundreds of leagues will require partitioned durable jobs rather than processing the whole fleet in one Vercel invocation.

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Start the development website. |
| `pnpm lint` | Check source quality with ESLint. |
| `pnpm typecheck` | Generate Next.js route types and check TypeScript. |
| `pnpm test` | Run the Vitest unit tests. |
| `pnpm test:browser` | Run Playwright smoke tests against a local server, or against `BASE_URL` when supplied. |
| `pnpm db:migrate` | Apply pending, checksummed Neon schema migrations using `apps/site/.env.local`. |
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
| `apps/site/lib/config.ts` | Single source of truth for both public Sleeper league IDs. |
| `apps/site/lib/leagues.ts` | Public league identity, artwork, and route prefixes. |
| `apps/site/lib/sleeper.ts` | Server-side Sleeper requests, caching, and data availability handling. |
| `apps/site/lib/tank01-game-state.ts` | Strict Tank01 weekly game-state and clock boundary. |
| `apps/site/lib/live-projection.ts` | Pure, provider-independent clock-v1 projection calculation. |
| `apps/site/lib/projection-store.ts` | Portable PostgreSQL persistence and atomic snapshot publication. |
| `apps/site/lib/live-projection-worker.ts` | Scheduled synchronization and projection orchestration. |
| `apps/site/lib/transform.ts` | League, team, matchup, lineup, and transaction normalization. |
| `apps/site/lib/types.ts` | Shared application data contracts. |
| `apps/site/e2e` | Playwright browser smoke journeys. |
| `apps/site/playwright.config.ts` | Local-server and `BASE_URL` browser-test configuration. |
| `.github/workflows/verify.yml` | Pull request and main-branch verification. |
| `apps/site/migrations` | Ordered, immutable PostgreSQL schema migrations. |

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
| Sleeper league IDs | Shipped from the single registry in `apps/site/lib/config.ts`; no Vercel overrides |
| `TANK01_API_KEY` | Private server-only secret, in Vercel Project Settings for Preview and Production; never commit it or expose it to the browser |
| `DATABASE_URL` | Pooled Neon connection for `league_one_runtime`; replace any integration-generated schema-owner URL and never expose it to the browser |
| `CRON_SECRET` | Random Vercel Project secret of at least 16 characters, used only to authenticate the scheduled worker |
| `ENABLE_EXPERIMENTAL_COREPACK` | `1`, available during builds for Preview and Production |

Corepack must remain enabled so Vercel uses pnpm 11.19.0 instead of inferring another pnpm version from the lockfile. The project's Preview and Production environments have `ENABLE_EXPERIMENTAL_COREPACK=1`, following [Vercel's Corepack instructions](https://vercel.com/docs/builds/configure-a-build#corepack). `apps/site/vercel.json`, the only committed Vercel configuration, retains a build-time Corepack fallback. Vercel's schema still accepts `build.env`, but marks it as legacy, so retain the project-level setting as the durable control. Never use committed configuration for private credentials.

Because the Vercel Root Directory is `apps/site`, its `vercel.json` is the single effective configuration file. Public league IDs are deliberately absent from environment files and Vercel Project Settings; the committed registry in `apps/site/lib/config.ts` is their sole authority. Both package files pin the same Node major and pnpm version. Confirm the selected root, lockfile, actual Node and pnpm versions, framework, and deployed league identities in the first preview's build logs and behavior.

The projection engine has one scheduled job at `/api/cron/live-projections`, declared in `apps/site/vercel.json`. It is authenticated with `CRON_SECRET`, uses a database lease so overlapping invocations cannot publish conflicting work, and is the only browser-independent refresh path. The existing Git integration is connected; still inspect the actual preview and production deployment for each release rather than assuming a push succeeded.

## Making changes through GPT

The user describes the desired change in GPT. GPT carries it through the repository and deployment process using the available, authorized GitHub and Vercel connections. A request starts work; this workflow does not schedule background changes or authorize unrelated ongoing work.

1. Read the request, inspect current `main` and any existing work, and check `AGENTS.md`. Identify the requested behavior and preserve unrelated changes.
2. Create an isolated branch for the change. Implement the smallest complete change that fits the three-page scope, adding meaningful regression tests when behavior warrants them.
3. Run `pnpm verify` and `pnpm test:browser`. Test the affected experience in a browser at 360, 390, and 430 pixels wide, with a desktop check. Check screen fit, wrapping, touch controls, navigation, and relevant empty or error states.
4. Push the branch and open a pull request that explains the change and its validation. Inspect GitHub checks and the Vercel preview, including the deployed behavior.
5. When the request authorizes release, merge through the repository's normal protected-branch process after its requirements pass. Do not request duplicate approval for an already authorized deployment, bypass required reviews, override protections, or force-push.
6. Verify production after the merge. Confirm the deployed revision, both league identities and route prefixes, core navigation, matchup expansion, independent My Team persistence, and owner transactions as relevant to the change.
7. Report the pull request, final commit, preview and production links, completed checks, and any remaining limitations. If access or an account approval blocks release, finish all available work and state the exact remaining action; do not report a deployment that has not occurred.

If a release needs to be undone, revert the offending commit through a reviewed pull request and verify the resulting deployment. Preserve history rather than resetting or force-pushing `main`.
