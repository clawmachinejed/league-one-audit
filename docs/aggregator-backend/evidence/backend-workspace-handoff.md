# Backend workspace handoff

Status: authorized setup and reconciliation, October 5, 2026. This is a transition brief, not an additional architecture standard or a claim of implementation readiness.

## Mandate and boundary

Build toward a shared, multi-user, provider-neutral fantasy aggregator in which an unrelated supported league works without league-specific engineering. The user authorized a fresh backend-only task and isolated workspace based on the existing canonical repository, with stale documentation treated critically. Use `clawmachinejed/league-one-audit`; a blank replacement repository is not the selected approach. Website UX remains outside scope.

The first task's outcome is one reconciled backend foundation and a bounded implementation plan. Do not write runtime changes or migrations, change production data or schedules, deploy, or introduce a parallel collection/scoring/publication pipeline in this reconciliation task. Follow repository safety instructions. Preserve the existing worker architecture, exact-week behavior, clock-v1, frozen baselines and missing/bye policies when evaluating adoption.

## How to establish authority

1. Preserve explicit user-approved product behavior and applicable repository safety instructions.
2. Inspect current code, tests and migrations to establish implementation facts. Freshly verified external evidence establishes deployed facts only within its observed scope. Existing behavior is evidence of what exists, not automatic endorsement of the target behavior.
3. Treat all prior architecture prose, physical schemas, source mappings, refresh proposals and gap analyses as candidate designs or dated evidence. Labels such as “authoritative,” “complete” or “ready” do not prove correctness. Resolve disagreements with evidence and an explicit decision record.
4. Establish one normative target entry point in the existing repository documentation and make the Ground up package a checked portable copy. Record authority, version, supersession and evidence dates; avoid creating another competing contract. Prefer a machine-readable definition with generated or consistency-checked readable views where useful.

The 36-object/280-column first-build blueprint is a candidate, not an approved mandatory schema. External architecture patterns support a method; they do not certify this design or prescribe its columns. Reuse justified existing components and remove needless design complexity.

## Approved product behavior to preserve

- Sleeper first; other providers are future adapters. Read-only username identification now, provider authorization later. Resolve usernames to stable provider IDs; identification does not prove external-account ownership.
- One active provider account per L1 user per provider, and one L1 user per provider account. L1 identity, provider identity, acquisition permission, current team eligibility and follow preferences are separate concepts.
- Require a current owned or co-managed team. Commissioner status or league membership alone is insufficient. Co-managers independently may view and follow the same shared team and league. Unfollowing, disconnecting or losing eligibility affects that user, not other users or shared facts.
- Missing, null, partial or failed observations do not establish removal. Removal needs qualified evidence that the account has no remaining eligible owner/co-manager relationship.
- Current teams advance per league after verified renewal and current membership; the dashboard may span season years. Completed current seasons remain available while eligible until verified renewal or loss. Carry an existing follow into verified renewal; do not automatically follow newly discovered leagues or override a newer unfollow. Prior-season browsing is not required now.
- Eventually import all recoverable current-season competitive history, current information and the remaining published schedule. Preserve native settings and provenance; normalize the facts required by supported capabilities. Keep official facts available independently of analytical feature coverage.
- Use each league's actual scoring, roster slots, eligibility and competition settings. A shared NFL layer supplies statistics, projections, schedules, game state and reliable availability evidence across providers; score the same projected NFL performance under each league's rules. Frozen pregame baselines and live projected finishes remain separate calculations from provider-authoritative facts. Explicitly identify unsupported formats and unavailable historical detail.
- Collect shared resources once wherever permissions permit; continuously maintain followed leagues while users are absent. Active views, including an aggregate view, promote their leagues. Preserve valid stale information with its age; missing values remain missing and old responses cannot overwrite newer accepted state.
- Qualification target: 500 distinct leagues per supported provider, all watched while imports, background work and retries continue. Demonstrate approximately 60 seconds of additional L1 score delay through measurement. Evaluate the approximately $50 monthly supporting-feed target separately from infrastructure costs. These targets are not demonstrated results.

## Approved membership-age policy

D02: `sleeper-membership-access-v1`, `max_membership_age_seconds = 3600`. The [policy register](backend-policy-register.json) preserves the approval and adjustment history. The approved behavior is binding; proposed physical storage names in that document remain subject to schema reconciliation.

