# League One and League 2

A mobile-first home for League One and its League 2 promotion and relegation league, powered by public Sleeper league data. The site keeps the weekly experience focused: Matchups, Standings, and Managers, with rosters and transaction history inside each manager profile.

## What stays central

- Expandable matchup cards: scan team scores, then open the player and lineup comparison.
- Pregame player projections derived from Tank01's raw weekly statistics using each league's Sleeper scoring settings.
- Live projected finishes that combine official Sleeper points already scored with the frozen pregame projection scaled by the share of the NFL game remaining.
- A persistent My Team selection, stored independently for each league and validated against that league's current teams.
- Manager transaction history with adds, drops, trades, FAAB bids, and clearly labeled outcomes. Green, red, and muted result colors supplement the text.
- Phone layouts that fit the screen, keep names and scores readable, and provide comfortable touch controls.

The two public Sleeper league IDs have one canonical source in [`apps/site/lib/config.ts`](apps/site/lib/config.ts). Change a league ID only in that registry; every route and browser storage key references it. Sleeper IDs remain strings because they can exceed JavaScript's safe integer range. The site uses real data, shows empty states when appropriate, and reports unavailable or incomplete data without substituting demonstration teams or results.

League One keeps its existing routes, such as `/matchups`. League 2 mirrors the same experience under `/league2`, such as `/league2/matchups`. The league selector changes the active league across Matchups, Standings, and Managers. Switching from a team-specific page returns to the selected league's Managers page because Sleeper roster numbers are only unique within one league.

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

### Projection architecture

The projection engine now has one canonical pipeline. Provider-neutral domain policy and ports live under `apps/site/lib/projections/domain` and `apps/site/lib/projections/ports`. Sleeper, Tank01, and Neon details live in their respective adapter directories. The worker imports only the canonical contracts and ports. `apps/site/lib/projections/runtime/projection-composition.ts` is the sole production composition root: it supplies league configuration, concrete adapters, server-only credentials, UUID generation, and wall and monotonic clocks. `apps/site/lib/live-projection-worker.ts` remains the stable worker entry point, while `apps/site/lib/projection-store.ts` remains the stable low-level store facade.

Provider responsibilities are deliberately separate:

- Sleeper is the official league source. It supplies league identity, participants, rosters, starters, official fantasy points, scoring settings, player metadata, and NFL schedule context.
- Tank01 is a statistics and NFL game-state source. It supplies raw pregame projection statistics, a player crosswalk, and current game phase and clock data. It does not calculate league-specific fantasy points.
- Neon resolves provider aliases to canonical identities and stores scoring-rule provenance, NFL games, provider observations, immutable kickoff baselines, worker leases, immutable snapshot history, and current snapshot pointers. It is the persistence and publication layer, not the scoring authority.

Canonical external references include the resource type, provider, and opaque external ID. Roster references also include their league, and scoring-entity references distinguish players from team defenses. This prevents the same text ID from colliding across providers, resource types, or leagues. Neon assigns internal canonical IDs when provider aliases are resolved. The public matchup payload intentionally continues to use Sleeper player and roster IDs, so routes, browser storage, and existing snapshots remain compatible.

The Sleeper adapter preserves the exact numeric source scoring settings for audit and the existing persisted hash. It normalizes supported keys to canonical scoring events only when a league is processed. Unsupported active keys remain explicit in provenance and are excluded from the calculation; aggregate two-point support and the points-allowed bucket proxy are also recorded. The provider-neutral scorer applies those canonical rules to Tank01's normalized statistics; a canonical scoring profile is a runtime calculation input rather than a second persisted source of truth. Legacy-compatible stable JSON, hashes, and deterministic identity values preserve existing revisions and database records. The snapshot builder creates canonical matchup state and converts it once to the unchanged public `MatchupsData` shape.

`clock-v1` is implemented once in the provider-neutral domain. The application freezes the last eligible pregame baseline at kickoff and calculates each live offensive player or kicker as `official Sleeper points + frozen pregame points × game fraction remaining`. Live D/ST projections hold their frozen baseline because adding Sleeper's provisional D/ST score would double-count points-allowed scoring. Final projections become the exact official Sleeper result, and team projections are full-precision sums of displayed starters.

