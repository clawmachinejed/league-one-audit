# Instructions for GPT-managed League One work

## Purpose and scope

The user wants GPT to implement website changes, publish them to GitHub, and deploy them to Vercel through a repeatable process. Carry an authorized request to completion with the available tools. Do not stop at a plan or make the user perform routine implementation steps.

This is the mobile-first League One website. Keep the primary navigation focused on Matchups, Standings, and Owners. Rosters and Transactions belong within owner profiles. Do not reintroduce history, rivalries, awards, separate statistics or schedule sections, demo content, or cron jobs without a new request.

Preserve these defining behaviors:

- Expandable matchup cards with readable player and lineup comparisons.
- My Team selection that persists in the browser, is scoped to the current league, and does not silently select a different owner when leagues change.
- Owner transaction details, including FAAB bids and outcomes, with green, red, and muted result colors and visible text labels.
- Mobile screen fit, readable names and scores, and comfortable controls.

The Sleeper league is `1378850182409490432`. Keep this and all other Sleeper IDs as strings where they represent upstream identifiers. Use the central configuration in `apps/site/lib/config.ts` and its `SLEEPER_LEAGUE_ID` environment override. Do not scatter new league defaults through views. Read league settings and data from Sleeper; do not invent scores, dates, players, results, or a fallback demonstration league.

## Working safely

- Inspect current `main`, repository status, this file, and the user's request before editing. Preserve unrelated work. Use an isolated branch; the initial rebuild branch is `codex/mobile-first-2026`.
- The repository is `clawmachinejed/league-one-audit`. The existing Vercel project is `league_one_fantasy` under `robert-finchums-projects`. Verify access, repository linkage, and current project settings rather than assuming old records remain accurate.
- Work only in the website repository. Any surrounding ChatGPT project `sources/` files are read-only synced references; do not edit, rename, move, or delete them.
- Do not commit secrets, private environment files, deployment credentials, or generated dependency/build directories. Do not put access tokens in shell commands or logs. Use approved account connections and normal tool authentication.
- Never weaken GitHub branch protection, bypass required review or checks, force-push, erase history, or change account/install permissions to get around a blocked action.
- User authorization persists. When the user has asked for implementation and deployment, proceed through that process without redundant confirmation. If an unavoidable permission or account approval is missing, complete all work possible first and explain the exact remaining action.
- A change request does not imply autonomous future work, monitoring, scheduled jobs, or recurring changes. The user initiates subsequent changes unless they separately request automation.

## Implementation and validation

The actual stack and commands are defined by the package files: Node.js 24, pnpm 11.19.0, Next.js 16.3.3, React 19.2.8, and TypeScript 5.9. The single application is `apps/site`; install from the repository root with `pnpm install --frozen-lockfile`.

Keep fetching and private configuration on the server, normalize upstream data separately from presentation, and show useful empty or unavailable states. Preserve fractional scores, actual transaction statuses, and league-specific roster settings. Failed or partial upstream requests must not masquerade as complete history or a successful empty result.

For each substantive change:

1. Implement the requested behavior without expanding the product scope.
2. Add or update meaningful tests for changed calculations, data normalization, transaction outcomes, or other behavior with regression risk. Avoid tests that merely mirror trivial presentation code.
3. Run `pnpm verify` from the repository root. It runs lint, Next.js route type generation and TypeScript checks, Vitest, and a production build. Do not claim checks passed unless they actually did.
4. Inspect the affected pages in a browser at 360, 390, and 430 pixels wide, plus a desktop width. Check for horizontal page overflow, clipped names or scores, usable touch targets, wrapping, focus visibility, and state changes. Test expansion, week navigation, team selection after reload, and transaction readability whenever affected.
5. Check relevant loading, empty, partial-data, error, and invalid-owner states. Do not depend on fabricated production data to make a test look complete.

## GitHub and Vercel release process

1. Push the isolated branch and open a pull request with the problem, resulting behavior, checks performed, and known limitations.
2. Check GitHub Actions and the Vercel preview for the proposed revision. Test the preview itself; a local build alone does not establish deployment success.
3. Respect the repository's required checks and reviews. Merge only when the request authorizes release and those requirements are satisfied. Do not remove safeguards to make the merge possible.
4. Confirm the production deployment belongs to the merged commit. Verify the live league ID and relevant core journeys, then report the pull request, commit hash, deployment links, and results.
5. If blocked, distinguish local completion, branch publication, preview readiness, merge status, and production deployment. Never label a pending or inaccessible step complete.

The recommended Vercel Root Directory is `apps/site`, using the Next.js framework preset, Node.js 24, the pnpm workspace lockfile, and the Next.js `.next` output default. Match the effective Vercel configuration to its selected root; the repository-root `apps/site/.next` path is not correct relative to an `apps/site` root. Configure the new league ID for Preview and Production and verify it in deployed behavior. Do not assume a recorded domain or Git integration proves the current release is live.

For rollback, revert the relevant change through a pull request and verify the resulting production deployment. Do not reset or force-push `main`. If an urgent temporary Vercel rollback is separately authorized, keep Git history and the final deployed state reconciled afterward.