Every league-access allow expires at the latest successful qualifying membership verification plus 3,600 seconds, unless a separate deny or earlier applicable authority expiry intervenes. Unknown first-time membership never grants access. Failed, partial/unqualified, cached or replayed observations and outage onset do not restart the clock. Accepted complete removal denies access earlier. Expiry suspends affected league serving; it is not evidence of membership removal. Membership revalidation must remain possible after temporary expiry so recovery is not blocked by its own access gate.

L1 account/sign-in access is never disabled by provider outage, membership loss, disconnect or this expiry. This policy is approved for implementation, not deployed. Polling intervals, retry caps, concurrency and score-delay percentiles were not approved by D02.

Open product decisions: D03 mistaken exclusive-account claim/replacement recovery before public launch; D04 follow behavior after genuine membership loss and regain; D05 retention and collection after the last follower leaves. Do not invent answers or block independent reconciliation on them.

## Evidence checkpoint and known conflicts

Setup checks on October 5, 2026: local clean `main`, freshly fetched GitHub branch evidence and Vercel production all identify `87da4d0cb909ee280e125e73ad10e1c3dbd7cd9f`. Origin is the canonical repository. Vercel project `league_one_fantasy` (`prj_ltHyQzM7bZfSlTNd2CTalJDLKpVG`) is bound to that repository's `main` and `apps/site`; production deployment `8C3YSnXRCbmPETftQgRtirfyck5e` is Ready at that SHA. Production domain: `https://www.league1fantasy.com`. No open GitHub pull requests were returned. Multiple historical worktrees exist; no production ownership or worker-lease audit was performed. Revalidate before any later implementation/release.

1. **Conflicting authority:** repository `docs/aggregator-backend` and this folder both claim normative status. Previous readiness claims are superseded pending reconciliation.
2. **Accepted-head identity:** repository `docs/aggregator-backend/contracts.md` says the canonical normalizer version is part of accepted-head identity. The Ground up physical draft has one head per resource scope without an explicit normalizer-version scope field, while normalization records carry that version. Resolve coexistence, replay and publication semantics explicitly. This is a contract conflict, not a reproduced production defect.
3. **Capacity is unproven:** the proposed combined workload exceeds the proposed request budget; current worker cadence/concurrency also constrains it. Recalculate realistic provider-wide budgets and measurable delay before accepting proposed refresh values.
4. **Adoption risks to reproduce:** account-link creation depends on user-directory qualification; enrollment has three fresh-head requirements; annual provider IDs interact with stable league identity; an immutable scoring-profile trigger may prevent later analytics qualification. Inspect the actual SQL and tests before asserting fixes or migration order.
5. **Bounded database evidence:** the earlier October 5 read-only Neon audit reports 33 installed migration checksum matches and scoped catalog/conflict counts. The full catalog was not archived. It does not prove full function equivalence, target enforcement or concurrency safety; inspect `first-build-catalog-reconciliation.md` and its evidence files for exact limits. No new database audit was performed during workspace setup.

Never read or use retained `.env.integration.local` for this task, pull production secrets, or run destructive tests on production/retained databases. Only a later authorized, guarded disposable integration harness can establish executable database behavior.

## Required outcome from the fresh task

- A traceable disposition of contradictions: accepted requirement, observed fact, retained/changed/rejected engineering proposal, or unresolved decision. Include evidence paths and dates. Correct overstatements in existing entry points.
- One coherent target definition connecting capability -> source evidence -> normalized entity/field -> key/constraint -> acceptance case. Include precise names, types, null/unknown semantics, relationships, identity scope, provenance, correction/order handling and coverage. Keep provider-specific details at the adapter/extension boundary; do not fabricate Yahoo behavior.
- A build plan comparing reuse, adaptation and replacement of existing components, with rationale. Do not mandate a physical table solely because an old draft lists it.
- A bounded first slice for identification, discovery, shared current teams and authorized stored reads, with exclusivity, co-manager, renewal, expiry/recovery and stale-response acceptance cases. Separate later season-history, analytics and scale milestones. Use the existing pipeline owners.
- A clearly reported gate: what is verified, what remains a candidate, what requires a user decision, and which implementation step is next. No “optimized,” “complete” or “ready” claim without named evidence and material limitations.
- Documentation changes confined to the new worktree. Keep this portable package synchronized with a source revision/hash manifest, or produce a verified copy ready to synchronize if the new task cannot write this folder. No merge or deployment is authorized.

The first task should perform reconciliation and deliver the result, not stop after restating a plan. Routine engineering decisions and reversible documentation work are authorized. Ask only for a genuinely necessary product decision or an unavoidable authority/safety blocker.