A whole Tank01 slate must pass plausibility and schedule-aware completeness checks before it can be used. After the slate is trusted and identity matching is safe, an isolated absent or unscorable starter projection uses an explicit zero baseline and remains part of the team sum. A missing frozen baseline after kickoff also uses zero and is recorded in aggregate observation metadata; the worker does not invent a frozen database row. Conflicting or ambiguous identity matches, duplicate starters, invalid scoring settings, missing active-starter games or clocks, and missing final official points fail closed. A failed Sleeper league load or later per-league scoring, observation, or publication step is isolated to that league. A shared projection/game-state load, slate-assessment, identity, or provider-persistence failure rejects every league in that group. Partial fleet completion returns the completed counts with failed leagues and makes the cron route return 503; publishing zero leagues fails the run. No failed or incomplete refresh replaces the last complete snapshot.

Vercel invokes the authenticated worker every minute. The worker exits without contacting Tank01 outside an active sync window, checks hourly before games to keep lineups and pregame projections warm, and runs each minute from two hours before through seven hours after a scheduled kickoff. It loads league sources and publication work with concurrency capped at eight. Eligible leagues are filtered to one selected season, season type, and week, so the current run has at most one provider group; the four-group concurrency cap is future-facing. The projection feed and game-state feed run concurrently. A fully cold group can have three Tank01 requests in flight: weekly projections and the player crosswalk start together, alongside the uncached game-state request. Each Tank01 request has a 15-second timeout. The two projection-side success caches last one hour, so a warm call in which both hit adds no projection HTTP requests. Projection failures use a 60-second process-local backoff, rejected persistent cache loaders are not retained, and sibling projection/crosswalk requests settle before failure is returned.

The current official Sleeper observation, every applicable Tank01 game-state observation, and calculation time must be within 90 seconds; the hourly pregame projection slate is intentionally outside that live skew rule. `calculatedAt` is captured once at the start of the run, before sequential preflight and later work. The application first compares Sleeper and game-slate completion times, and Neon then validates the exact per-game source set, mutual source skew, and each live source against `calculatedAt`. A slow run can therefore be rejected at publication even if its provider reads were close to each other.

The server-rendered matchup page and polling API share `apps/site/lib/projection-reader.ts`. Browsers request one compact, already-calculated snapshot every minute only while the current matchup page is visible; they never call Sleeper, Tank01, or Neon directly. Missing, stale, disabled, malformed, or failed Neon reads cause the page to load official Sleeper matchup data for the same week without projections. The detailed HTTP, cache, freshness, and fallback contract is recorded in [the projection architecture plan](docs/projection-architecture-plan.md).

### Projection validation and scale

The destructive Neon integration suite is excluded from normal unit tests. `pnpm test:integration` reads only `apps/site/.env.integration.local`, requires an explicit reset authorization, distinct owner and restricted runtime roles, TLS, safe test names, a production denylist, matching URL and server-reported database identities, and a durable JSON comment containing the expected branch ID, branch name, and random sentinel. It resets the isolated database's `public` schema before and after the suite. See [the integration test guide](apps/site/integration/README.md); never point this command at production.

Deterministic synthetic tests exercise 3, 50, and 300 twelve-manager leagues. For one shared week they prove one projection-feed call, one game-state-feed call, bounded source and publication concurrency of 8, at most 24 simultaneous port operations, stable repeated outputs and revisions, and linear repository work of `8 × leagues + 3` calls. Each test league intentionally uses one starter per manager and the same 12 scoring identities across every league. This is an orchestration test rather than a full-roster, distinct-player, or remote-latency benchmark; it does not exercise full bench/reserve/taxi collections, the unchunked identity batch at fleet scale, or repeated projection-slate scans for every rostered entity.

