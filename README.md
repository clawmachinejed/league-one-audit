# League One

A mobile-first home for League One, powered by public Sleeper league data. The site keeps the weekly experience focused: Matchups, Standings, and Owners, with rosters and transaction history inside each owner profile.

## What stays central

- Expandable matchup cards: scan team scores, then open the player and lineup comparison.
- A persistent My Team selection, scoped to the league and validated against its current teams.
- Owner transaction history with adds, drops, trades, FAAB bids, and clearly labeled outcomes. Green, red, and muted result colors supplement the text.
- Phone layouts that fit the screen, keep names and scores readable, and provide comfortable touch controls.

The current league ID is `1378850182409490432`. Sleeper IDs must remain strings because they can exceed JavaScript's safe integer range. The default lives in `apps/site/lib/config.ts`; `SLEEPER_LEAGUE_ID` can override it. The site uses real data, shows empty states when appropriate, and reports unavailable or incomplete data without substituting demonstration teams or results.

History, rivalries, awards, a separate statistics section, and a separate schedule section are outside this rebuild's scope.

## Repository and hosting

| Service | Location |
| --- | --- |
| GitHub repository | [clawmachinejed/league-one-audit](https://github.com/clawmachinejed/league-one-audit) |
| Rebuild branch | `codex/mobile-first-2026` |
| Production branch | `main` |
| Vercel project | `league_one_fantasy`, under `robert-finchums-projects` |
| Production address | [www.league1fantasy.com](https://www.league1fantasy.com) |

GitHub linkage and Vercel access were verified during the August 31, 2026 rebuild. The existing project deploys `main` from `apps/site`, with access to files outside that root enabled for the pnpm workspace. At that check, production still served commit `df4a0e489be6e375637c515e663cca31e8c8c25a` from October 8, 2025; the rebuild had not yet been deployed. A release is complete only after its GitHub revision, successful deployment, and production behavior have been checked.

## Local development

Use Node.js 24 and pnpm 11.19.0, as specified in the root `package.json`. The workspace contains one application, `apps/site`.

Run these commands from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Open [localhost:3000](http://localhost:3000). No Sleeper API token is required for the public league data used here.

The built-in league default works without an environment file. To override it locally, copy `.env.example` to `apps/site/.env.local`, then change `SLEEPER_LEAGUE_ID` there. Never commit private environment files, tokens, or account credentials. The league ID itself is public configuration.

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Start the development website. |
| `pnpm lint` | Check source quality with ESLint. |
| `pnpm typecheck` | Generate Next.js route types and check TypeScript. |
| `pnpm test` | Run the Vitest unit tests. |
| `pnpm build` | Create the production build. |
| `pnpm start` | Run an existing production build locally. |
| `pnpm verify` | Run lint, type checks, unit tests, and the production build, stopping on failure. |

`pnpm verify` does not replace browser testing. GitHub Actions runs installation and verification for pull requests and pushes to `main`.

## Code map

| Location | Responsibility |
| --- | --- |
| `apps/site/app` | Routes, metadata, loading, error, and not-found pages. |
| `apps/site/components` | Shared website views and browser interactions. |
| `apps/site/lib/config.ts` | League configuration. |
| `apps/site/lib/sleeper.ts` | Server-side Sleeper requests, caching, and data availability handling. |
| `apps/site/lib/transform.ts` | League, team, matchup, lineup, and transaction normalization. |
| `apps/site/lib/types.ts` | Shared application data contracts. |
| `.github/workflows/verify.yml` | Pull request and main-branch verification. |

League data is cached briefly to limit upstream requests; player metadata is cached longer. Displayed values can therefore lag Sleeper. The site is a league companion: roster moves and fantasy league administration remain in Sleeper.

## Vercel setup

Use the existing Vercel project when access is available, rather than creating a duplicate project or moving its domain without a request. Recommended project settings:

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
| `SLEEPER_LEAGUE_ID` | `1378850182409490432`, for Preview and Production |
| `ENABLE_EXPERIMENTAL_COREPACK` | `1`, available during builds for Preview and Production |

Corepack must be enabled so Vercel uses pnpm 11.19.0 instead of inferring another pnpm version from the lockfile. Both Vercel configuration files include a build-time `ENABLE_EXPERIMENTAL_COREPACK=1` fallback. Vercel's schema still accepts `build.env`, but marks it as legacy; set the flag in the project's Preview and Production environment settings as well, following [Vercel's Corepack instructions](https://vercel.com/docs/builds/configure-a-build#corepack). Never use these committed files for private credentials.

There are Vercel configuration files at the repository root and application root. Match the effective configuration to the Vercel Root Directory: the repository-root configuration's `apps/site/.next` output path must not be applied relative to `apps/site`. Both package files pin the same Node major and pnpm version. Confirm the selected root, lockfile, actual Node and pnpm versions, and framework in the first preview's build logs.

The rebuild does not require the former scheduled cron jobs. Do not restore old cron endpoints or schedules as part of deployment. The existing Git integration is connected; still inspect the actual preview and production deployment for each release rather than assuming a push succeeded.

## Making changes through GPT

The user describes the desired change in GPT. GPT carries it through the repository and deployment process using the available, authorized GitHub and Vercel connections. A request starts work; this workflow does not schedule background changes or authorize unrelated ongoing work.

1. Read the request, inspect current `main` and any existing work, and check `AGENTS.md`. Identify the requested behavior and preserve unrelated changes.
2. Create an isolated branch for the change. Implement the smallest complete change that fits the three-page scope, adding meaningful regression tests when behavior warrants them.
3. Run `pnpm verify`. Test the affected experience in a browser at 360, 390, and 430 pixels wide, with a desktop check. Check screen fit, wrapping, touch controls, navigation, and relevant empty or error states.
4. Push the branch and open a pull request that explains the change and its validation. Inspect GitHub checks and the Vercel preview, including the deployed behavior.
5. When the request authorizes release, merge through the repository's normal protected-branch process after its requirements pass. Do not request duplicate approval for an already authorized deployment, bypass required reviews, override protections, or force-push.
6. Verify production after the merge. Confirm the deployed revision, league identity, core navigation, matchup expansion, My Team persistence, and owner transactions as relevant to the change.
7. Report the pull request, final commit, preview and production links, completed checks, and any remaining limitations. If access or an account approval blocks release, finish all available work and state the exact remaining action; do not report a deployment that has not occurred.

If a release needs to be undone, revert the offending commit through a reviewed pull request and verify the resulting deployment. Preserve history rather than resetting or force-pushing `main`.
