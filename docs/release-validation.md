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
| Scheduled workers | Active Vercel cron definitions match the deployed `apps/site/vercel.json`; all three routes are present and authenticated. Record naturally scheduled results rather than forcing writes for release evidence. |
| Persistence changes | Migration checksum, restricted-role permissions, and applicable isolated Neon test evidence. Never run destructive integration checks against production. |
| Operational compatibility | Both league readers, revision/full protocol, pending/publication lineage, bounded request counts, and relevant worker-duration observations. |

The automated browser suite checks matchup expansion and accessible scores, document fit at 360, 390, 430, and 1280 pixels, 52px player rows when available, touch targets, My Team persistence, transaction presentation, and the not-found route back to Managers. Public-data journeys record an explicit annotation when an upstream empty state makes a measurement inapplicable.

Revision-protocol cases use intercepted browser responses to exercise initial server lineage, current/future cadence, delayed responses, visibility, completed transitions, unchanged verification, changed payloads, bounded 409 recovery, timeout, route fallback, and stale responses during league/week navigation. These fixtures are local to the test browser; there is no production fixture route or application test flag. Intercepted cases do not prove that a deployed API is connected to Neon, so separately inspect real public revision/full endpoints and worker evidence.

Run it locally after installing Chromium once:

```sh
pnpm --filter @l1/site exec playwright install chromium
pnpm test:browser
```

Without `BASE_URL`, Playwright builds the site and starts the local Next.js production server. To exercise an already-deployed preview, set `BASE_URL` to that preview address before running `pnpm test:browser`. A protected preview must be made accessible to the test runner through the normal Vercel access mechanism; do not place bypass credentials in the repository.

## Historical baseline and current release record

Before this review change, production was based on commit [`e15ef17`](https://github.com/clawmachinejed/league-one-audit/commit/e15ef17677ea18c08e2ea99ae5e499a6e401a46d). [GitHub verification run 33532262074](https://github.com/clawmachinejed/league-one-audit/actions/runs/33532262074) passed the then-current lint, type, 88-test Vitest, and production-build gate. The automated Playwright job was introduced after that baseline, so it must be verified on the new pull request rather than attributed retroactively.

The original mobile-first rebuild remains documented in [pull request #136](https://github.com/clawmachinejed/league-one-audit/pull/136). Its preview and 30-test result are historical evidence for that earlier revision, not proof of current production behavior.

The current lineup-freshness release sequence is recorded in [its implementation ledger](lineup-freshness-plan.md). Record each actual starting commit, backup tag, PR head, merge commit, deployment, migration, test total, and operational outcome there. Do not replace historical test totals with newer counts or treat a pending deployment as released.

## Production checklist

- Confirm the Vercel deployment identifies the merged commit.
- Open the production domain through a fresh browser session and verify there is no parking-page redirect.
- Confirm Matchups, Standings, Managers, one manager roster, and one manager transaction page load the intended league.
- Open the league selector and confirm League One stays on root routes while League 2 stays under `/league2` across Matchups, Standings, Managers, roster, and transaction navigation.
- Confirm League One and League 2 each match the canonical registry in `apps/site/lib/config.ts`, with no roster, matchup, or transaction data crossing between them.
- Expand a matchup and inspect player-row fit on a phone-sized viewport.
- Select My Team, reload, and confirm the same team remains selected.
- Select different My Team choices in the two leagues and confirm each choice returns after switching and reloading.
- Check that transaction result labels, colors, movements, and FAAB values are readable when transactions exist.
- Record any Sleeper outage, missing schedule, empty transaction history, protected-preview limitation, or other condition that prevented a check.
- Check real revision endpoints for both leagues: success is `200` with `no-store`, a valid snapshot revision, verification time, and period headers. Check the corresponding full response and its cache/revision headers without invoking a worker.
- Verify active and future pages retain their scoped state after refresh; historical pages must not start polling. Same-revision verification must not collapse cards or download the full payload.
- Confirm the three minute-level cron definitions match the deployed code. Inspect naturally scheduled current, observation, and future results. A healthy idle/busy result is not equivalent to unavailable authority or an unexplained failed run.
- Read aggregate authority, watch, pending, failure, and snapshot metadata when relevant. Avoid raw production payload exports and unnecessary user information.
- If work is eligible, verify healthy leagues publish or return unchanged and that acknowledgment matches the complete official observation. If work is genuinely idle, document idle and readable snapshots; do not force a write merely to complete a checklist.

Never invoke an authenticated preview worker against production Neon. Use disabled persistence or the explicitly isolated test database for preview worker validation. The release order for this feature is additive migration, backend protocol, worker/cron cutover, bounded bootstrap, browser polling, and final cleanup. There must not be simultaneous old/new future owners or a gap in ownership.

The [lineup runbook](lineup-freshness.md) defines request budgets, failure diagnosis, permissions, deferred scale work, and real-game follow-up. Record production duration and request samples honestly: a few successful samples are not a p95/p99 service-level guarantee.

## Rollback

For rollback, revert through a pull request and apply this same validation to the resulting deployment. Do not reset or force-push `main`.

The lineup migration is additive. Do not drop its columns, delete snapshots, manually move current pointers, or erase pending state during an emergency rollback. Confirm the selected older code can read the unchanged snapshot format.

Vercel Instant Rollback does not automatically restore previous cron definitions. If an emergency temporary rollback is authorized:

1. Explicitly disable or correct schedules that do not belong to the restored code.
2. Reconcile Git and deploy the intended `vercel.json` through the normal release path.
3. Confirm the active scheduled routes exist in the running deployment.
4. Confirm an obsolete worker is not still receiving requests and future work has exactly one owner.
5. Verify both league sites, safe fallback, snapshot readability, and the next naturally eligible worker result.

Never leave a Vercel-only rollback inconsistent with GitHub. Roll back or escalate when a reader breaks, the thin watcher calls Tank01, provider traffic exceeds its bounded envelope, ownership allows stale publication, pending work is acknowledged without source lineage, completed periods are polled, or secrets/excessive database privileges are exposed.