The two-league MVP fits the current single Vercel worker. The synthetic evidence does not prove that 50 or 300 leagues fit Vercel's 60-second function limit or the worker's fixed 120-second lease. At 300 leagues, publication alone requires roughly 38 waves at concurrency eight, with several sequential database stages in each wave. Calendar preflight also checks configured leagues sequentially until it finds a current period; the synthetic scenario finds one on the first call and does not measure the slower path. The current worker has no whole-run deadline, cancellation, repository timeout, or lease renewal. Before that scale, it needs partitioned durable jobs, renewable and publication-fenced leases, explicit deadlines, backpressure, chunked or bounded identity work, more efficient projection lookup, and real provider/Neon capacity testing. Real 2026 in-game status, clock-transition, halftime, overtime, and final convergence checks are also deferred until games are actually in progress. Live matchup win probability is not implemented.

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Start the development website. |
| `pnpm lint` | Check source quality with ESLint. |
| `pnpm typecheck` | Generate Next.js route types and check TypeScript. |
| `pnpm test` | Run the Vitest unit tests. |
| `pnpm test:integration` | Destructively test the store facade against an explicitly authorized isolated Neon database; never use production. |
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
| `apps/site/lib/projections/domain` | Provider-neutral league, projection, game-state, scoring, and sole `clock-v1` policy. |
| `apps/site/lib/projections/ports` | Canonical interfaces for sources, feeds, identity resolution, persistence, clocks, IDs, and logging. |
| `apps/site/lib/projections/shared` | Resource-scoped provider identities, deterministic stable JSON, and revision-compatibility helpers. |
| `apps/site/lib/projections/adapters/configuration` | Runtime-supplied active-league registry. |
| `apps/site/lib/projections/adapters/sleeper` | Sleeper calendar and league-source translation plus raw-to-canonical scoring normalization. |
| `apps/site/lib/projections/adapters/tank01` | Tank01 requests, caches, envelope validation, crosswalk, slate assessment, and game-state translation. |
| `apps/site/lib/projections/adapters/neon` | Canonical repository and identity adapters plus low-level SQL store modules. |
| `apps/site/lib/projections/worker` | Provider-neutral cadence, grouping, persistence coordination, league calculation, and snapshot construction. |
| `apps/site/lib/projections/runtime/projection-composition.ts` | Sole production composition root for configuration, adapters, environment, UUID, and clocks. |
| `apps/site/lib/projection-store.ts` | Stable low-level Neon store facade used by existing readers and the canonical Neon adapters. |
| `apps/site/lib/live-projection-worker.ts` | Stable worker facade over the canonical orchestrator. |
| `apps/site/lib/projection-reader.ts` | Shared stored-snapshot validation and freshness boundary for the page and polling API. |
| `apps/site/lib/transform.ts` | League, team, matchup, lineup, and transaction normalization. |
| `apps/site/lib/types.ts` | Shared application data contracts. |
| `apps/site/integration` | Production-denying isolated Neon integration harness and store-facade cases. |
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

The projection engine has one scheduled job at `/api/cron/live-projections`, declared in `apps/site/vercel.json`. It is authenticated with `CRON_SECRET` and uses one fixed 120-second database lease to suppress overlapping runs while that lease remains valid. The lease is not renewed and does not fence snapshot publication by lease owner; the 60-second Vercel limit normally keeps a run inside it, while renewable and fenced work remains required before large-scale operation. This cron is the only browser-independent refresh path. The existing Git integration is connected; still inspect the actual preview and production deployment for each release rather than assuming a push succeeded.

## Making changes through GPT

The user describes the desired change in GPT. GPT carries it through the repository and deployment process using the available, authorized GitHub and Vercel connections. A request starts work; this workflow does not schedule background changes or authorize unrelated ongoing work.

1. Read the request, inspect current `main` and any existing work, and check `AGENTS.md`. Identify the requested behavior and preserve unrelated changes.
2. Create an isolated branch for the change. Implement the smallest complete change that fits the three-page scope, adding meaningful regression tests when behavior warrants them.
3. Run `pnpm verify` and `pnpm test:browser`. Test the affected experience in a browser at 360, 390, and 430 pixels wide, with a desktop check. Check screen fit, wrapping, touch controls, navigation, and relevant empty or error states.
4. Push the branch and open a pull request that explains the change and its validation. Inspect GitHub checks and the Vercel preview, including the deployed behavior.
5. When the request authorizes release, merge through the repository's normal protected-branch process after its requirements pass. Do not request duplicate approval for an already authorized deployment, bypass required reviews, override protections, or force-push.
6. Verify production after the merge. Confirm the deployed revision, both league identities and route prefixes, core navigation, matchup expansion, independent My Team persistence, and manager transactions as relevant to the change.
7. Report the pull request, final commit, preview and production links, completed checks, and any remaining limitations. If access or an account approval blocks release, finish all available work and state the exact remaining action; do not report a deployment that has not occurred.

If a release needs to be undone, revert the offending commit through a reviewed pull request and verify the resulting deployment. Preserve history rather than resetting or force-pushing `main`.
