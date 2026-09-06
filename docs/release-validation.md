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

Without `BASE_URL`, Playwright requires the configured local port (`PORT`, default `3000`) to be free, builds this checkout, and starts its Next.js production server. An occupied port fails before the build or browser tests; stop your own server or select a free `PORT`. The browser gate used by `pnpm verify:full` also verifies a per-run marker in the generated `.next/static` output against this checkout's Git SHA, working-tree state, source digest, and fresh build ID before running feature tests. The digest covers tracked and untracked non-ignored files; keep the checkout stable through the build and setup. A missing or stale marker or a changed checkout fails closed. The marker is local test tooling only and is not added by normal builds or Vercel deployments.

The pre-build port guard briefly acquires and releases TCP bindings on IPv4/IPv6 loopback, enumerated local interface addresses, and wildcard addresses, including both IPv6-only and dual-stack bindings. Specific-address checks also detect Windows listeners that can coexist with a wildcard binding. These checks do not depend on TCP or HTTP responses, so HTTP error responses, malformed responses, and silent listeners are rejected alike. Unavailable IPv6 loopback/wildcard bindings are tolerated; other probe errors fail closed. Playwright waits for Next's startup message instead of probing HTTP before the guard, then the existing marker check proves the responding build. The guard is an initial availability check; Next must still bind the port after the build.

Successful local setup reports the exact target URL, checkout, Git SHA, working-tree state, build ID, and run ID. To exercise an already-deployed preview, set `BASE_URL` to that preview address before running `pnpm test:browser`. Explicit `BASE_URL` mode starts no local server and requires no local marker; its report identifies the selected target without claiming local-build provenance. URL query strings, fragments, and embedded credentials are omitted from target reporting. Record the preview's exact commit separately through Vercel. A protected preview must be made accessible to the test runner through the normal Vercel access mechanism; do not place bypass credentials in the repository.

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

## B3 migration-first rollout and rollback

This procedure applies only to the additive B3 write guards and compatible callers. It records a future rollout sequence; an open or reviewed B3 PR does not authorize a Production migration, permission change, merge, or deployment. Obtain separate database-migration and application-release authorization, with named database-review, release, and rollback owners, before the corresponding steps.

1. Revalidate local and GitHub `main`, the canonical Vercel source binding and production branch, and the exact existing Production deployment SHA. Verify the intended Production project, branch, database and role identities through authorized secret-safe evidence. Inspect accessible worktrees, PRs, workflows, deployments, natural cron activity and available leases; proceed only with no competing owner observed. Retain the authorized pre-change catalog, owners, table/column/function ACLs, role memberships, migration ledger and checksums, and aggregate lineage/pointer/authority/lease evidence. Production credentials are not part of ordinary local setup or Preview validation.
2. Require independent review of the final exact PR head and passing guarded isolated evidence for both the unchanged old callers and new callers against the final `008_additive_write_guards.sql`. The old `recordProjectionCandidates` SQL must retain its real one-time `NULL`-to-matching-slate transition under the existing runtime role. Prove exact provider, period, source revision and request/observation times, unchanged historical fields, replay and competing-writer behavior; deny conflicting linkage, established-link replacement or clearing, and historical mutation. This narrowly validated direct transition remains compatible until the separately authorized B4 privilege cutover. Ordinary Preview remains database-disabled.
3. Under the separate migration authorization, leave the exact old Production application deployment running and apply only the reviewed `008` through the existing checksummed migration runner. Verify that `001`–`007` match the recorded ledger and that `008` is the only pending migration before execution. Its schema changes, exact new-function execution grants, and ledger entry must commit in one transaction under the existing migration advisory lock. Stop for any unexpected pending migration or checksum mismatch; do not rewrite a ledger entry, modify an applied migration, or introduce `009` as part of this B3 rollout. Existing broad runtime table and column grants remain unchanged.
4. Before releasing callers, verify the committed `008` checksum and single ledger entry against the exact reviewed file. Compare the resulting catalog and ACLs with the approved delta: six new functions, twelve new triggers, owner execution and only three runtime function-execution grants, with PUBLIC execution denied for every new function. Existing functions, triggers, table/column grants, memberships, and migration checksums must be unchanged. Recheck aggregate lineage, pointers, authority and leases without rewriting history or forcing worker/provider calls.
5. Observe naturally scheduled current, future and observer results while the old application still runs against `008`. Record successful normal writes and readable full/compact results for both leagues. Record genuinely idle or inapplicable work separately; it is not proof of a write transition. Keep the caller-release gate pending for any required unobserved eligible work, permission error, lineage discrepancy or unexplained failure. Do not force a write merely to complete this gate.
6. Only after the migration and old-application compatibility gates pass, and with separate merge/deployment authorization, revalidate source, Production SHA and ownership again, merge the reviewed PR, and deploy the new callers. Verify the exact merged Git SHA in Vercel Production, both league sites and full/compact readers, and naturally scheduled worker behavior using the checklist above. Record migration completion, old-application operation, merge and new-application deployment as separate events.

If the new callers regress, an authorized immediate application rollback may restore the exact tested old deployment while retaining `008`, its guards, functions and exact new-function grants. The unchanged old caller's validated direct enrichment transition makes that rollback compatible; no caller shim, guard removal, history rewrite, pointer repair or table-grant expansion is required. Reconcile any temporary Vercel rollback with a protected Git revert, confirm the selected deployment's unchanged cron definitions and source identity, and verify both leagues and natural worker outcomes again. Database rollback or later guard/function cleanup requires separate review and authorization. B4 remains a separate privilege-cutover unit and owns final DB-001 closure.

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
