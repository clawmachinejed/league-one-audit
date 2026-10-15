# CP20 generic stored within-season history

Frozen implementation boundary, October 14, 2026. Dependency: CP19 ae20233601f34c59f0c16a2b81b97eea244db57b, tree 06643f6e3584d7ecaac10bfc7022f08553e3abc7, draft PR309. CP19 qualification is accepted under its external qualified-closeout records; its three paid authorizations are consumed. CP1/CP2 row20 and completed evidence remain unchanged.

## Gap inventory and four scope fields

1. Data resource: generic 2026 stored schedules, official results, brackets and recoverable within-season source history, including all supported native periods and each supplied multiweek leg. Native references beyond weeks 1–18 remain explicit unsupported gaps. Annual traversal and prior-season intake/testing are deferred; the CP13 2025 exception does not apply.
2. Existing path: ordinary DATA request and refresh-cycle checkpoints, typed exact matchup values/context/results/brackets and existing retained-matchup comparison. Current public readers already select receipts; named-league B4 annual continuity and 14/15-week display schedules are not generic DATA history. The missing piece is bounded composition. No new acquisition, normalization, scoring, worker, scheduler, storage, publication or migration path.
3. Persisted result: reuse existing immutable receipts and original source clocks. Optional seasonHistoryVersion v1 returns each canonical league-season identity, detailed native period groups, selected exact values/context and official-results composition, explicit requested/page/season coverage and gaps, plus separately labelled retained correction evidence. Matchup ID scope includes league/season/period; bracket IDs remain a separate family namespace. Missing/null grouping cannot establish a bye. Weekly score comparisons cannot establish outcomes or finality. Multiweek legs remain separate unless source proves their relationship. Original settings capture remains observation-only; later evidenced applicability decisions can change interpretation without rewriting capture. Remapping retains existing typed-reader fences and exposes gaps; retained evidence never substitutes for accepted typed facts.
4. Real evidence and gaps: independent preimplementation reviews /root/history_inventory and /root/acceptance_inventory; references DATA-CP20-2026-10-14-STORED-COMPOSITION-SCOPE and DATA-CP20-2026-10-14-STORED-COMPOSITION-QUALIFICATION-SCOPE. Development, final local workflow, source review, draft PR, CI and actual preview are authorized. Hosted SQL, provisioning, credentials, installation, activation, merge and production release are not authorized. Existing evidence is carry-forward at original SHA/run, not a CP20 rerun.

## Exact file boundary

- New apps/site/lib/aggregator/within-season-history.ts and .test.ts: pure native composition.
- New apps/site/lib/league-administration/public-season-history-reader.ts and .test.ts: bounded orchestration of existing stored readers and retained comparison.
- apps/site/lib/league-administration/public-intake-contracts.ts: optional seasonHistoryVersion v1 and only necessary bounded retained selection/cursor types.
- apps/site/lib/league-administration/public-intake-reader.ts: validated opt-in composition and coverage declaration. Existing completion and omitted-option payload/query behavior remain unchanged.
- New public-intake-reader.test.ts/public-refresh-reader.test.ts only if needed to prove compatibility/delegation; refresh implementation already forwards read options.
- New apps/site/integration/within-season-history.integration-case.ts: five fixed sequential cases using the existing harness.
- apps/site/integration/qualification-profile.ts and .test.ts: one closed data-within-season-history-v1 profile, exact names/hash/hooks/report binding and inventory 69 to 70.
- .github/workflows/integration.yml: one manual profile choice/fixed existing supervisor command. No automatic run.
- apps/site/integration/README.md: authored profile inventory and limitations.
- docs/aggregator-backend/data-backend-cp20-plan.md, data-backend-evidence.md and data-backend-scope.json: plan/evidence overlay and exact reviewed file purposes, preserving historical statements and CP1/CP2.

## Fixed acceptance

1. Three unrelated 2026 redraft/keeper/dynasty identities, reused native roster/matchup IDs, all weeks 1–18 and both bracket families. Exact raw/custom/effective decimal and custom-zero parity; no named-league gate or cross-league mixing.
2. Bounded page union accounts for all native tasks once. Pending, unavailable, malformed, unrequested, empty/null and out-of-range evidence stay distinguishable. Page verification never becomes whole-season completion. Each multiweek leg remains independently present.
3. Changed scores/opponents, bracket correction/removal, fresh equal capture and replay preserve original receipts/clocks and retained source history; failed/partial/newer evidence never silently borrows another request's good head. Historical selectors remain queryable without a new enumeration pipeline.
4. Captured settings remain observation-only; independently evidenced scoring/roster/competition applicability honors inclusive boundaries and later corrections. Missing/contradictory/invalid applicability remains explicit. Current settings cannot backfill historical authority.
5. Wrong identity/week/family/receipt/mapping and remap fail closed, unaffected siblings remain usable, retained manifests/cursors are bounded and tamper checked, fetch is prohibited, SQL stays read-only, omitted options preserve behavior. Weekly outcome/finality/series remain unknown unless existing official semantics prove them; bracket w/l can establish only its own reported-played fact.

## Verification and qualification boundary

Use meaningful focused tests while editing; final candidate gets one complete verify:full with hosted SQL explicitly skipped, independent source/result review, normal CI and actual Vercel preview. Repeat only for changes/findings. Local embedded SQL is diagnostic evidence, not genuine hosted LOGIN/TLS qualification. A source-bound proposal may request exactly one closed five-case profile at 0.25 CU with a $1 cap, unchanged 20-second worker fence, 30-minute work/40-minute lifecycle/50-minute CI deadlines, automatic cleanup and no retry. Do not execute before fresh user approval. Direct synthetic prerequisite setup is disclosed and is not ordinary full-season intake, live parity, sustained freshness, fleet performance, independent contention or OS-death proof. CP21–29/30 remain separate.

## Preimplementation authority

Fresh local main/origin and GitHub main agree at 87da4d0cb909ee280e125e73ad10e1c3dbd7cd9f. Built-in Vercel browser shows canonical clawmachinejed/league-one-audit, apps/site root, Node24 and production branch main. Current Ready production is 8C3YSnXRCbmPETftQgRtirfyck5e at that exact SHA. Existing future-projections, lineup-observations and live-projections cron routes remain enabled every minute. Recent GitHub workflows are completed and scoped PRs are draft. No competing owner observed from worktrees, open PRs, workflows, Vercel deployments and cron configuration; no production database lease or credentials inspected. Primary checkout and CP19 dependency remain untouched. CP20 uses codex/data-season-history in its own managed worktree outside synchronized folders.
