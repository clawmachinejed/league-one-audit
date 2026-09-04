# September 4 production systems audit: corrected remediation plan

Status: corrected documentation-only work order. No remediation in this document has been implemented or authorized.

This document is the single execution plan for findings from the September 4, 2026 production systems audit. It supersedes the audit package's REMEDIATION_PLAN.md, PR_MATRIX.md, ACCEPTANCE_GATES.md, and IMPLEMENTATION_PROMPT.md for sequencing and task prompts. Those files remain historical audit evidence. In particular, IMPLEMENTATION_PROMPT.md is a draft to review, not an instruction to implement anything.

Canonical repository: clawmachinejed/league-one-audit.

Audit package reviewed: production-systems-audit-2026-09-04 at the request-supplied local path. Its contents were not copied into the repository. The package contained 26 files, and all 25 files listed by SHA256SUMS.txt were checksum-verified during this plan review.

## 1. Authority, evidence, and present status

The audit's baseline SHA was 1ed10f69a98090a6e4b740f072a99f70cbca2eae. At the pre-edit plan-review recheck, 2026-09-04T18:15:52-04:00, the reviewer freshly fetched GitHub main and confirmed that local main, origin/main, and GitHub main still pointed to that SHA. The authenticated Vercel Deployments view independently showed the Ready production entry linked to clawmachinejed/league-one-audit, branch main, and commit 1ed10f69a98090a6e4b740f072a99f70cbca2eae. Before this documentation pull request was opened, GitHub showed no open pull request or active main workflow. The repository Doctor reported both public league route markers at HTTP 200 and matching tracked/deployed cron declarations; because DOCTOR-001 is open, that output is supporting evidence and is not treated as independent final-origin or redirect proof. These are point-in-time facts and must be revalidated by every later worker.

The reviewer did not re-query RapidAPI billing, Neon production, Vercel secrets or metrics, GitHub protection, production manager data, or every browser/API case. Those statements remain the original auditor's recorded observations, not independent reproductions by this reviewer.

Use these evidence labels throughout:

| Label | Meaning | Reliance rule |
|---|---|---|
| R | Freshly reproduced during this plan review | Still mutable; revalidate before later implementation or release. |
| I | Independently reproducible from current source, tests, migrations, or public behavior | A later worker must reproduce the relevant claim on current main before changing anything. |
| A | Original auditor's recorded authenticated control-plane or production observation | Treat as a lead only; freshly revalidate through the authoritative service without exposing secrets. |
| L | Retained log or machine-readable artifact in the checksum-verified package | It proves what the artifact records, not current behavior. Rerun when the unit requires current evidence. |
| M | Missing proof | Do not convert to Healthy or a defect without new evidence. |

### Accepted-finding register

Classification, severity, confidence, and titles below are preserved exactly from FINDINGS_LEDGER.md. Confidence was High for every entry.

| ID | Classification / severity | Title | Evidence provenance |
|---|---|---|---|
| OPS-001 | Operational risk / Critical | Tank01 hard cap cannot support scheduled production demand | I + A + M |
| DB-001 | Confirmed defect / High | Runtime grants can rewrite referenced provenance | I + A |
| SCORE-001 | Contract conflict / High | Ten active Sleeper rules per league are excluded from projections | I + A |
| CI-001 | Contract conflict / High | Protected branch does not enforce documented browser/preview gates | I + A |
| PROVIDER-001 | Confirmed defect / Medium | Contradictory Tank01 fields can become a publishable clock | I |
| FUTURE-001 | Confirmed defect / Medium | Future default-period cache can deterministically self-fail freshness | I |
| TEST-001 | Confirmed defect / Medium | Local Full Verify can test an unrelated server | I + L |
| DOCTOR-001 | Confirmed defect / Medium | Doctor can label failed/redirected remote evidence healthy | I |
| WORKER-001 | Operational risk / Medium | Current worker exceeds its platform proof envelope | I + A |
| READER-001 | Operational risk / Medium | Public Neon reads lack a backend deadline | I + A |
| READER-002 | Operational risk / Medium | Revision polling repeats full JSON validation per viewer | I + A |
| RET-001 | Operational risk / Medium | Retention has no owner during future-only operation | I + A |
| ENV-001 | Operational risk / Low | Legacy suspected secret remains a broad Config variable | I + A |
| TANK-002 | Missing proof / High | Endpoint weights, reset timestamp, and production-key account linkage are unproved | I + A + M |
| LIVE-001 | Missing proof / High | Real 2026 transition/provider semantics remain unvalidated | M |
| DB-PROOF-001 | Missing proof / Medium | Full live DDL parity and restore readiness remain unproved | I + A + M |
| PREVIEW-001 | Missing proof / Medium | Preview/production database target separation is not proved | A + M |
| PERF-001 | Missing proof / Medium | Representative p95/p99 and burst capacity are absent | A + M |
| LEDGER-001 | Missing proof / Low | PR5 durable production release record is incomplete | I + A + M |
| KICKER-001 | Technical debt / Low | Slate trust omits the K category | I + A |
| SEC-001 | Technical debt / Low | CSP and avatar-origin containment are absent | I + A |
| SUPPLY-001 | Technical debt / Low | Supply-chain policy lacks automated gates and immutable Actions | I |
| ID-001 | Technical debt / Low | Legacy UUID seed is not provider-scoped | I |
| RET-002 | Technical debt / Low | Retention has no complete multi-season policy | I + A |

REJECTED_FINDINGS.md contains RJ-01 through RJ-24, which the original auditor classified as False positive based on recorded source, test, public, or control-plane evidence. This plan review did not independently reproduce each rejection and therefore does not describe them as independently disproved. A later worker may rely on a rejected candidate only after reproducing the relevant counter-evidence on current main.

## 2. Universal gates

Every work unit below incorporates the applicable gates by identifier. A work unit may finish with no source change when reproduction does not support a change. That is the preferred outcome over speculative cleanup.

### G0 — Authority and ownership

Before implementation and again immediately before any merge or production-affecting action:

1. Fetch origin/main and record local base, origin/main, GitHub main, worktree status, open pull requests, and active main checks.
2. Verify in Vercel that the Ready production deployment is sourced from clawmachinejed/league-one-audit, production branch main, root apps/site, and the exact production Git SHA.
3. Check relevant natural cron activity and database or worker leases without forcing a production write.
4. Stop on any unexplained SHA, repository, branch, root, deployment, or ownership disagreement.
5. Use the phrase “no competing owner observed” only when supported by the accessible worktrees, pull requests, workflows, deployments, cron activity, and leases. Never claim that no other task or chat exists.
6. Use a fresh Codex task for each distinct outcome.
7. For repository-changing work, use a fresh isolated worktree outside OneDrive or any other synchronized folder and a narrowly scoped branch/PR. Evidence-only and control-plane-only units do not create a branch merely for ceremony.
8. Only one production-writing or release-owning unit may proceed at a time.
9. Before editing anything under apps/site, reread apps/site/AGENTS.md and the relevant version-specific guide under apps/site/node_modules/next/dist/docs as required there.

### G1 — Protected application behavior

Unless a selected unit explicitly changes one contract:

- Sleeper remains official for league identity, lineup, roster, schedule, scoring settings, periods, and official points.
- Tank01 supplies raw projection statistics, aliases, and game state only.
- Neon remains the stored snapshot and publication layer.
- Preserve exact requested season/type/week; the distinction between default display and active scoring periods; clock-v1; immutable frozen baselines and snapshot history; current-pointer, source-set, generation, lease, and skew fences; existing bye, empty-slot, and missing-projection behavior; and last-known-good publication.
- Preserve the single league registry, scorer, Tank01 normalizer/feed, snapshot builder, Neon facade, reader, and publication path. Do not create a shadow pipeline.
- Browser pages and the thin observer never call Tank01 or trigger projection work.
- Preserve routes, payload compatibility, fallbacks, caching, league selection, manager selection, and League One/League Two isolation unless the selected unit names a precise compatible change.

### G2 — Database and data safety

- Never expose or copy credentials, private provider responses, raw roster/manager data, or production connection strings.
- Never run pnpm test:integration against production. It may run only when every authorization, database/branch identity, sentinel, TLS, distinct-role, safe-name, and production-denylist guard passes.
- Direct and pooled URLs can identify the same database; string inequality is not isolation proof.
- Migrations are forward-only, ordered, checksummed, transactional, and separately reviewed. Existing migration files are immutable.
- No unit may update existing immutable observations, baselines, snapshots, or historical IDs to repair lineage.
- B1 must complete before B3, B4, F1, or any other database-permission or deletion-capable work.

### G3 — Verification and release record

Use targeted reproduction first. For a repository change, run the proportional development checks and record exact totals, failures, skips, and deviations:

- pnpm verify for application, tooling, workflow, or document changes before merge.
- pnpm test:browser before merge, including documentation-only pull requests, unless an explicit reviewed deviation is recorded.
- pnpm test:integration only for persistence behavior, against the verified isolated target.
- Inspect the actual exact-proposed-SHA Vercel preview in the built-in browser and follow docs/release-validation.md before merge. If Vercel truthfully reports a non-deployable change as not applicable, record that status rather than inventing preview evidence.
- Independent review for provider admission, scoring, migrations, database privileges, retention/deletion, release controls, and security enforcement.

After an authorized production release, verify the exact merged Git SHA in the Ready Vercel deployment; source repo, main branch, and apps/site root; both leagues; relevant public revision/full endpoints; naturally scheduled worker results; leases; A3A-observed quota headroom and, when A3B was released, its supported reserve; and the approved rollback owner. Do not force idle production work for evidence.

Documentation-only units additionally require a clean diff, valid links/commands, git diff --check, and confirmation that no non-document file changed. They do not require destructive database tests or a production deployment, but an eventual merge still follows the complete repository pre-merge workflow above or records an explicit reviewed deviation.

### G4 — Explicit My Team and league-switching regression

Apply this gate to every production-affecting UI, reader, scoring, snapshot, routing, cache, or security unit, on both the exact preview SHA and exact production SHA:

1. In League One, select team A as My Team, reload, and confirm A returns.
2. Switch to League Two, select a different team B, reload, and confirm B returns.
3. Switch League Two → League One → League Two across Matchups, Standings, and Managers. Confirm root versus /league2 routing, correct league identity, no roster/matchup/transaction crossover, and restoration of A and B only in their own leagues after reload.
4. From a team-specific manager route, switch leagues and confirm navigation returns to the selected league's Managers page without carrying the prior roster ID.
5. Record only pass/fail, route, league key, and timestamp. Do not copy team, manager, player, or external league identities into release evidence.

### G5 — Secret-safe artifact gate

No secret-search command may print a matched line, filename, token, connection string, or environment value. Use a checked-in scanner that emits only pass/fail when available. Until then, the following silent pattern is acceptable:

~~~powershell
function Assert-NoSilentMatch {
  param(
    [Parameter(Mandatory = $true)][string]$Pattern,
    [Parameter(Mandatory = $true)][string[]]$Targets
  )

  & rg --quiet --no-messages --pcre2 $Pattern @Targets
  $scanExit = $LASTEXITCODE

  if ($scanExit -eq 0) {
    throw 'Potential credential material detected; match contents suppressed.'
  }

  if ($scanExit -ne 1) {
    throw 'Credential scan did not complete successfully.'
  }
}

$clientSecretNamePattern = '(?i)(TANK01_API_KEY|CRON_SECRET|DATABASE_URL|MIGRATION_DATABASE_URL|X-RapidAPI-Key)'
$credentialValuePattern = '(?i)(postgres(?:ql)?://[^\s"'' ]+:[^\s"'' ]+@|x-rapidapi-key\s*[:=]\s*["''][A-Za-z0-9._~-]{16,}|authorization\s*[:=]\s*["'']bearer\s+[A-Za-z0-9._~+/-]{16,})'

Assert-NoSilentMatch -Pattern $clientSecretNamePattern -Targets @('apps/site/.next/static')
Assert-NoSilentMatch -Pattern $credentialValuePattern -Targets @('apps/site/.next/static', 'apps/site/.next/server')
~~~

Do not replace this with rg -n, rg -l, grep, Select-String, tee, or any command that emits matches. A future scanner must have a planted-credential fixture proving that it fails while captured stdout/stderr contains neither the planted value nor its path. Secret-name inventories may report approved names and scopes, never values.

### G6 — Real recovery procedure for accidental retention deletion

Before retention can leave dry-run mode:

1. Record the current Neon backup/PITR policy, a timestamped pre-change recovery point, non-secret project/branch/database fingerprint, expected RPO/RTO, and a named recovery owner.
2. Restore that point to a new isolated branch, never over production.
3. Validate migration ledger and normalized schema; table/count/checksum aggregates; current pointers; snapshots and source references; frozen baselines; period authorities; leases; and application reads for both leagues.
4. In the isolated branch, rehearse a synthetic retention deletion and a selective recovery. Record timing and the exact dependency/FK order.

If production retention deletes data accidentally:

1. Disable only retention admission/ownership immediately and preserve the exact deployed SHA, retention predicate, job/lease IDs, timestamps, dry-run and actual counts, and logs. Freeze other writers only when lineage is at risk and the user authorizes the operational impact.
2. Use SELECT-only aggregate checks to bound affected tables, time range, references, and both-league impact. Do not run ad hoc UPDATE or DELETE repair statements.
3. Create an isolated PITR restore from a point immediately preceding the deletion. Never overwrite the production branch.
4. Validate the restored branch using the checks above and G4-compatible application reads.
5. With explicit production-data recovery authorization, choose one reviewed path:
   - Selectively rehydrate only missing immutable rows in dependency order, preserving original IDs and source timestamps, never overwriting surviving rows, and reconciling legitimate writes after the restore point; or
   - Promote/cut over to the restored branch only when selective repair is unsafe, after the user accepts the post-restore write-loss window and a reconciliation plan. Quiesce writers for the cutover.
6. Run complete catalog, grants, lineage, pointer, authority, lease, public API, both-league, and G4 checks. If recovery used a branch cutover, retain the former production branch read-only until signoff.
7. Re-enable only a fixed exact SHA, first in dry-run and then with a tiny bounded canary.

If no verified restore point or reconciliation plan exists, keep retention disabled/dry-run and report potential data loss. A code revert alone is not data recovery.

## 3. Decisions reserved for the user

No choice below is made by this plan:

1. Provider cost: after A1 refreshes the account identity, pricing, quota, safely available reset/weight facts, and current scheduled demand, the user may keep capacity already proved adequate or approve an exact A2 plan change. A2 never depends on A3A: it may proceed from A1 and exact user approval as a precautionary operation, while any A3A evidence that already exists is optional input. A2 must label its outcome either “proved sustainable capacity change” when the full allowance/reset/weight/demand/retry/margin envelope is defensible, or “precautionary risk-reduction upgrade” while a necessary fact remains Missing proof. A precautionary upgrade may unlock observation-only A3A but cannot unlock A3B, be called sustainable, or close OPS-001 until A3A evidence proves the resulting capacity state. If existing capacity is not proved and the user does not approve the precautionary operation, A3A stops on that explicit safety decision; it is not waiting for proof from itself. No subscription may change without approval of the exact price and terms. A key rebind or workload/cadence redesign is materially different work and requires its own approved plan.
2. Scoring contract: choose exactly one of C1 disclosure or the C2A → C2B verified-coverage path. If neither is selected, SCORE-001 remains open. The plan does not choose scoring behavior.
3. Retention policy: approve per-table/per-season horizons, required audit evidence, deletion authority, RPO/RTO, and canary size before F2 can enable deletion.
4. Production/control-plane authority: later changes to GitHub protection, Vercel variables, Neon privileges, provider configuration, production data, or deployment each require the authority named by their unit.
5. Triggered debt: K1 remains dormant until a K roster is proposed. K2 remains dormant until a second official provider is approved. J3 requires a separate decision after report-only CSP evidence.

## 4. Dependency-safe work order

This plan contains 36 work units: 34 regular units across orders 1–32, including the three distinct 9-series scoring units, plus two triggered units. Only units whose prerequisites and user decisions are satisfied may start. Independent units may run concurrently only when they do not compete for production-writing or release ownership.

| Order | Unit | Findings | Hard prerequisites | Result |
|---:|---|---|---|---|
| 1 | A1 Provider identity/capacity proof | OPS-001, TANK-002 | G0; account and Vercel read authority | Fresh non-secret evidence; no change |
| 2 | A2 Provider capacity operation | OPS-001 | A1; exact user cost approval | Proved sustainable change or precautionary risk reduction |
| 3 | A3A Observation-only quota telemetry | OPS-001, TANK-002 | A1; proved existing capacity or approved A2 risk reduction | Measured normal-call evidence; no admission change |
| 4 | A3B Quota reserve/admission | OPS-001 | Sufficient A3A evidence; capacity proved adequate | Supported reserve and current-before-future admission |
| 5 | B1 Recovery and schema proof | DB-PROOF-001 | G0; isolated restore authority | Proven catalog and restore procedure |
| 6 | B2 Preview DB isolation | PREVIEW-001 | B1 | Non-secret target guard |
| 7 | B3 Compatible DB guards/write path | DB-001 | B1, B2 | Additive compatible code/schema; no revocation |
| 8 | B4 Runtime privilege cutover | DB-001 | B3 released and stable; fresh restore point | Exact grants only |
| 9A | C1 Scoring disclosure option | SCORE-001 | User selects disclosure | Disclosure only; scoring unchanged |
| 9B | C2A Scoring-semantics proof | SCORE-001 | User selects coverage; A1 | Read-only rule/field evidence |
| 9C | C2B Scoring coverage implementation | SCORE-001 | C2A, A3B | Versioned verified scoring change |
| 10 | D1 Provider contradiction rejection | PROVIDER-001 | G0 | Narrow normalization fix |
| 11 | D2 Future cache/freshness alignment | FUTURE-001 | A3B | Narrow scheduling/cache fix |
| 12 | E0 Performance measurement instrumentation | PERF-001 | A3A, B2 | Observation-only metrics and load tooling |
| 13 | E1 Pre-change performance baseline | PERF-001 | E0 | Required tail/burst evidence |
| 14 | E2 Current worker deadline | WORKER-001 | E1 | Evidence-sized deadline change |
| 15 | E3 Public reader deadline | READER-001 | E1 | Evidence-sized cancellation/deadline |
| 16 | E4 Compact revision read | READER-002 | E1 threshold breach; B1, B2, B4 | Versioned pointer attestation and bounded read |
| 17 | F0 Retention policy and dry-run design | RET-001, RET-002 | B1; approved horizons | Exact predicates/write set/timing; no deletion |
| 18 | F1 Narrow retention DB interface | RET-001, RET-002 | F0, B4 | Separately reviewed schema/permissions |
| 19 | F2 Retention owner and enablement | RET-001, RET-002 | F1; deletion/canary authority | Bounded observable retention |
| 20 | CI1 CI workflow contexts | CI-001 | G0 | Stable workflow contexts; no external config |
| 21 | CI2 Isolated DB CI automation | CI-001 | B1, B2, CI1 | Stable path-aware isolated-DB context |
| 22 | SC1 Supply-chain workflow policy | SUPPLY-001 | CI1 | Pinned Actions and automated policy |
| 23 | CI3 GitHub protection settings | CI-001 | CI1, CI2; repo admin | Proven required checks enforced |
| 24 | H1 Local browser-server provenance | TEST-001 | G0 | Full Verify proves current checkout |
| 25 | H2 Doctor remote-evidence truth | DOCTOR-001 | G0 | Exact-SHA and redirect-safe evaluation |
| 26 | I1 Natural first-game/tail evidence | LIVE-001, PERF-001 | A3A; natural game window | Observation record; may inform A3B; no forced writes |
| 27 | I2 Historical release ledger | LEDGER-001 | Authenticated retained history | Facts-only docs PR |
| 28 | J1A Legacy environment inventory | ENV-001 | Human owner/consumer coordination | Read-only names/scopes evidence |
| 29 | J1B Preview environment cleanup | ENV-001 | J1A; Preview authority | Preview-only retirement |
| 30 | J1C Production environment cleanup | ENV-001 | J1B; explicit production/rotation authority | Production retirement/rotation |
| 31 | J2 CSP report-only characterization | SEC-001 | G0 | Compatibility evidence |
| 32 | J3 CSP/avatar enforcement | SEC-001 | J2; explicit enforcement approval | Narrow defense-in-depth change |
| Triggered | K1 League-aware K coverage | KICKER-001 | Approved K activation | Must precede K roster activation |
| Triggered | K2 Provider-scoped identity migration plan | ID-001 | Approved second official provider | New reviewed migration plan; no implementation |

### Change-matrix legend

Code means repository executable, test, workflow, or migration files; documentation alone is identified explicitly. Configuration means external service or runtime settings, not tracked workflow text. Billing means a subscription, charge, or paid resource. Data means database schema/runtime records or copied test data, not a Markdown evidence record. Production means any production application, provider, database, release-control, or service-state change. When a unit has a no-change admission outcome, the matrix describes the executed remediation path and the unit records no change instead.

## 5. Work units and individual prompts

### A1 — Provider identity and capacity proof

- Findings: OPS-001 — Operational risk / Critical / High — Tank01 hard cap cannot support scheduled production demand; TANK-002 — Missing proof / High / High — Endpoint weights, reset timestamp, and production-key account linkage are unproved.
- Evidence/reproduction: Revalidate A and M evidence in RapidAPI and Vercel without revealing or comparing secret values and without making a diagnostic provider call. Record account/application/subscription owner, plan, current allowance/remaining, hard-limit/overage behavior, exact reset semantics if exposed, endpoint billing weights if exposed, and separate Preview/Development ownership or isolation. Recalculate the raw call-attempt envelope for the upcoming activity window from current source and schedules; do not assume the historical 141 remaining, pricing, weights, or reset boundary is current. Mark every unavailable reset/weight fact Missing proof instead of filling it by inference.
- Dependencies/prerequisites: G0, G1, G5; authenticated read authority for the intended RapidAPI account and Vercel secret metadata.
- Protected behavior: No provider calls are added; current, future, observer, browser, grouping, scoring, and fallback behavior remain untouched; credentials remain hidden.
- In scope: Non-secret account-to-deployed-secret attestation or fingerprint, current commercial terms, and a decision-ready capacity comparison.
- Excluded: Subscription change, key rotation/rebinding, code, cron, traffic reduction, forced cron, and production data access.
- Tests/evidence: Timestamped screenshots or redacted metadata summary; independent schedule/request lower- and upper-bound attempt calculation; contradiction check between account dashboard and normal-call telemetry if already present. No credential value or raw response. If the deployed account/application relationship cannot be attested, stop with OPS-001 and TANK-002 open; do not rebind a key or redesign workload in this unit.
- Release checks: G0 only; G4 is not applicable because nothing is released.
- Rollback/recovery: None; this unit is read-only. Correct or retract the evidence record if identity cannot be proved.
- User decisions/authority: Account and Vercel read access may require the account owner. Any mismatch or unknown cost terms is a stop.
- Change matrix: Code No; Configuration No; Billing No; Data No; Production No, read-only observation only.
- Closure owner: Owns the account/application/subscription/environment-attestation portion of TANK-002 and supports OPS-001. Any identity gap remains open for a new approved plan; reset or weight gaps remain open for A3A normal-call observation. A1 closes neither finding by itself.
- Individual prompt:

> In a fresh task, execute only A1 from docs/audits/2026-09-04-production-systems-audit-remediation.md. Revalidate the Tank01 account/application/subscription and its non-secret relationship to the deployed Production secret, separately record Preview/Development ownership or isolation, and calculate the current raw call-attempt envelope. Record reset and endpoint-weight facts only when the provider exposes them; otherwise retain them as Missing proof. Do not reveal or compare secret values, make a Tank01 diagnostic call, change a plan/key/configuration, edit the repository, or touch production data. Produce only redacted evidence and a user decision record; stop on an identity or authority gap and leave both findings open.

### A2 — Provider capacity operation

- Findings: OPS-001 — Operational risk / Critical / High — Tank01 hard cap cannot support scheduled production demand.
- Evidence/reproduction: Use fresh A1 evidence and fresh provider terms; any already available A3A evidence is optional and A2 never waits for A3A. Label the outcome exactly “proved sustainable capacity change” only when the selected allowance covers a defensible reset/weight/demand/cold-isolate/retry/margin envelope. When a necessary fact is unavailable, label it exactly “precautionary risk-reduction upgrade”; do not call it adequate or sustainable and do not close OPS-001.
- Dependencies/prerequisites: A1 complete; exact user approval of plan, price, overage/hard-limit terms, account/application, and timing; no unexplained identity gap.
- Protected behavior: No cadence, scoring, pipeline, secret, database, or application change. Do not reduce live accuracy silently.
- In scope: Change only the approved Tank01 subscription/capacity on the attested account and record the effective subscription/reset state.
- Excluded: Key rebinding, Vercel configuration, code, cron, database, billing changes beyond the exact approved plan, and provider test calls.
- Tests/evidence: Before/after plan name, allowance, reset if exposed, hard-limit/overage policy, price, owner, effective timestamp, and remaining capacity from control-plane metadata. Record the exact outcome label, capacity calculation, evidence inputs, and residual Missing proof. Confirm operation through normal natural calls, not a forced call.
- Release checks: G0 and a post-operation natural-call observation; G4 is not applicable.
- Rollback/recovery: Follow freshly documented provider reversal terms only. Never downgrade below proven demand. If reversal would strand live work, retain capacity and escalate.
- User decisions/authority: Explicit financial approval is mandatory immediately before the change.
- Change matrix: Code No; Configuration Yes, external provider subscription/capacity setting only; Billing Yes; Data No; Production Yes, external provider capacity only.
- Closure owner: Satisfies the capacity-change portion of OPS-001 only for a proved sustainable capacity change. A precautionary risk-reduction upgrade may allow A3A observation but leaves OPS-001 open; if later A3A evidence proves the resulting state adequate, that fresh state proof—not the earlier precautionary label—satisfies the capacity prerequisite. Durable closure also requires A3B.
- Individual prompt:

> In a fresh task, execute only A2 from docs/audits/2026-09-04-production-systems-audit-remediation.md after A1 and exact user cost approval; never wait for A3A, though any already available A3A evidence may be used. Present the exact current price and terms, and change only the user-approved Tank01 subscription on the attested account. Label the result “proved sustainable capacity change” only when the full reset/weight/demand/retry/margin envelope is defensible; otherwise label it “precautionary risk-reduction upgrade,” leave OPS-001 open, and use it only to permit normal-call A3A observation. Do not edit code, keys, Vercel, cron, scoring, or data, and do not make a diagnostic provider call. Stop before financial action unless the user approved that exact plan and price.

### A3A — Observation-only quota telemetry

- Findings: OPS-001 — Operational risk / Critical / High — Tank01 hard cap cannot support scheduled production demand; TANK-002 — Missing proof / High / High — Endpoint weights, reset timestamp, and production-key account linkage are unproved.
- Evidence/reproduction: Independently reproduce from current source the lack of allowlisted quota-header capture. Freshly assess the recorded OPS-001 and TANK-002 leads from responses to normal existing Tank01 calls only; never add, force, replay, or broaden a provider call merely to collect evidence, and never describe an unobserved control-plane fact as independently reproduced.
- Dependencies/prerequisites: A1 complete; either current capacity is proved adequate for the natural observation window from available evidence or the user explicitly approved an A2 operation, including a precautionary risk-reduction upgrade; G0, G1, G3, G5; approved field allowlist, aggregate schema/retention, observation owner, and production release.
- Protected behavior: Provider call count, request shape, timing, cadence, retries, cache, grouping, current/future ordering, scoring, and fallback remain unchanged; thin observer/browser Tank01 calls remain zero; telemetry cannot gate work or alter success/failure.
- In scope: On responses from the existing canonical Tank01 call path, capture only approved quota allowance, remaining, reset, and billed-unit/endpoint-class metadata; aggregate by non-identifying endpoint class and provider period with bounded cardinality. Missing or unobserved fields remain Missing proof.
- Excluded: Reserve or threshold enforcement, workload admission/deferral, current-before-future policy change, provider alert that changes behavior, new provider call/traffic, diagnostic call, plan/key/cron/cadence change, raw header/body/URL/query capture, player/manager identifiers, and a new monitoring vendor.
- Tests/evidence: Present, absent, malformed, conflicting, and reset-transition header fixtures; documented billing-unit variants; 429/5xx response metadata; cold/warm cache, retry, multiple-isolate, and shared-period instrumentation; strict output allowlist/redaction/cardinality; instrumented versus baseline provider-call-count equality; zero observer/browser calls; sanitized natural-call aggregates only.
- Release checks: G0, G1, G3, G4, G5; exact preview and production SHA; both leagues; natural call/header reconciliation; identical provider request counts and unchanged cron definitions; no reserve, admission, or workload result delta.
- Rollback/recovery: Reviewed instrumentation-only code revert. Retain only approved sanitized aggregates long enough for diagnosis; no provider capacity, admission, or workload setting is changed or rolled back.
- User decisions/authority: Approve the exact recorded fields, aggregation/retention, observation owner, and production release. When proceeding after a precautionary A2 upgrade, acknowledge that capacity remains unproved and OPS-001 remains open.
- Change matrix: Code Yes, observation instrumentation only; Configuration No; Billing No; Data Yes, approved aggregate operational telemetry only and no private business payload; Production Yes, instrumentation release only.
- Closure owner: Supports OPS-001 but never closes it or asserts a reserve/admission policy. For TANK-002, A1 owns account/application/subscription/environment attestation and A3A owns normal-call reset/header/billing/endpoint-weight evidence; every unobserved item remains Missing proof.
- Individual prompt:

> In a fresh isolated worktree, execute only A3A from docs/audits/2026-09-04-production-systems-audit-remediation.md after A1 and either proved existing observation capacity or an explicitly approved A2 operation. Add observation-only allowlisted quota, remaining, reset, and billing metadata capture to normal existing Tank01 responses. Prove provider call count/traffic, request shape, cadence, grouping, cache, ordering, scoring, fallbacks, and results are unchanged, with zero browser/observer calls. Do not create/force a provider call, enforce a reserve, change admission, defer work, change plan/key/cron/config/database, or expose raw/private data. Open one telemetry-only PR; do not merge or deploy without authorization, and retain unknown facts as Missing proof.

### A3B — Quota reserve and admission control

- Findings: OPS-001 — Operational risk / Critical / High — Tank01 hard cap cannot support scheduled production demand.
- Evidence/reproduction: Use A1, any applicable A2 state, and representative normal-call A3A evidence. Before editing, document an evidence-sufficiency gate covering the attested account/allowance, reset boundary or defensible provider-supported bound, billed units or defensible upper bound per used endpoint class, natural game-day burn, cold-isolate/retry factor, scheduled demand, and explicit incident margin. If any fact needed to bound capacity or reserve is unknown, retain it as Missing proof and do not start A3B.
- Dependencies/prerequisites: A3A released and stable with enough representative evidence; current or post-A2 capacity state defensibly proved adequate using that evidence; G0, G1, G3, G5; explicit approval of the derived reserve, alert owner, admission behavior, and production release.
- Protected behavior: Current live work has priority; browser/observer Tank01 calls remain zero; two leagues sharing one provider period still share requests; exact-week, call grouping, cache, retries, last-known-good, scoring, and existing cron definitions remain unchanged.
- In scope: Derive and enforce a supported quota reserve from measured/proved inputs; alert on evidence disagreement and low headroom; defer discretionary future ingestion before current live work; make every defer durable and truthful without false success; add no provider calls or traffic.
- Excluded: Observation-field expansion unrelated to the reserve, provider plan/key change, cron/cadence expansion, scoring/database/API change, guessed reset/weight, raw provider data, and any claim that an unknown fact is proven.
- Tests/evidence: Measured custom billing weights and reset transition; absent/malformed/conflicting telemetry fails closed without inventing a threshold; 429/hard cap and 5xx; cold/warm cache; retries and multiple isolates; shared multi-period grouping; current-before-future priority; durable defer/retry without false success; provider-call-count equality; both-league isolation.
- Release checks: G0, G1, G3, G4, G5; exact preview and production SHA; A3A natural-call reconciliation; proved capacity/headroom; supported reserve; both leagues; unchanged provider request envelope and cron definitions.
- Rollback/recovery: Revert A3B admission/alert code and non-secret thresholds through review while retaining A3A observation. Keep proved provider capacity in place; never roll back by silently admitting future work ahead of current live work.
- User decisions/authority: Approve the evidence-sufficiency conclusion, derived reserve, alert recipients, admission policy, and release. The 2,600-request figure is only a temporary conservative Week 1 schedule-derived reserve, not a proven permanent daily threshold; replace it only with measured reset/weight/burn/retry/margin evidence. Unknown necessary facts block A3B rather than becoming assumptions.
- Change matrix: Code Yes; Configuration Yes, non-secret supported thresholds/alert routing only; Billing No; Data Yes, aggregate operational telemetry and prospective defer/retry records only, with no private business payload; Production Yes after release authorization.
- Closure owner: Final owner of OPS-001 jointly with A1, a defensibly proved current or post-A2 capacity state, and A3A evidence. A precautionary A2 upgrade, A3A alone, risk acceptance, or any unproved capacity/admission element leaves OPS-001 open. A3B does not close or manufacture missing TANK-002 evidence.
- Individual prompt:

> In a fresh isolated worktree, execute only A3B from docs/audits/2026-09-04-production-systems-audit-remediation.md after stable A3A provides enough measured evidence to prove the current/post-A2 capacity state and derive a defensible reserve. Derive the reserve from measured reset, endpoint billing, natural burn, retry/cold-isolate, demand, and incident-margin evidence; retain every unknown as Missing proof. Add current-before-future admission and truthful durable deferral on the existing call path with zero new provider calls or traffic. Run malformed/conflicting telemetry, reset, hard-cap, retry, grouping, both-league, call-count, and G4 gates. Do not change provider plan/key/cron/cadence/scoring/database, merge, or deploy without authorization, and do not claim OPS-001 closed unless capacity and admission are genuinely demonstrated.

### B1 — Database recovery, restoration, and schema proof

- Findings: DB-PROOF-001 — Missing proof / Medium / High — Full live DDL parity and restore readiness remain unproved.
- Evidence/reproduction: Generate a normalized desired-state catalog from current migrations/provisioning and compare it with SELECT-only production catalog evidence and a freshly migrated isolated database. Create a timed in-provider PITR restoration to a new isolated Neon branch and rehearse synthetic deletion recovery without exporting or downloading production rows.
- Dependencies/prerequisites: G0, G2, G5, G6; Neon restore authority; verified isolated target identity and no other user of that branch; stop on unexpected cost.
- Protected behavior: Production is read-only; migrations and production schema/data remain unchanged; immutable lineage and both-league isolation are preserved.
- In scope: Tables/columns/defaults/nullability; keys/checks/constraints; indexes; triggers/functions/bodies/owners/security-definer configuration; RLS/policies; sequences; grants/default grants/memberships; extensions/version; restore point, RPO/RTO, integrity aggregates, table/index size and bloat indicators, autovacuum/analyze posture, and application read smoke. Add the completed G6 recovery runbook evidence.
- Excluded: Production migration, permission/grant change, retention delete, production failover, connection-string export, row dump/download, external backup copy, EXPLAIN ANALYZE on production work, and application code.
- Tests/evidence: Fresh migration into isolated Neon; normalized catalog diff; migration ledger/checksums; zero invalid indexes/unvalidated constraints; restored counts/checksum aggregates; current pointers/source lineage/frozen baselines/authorities; table/index growth and autovacuum posture; safe SELECT-only production EXPLAIN without ANALYZE for representative retention predicates; both-league read smoke; synthetic deletion plus selective recovery timing. DB-PROOF-001 closes only if all catalog, restore, capacity-maintenance, and recovery evidence is complete.
- Release checks: G0, G2, G6. G4 is run only against the isolated/restored application target if safely available; no production browser mutation is needed.
- Rollback/recovery: Remove only the verified disposable branch after evidence is retained, target identity is rechecked, and no other run uses it. No production rollback applies.
- User decisions/authority: Neon restore/branch authority is required. Any unexpected cost stops this unit and requires a separately approved plan. Record a named recovery owner.
- Change matrix: Code No; Configuration Yes, isolated Neon branch/restore target only; Billing No; Data Yes, an in-provider isolated PITR copy plus synthetic test data only; Production No change, SELECT-only inspection.
- Closure owner: Final owner of DB-PROOF-001 and hard prerequisite for every permission or deletion-capable unit.
- Individual prompt:

> In a fresh task, execute only B1 from docs/audits/2026-09-04-production-systems-audit-remediation.md. Build the normalized schema/grant manifest, compare production with SELECT-only queries and a freshly migrated isolated database, perform a timed in-provider PITR restore to a new isolated Neon branch, and rehearse synthetic retention-deletion recovery. Include bloat/autovacuum posture and safe EXPLAIN without ANALYZE for representative retention predicates. Do not export/download rows, change production schema/grants/data/code/settings, or expose connection strings or private rows. Record RPO/RTO and the full G6 evidence; stop on target identity, authority, unexpected cost, or any proof gap.

### B2 — Non-secret Preview database isolation

- Findings: PREVIEW-001 — Missing proof / Medium / High — Preview/production database target separation is not proved.
- Evidence/reproduction: Freshly show that separate secret records are not proof of different targets. Establish a non-secret project/branch/database fingerprint derived from authoritative metadata, never from a logged URL.
- Dependencies/prerequisites: B1 establishes the production and isolated fingerprints; G0, G1, G2, G3, G5; Vercel and Neon configuration authority.
- Protected behavior: Preview cannot write production; production keeps its intended target; credentials never leave their service; integration guards remain stricter than a single fingerprint.
- In scope: Add the minimum startup/persistence guard and non-secret metadata needed for Preview to fail closed on the production fingerprint and pass on the intended isolated target.
- Excluded: Comparing or logging URLs/secrets, production data copy, destructive Preview work, broad environment cleanup, migration, permission change, or app feature change.
- Tests/evidence: Unit/guard fixtures; Preview with intended fingerprint passes; Preview with production fingerprint fails before persistence construction; isolated integration safety remains intact; logs and artifacts contain no credentials.
- Release checks: G0, G1, G2, G3, G4, G5; exact preview/production SHA and fingerprints; both leagues; no authenticated preview worker against production Neon.
- Rollback/recovery: Revert the guard through a PR and remove only the new non-secret metadata if misconfigured. Never restore a production URL to Preview as a workaround.
- User decisions/authority: Vercel/Neon admin authority for non-secret metadata; production release authorization for the guard.
- Change matrix: Code Yes; Configuration Yes, non-secret Vercel/Neon target metadata; Billing No; Data No business-data mutation; Production Yes, guard/config release only.
- Closure owner: Final owner of PREVIEW-001 and prerequisite for B3 and CI2.
- Individual prompt:

> In a fresh isolated worktree, execute only B2 from docs/audits/2026-09-04-production-systems-audit-remediation.md after B1. Add the smallest non-secret target fingerprint and fail-closed Preview guard; prove the intended isolated target passes and the production fingerprint is rejected before persistence. Do not compare/log credentials or URLs, migrate, alter grants, run Preview workers against production, or change application behavior. Open one narrow PR and keep Vercel metadata changes separately authorized; do not merge or deploy without approval.

### B3 — Additive compatible write path and immutable guards

- Findings: DB-001 — Confirmed defect / High / High — Runtime grants can rewrite referenced provenance.
- Evidence/reproduction: Independently inventory every normal current, future, observer, reader, repair, and retention SQL statement and reproduce the overbroad mutation path in isolated Neon. Compare with fresh production catalog evidence from B1.
- Dependencies/prerequisites: B1 and B2 complete; G0, G1, G2, G3, G5; independent database-security review; explicit migration and narrow new-function ACL authority.
- Protected behavior: Immutable observations/baselines/snapshots/profile history; atomic fenced publication and acknowledgment; current functionality for both leagues; forward-only migrations; no historical rewrite.
- In scope: Remove no-op conflict updates; add immutable/transition guards and narrowly scoped owner-controlled functions or compatible exact-column write paths; update callers to use them. For every new function, revoke default PUBLIC execution and grant only the exact compatibility role/function access after review. Leave all existing broad table/column runtime grants in place until B4.
- Excluded: Revoking existing runtime table/column grants, default-grant/membership redesign, retention redesign/deletion, scoring, provider, cron, API, or unrelated schema cleanup.
- Tests/evidence: Positive normal current/future/observer/read/retention paths; denied immutable/stable-field updates and protected deletes; cross-league attack fixture; source-set/skew/generation/lease concurrency; desired ownership/security-definer/search-path assertions; normalized ACL diff proving only the named new-function ACLs changed; isolated integration only.
- Release checks: G0 through G5, including G4; exact preview and production SHA; post-release SELECT-only lineage/pointer/authority/lease checks; naturally scheduled writes succeed. Do not cut privileges in this unit.
- Rollback/recovery: Revert application callers through a reviewed PR. Leave safe additive guards/functions in place until a later reviewed cleanup; never remove protection to make old code pass.
- User decisions/authority: Migration, exact new-function ACL, and production release authorization; named database reviewer and rollback owner.
- Change matrix: Code Yes; Configuration Yes, only exact default-deny ACLs for newly added functions; Billing No; Data Yes, additive schema/migration-ledger metadata only with no business-row rewrite; Production Yes after migration/ACL/release authorization.
- Closure owner: Supporting prerequisite for DB-001; B4 owns final privilege closure.
- Individual prompt:

> In a fresh isolated worktree, execute only B3 from docs/audits/2026-09-04-production-systems-audit-remediation.md after B1 and B2. Reproduce DB-001 in isolated Neon, inventory the exact write set, and add only compatible immutable guards/narrow write paths. Keep existing broad table/column grants unchanged; make every new function default-deny by revoking PUBLIC execution and granting only its explicitly approved compatibility access. Never rewrite history or weaken publication/lease/skew/league fences. Run isolated integration plus an exact ACL diff and open one database-reviewed PR; do not change retention/scoring/cron, merge, migrate, apply ACLs, or deploy without separate authorization.

### B4 — Runtime privilege revocation cutover

- Findings: DB-001 — Confirmed defect / High / High — Runtime grants can rewrite referenced provenance.
- Evidence/reproduction: Confirm the B3 exact write contract has operated successfully and reproduce the current excess effective grants from a fresh catalog comparison.
- Dependencies/prerequisites: B1 complete; B3 merged, deployed, and stable through natural jobs; fresh pre-change restore point; G0, G1, G2, G3, G5, G6; independent database-security review.
- Protected behavior: Every proven normal read/write remains available; immutable lineage and both leagues remain intact; application role stays non-owner/non-superuser; PUBLIC/default privileges remain minimal.
- In scope: Update the desired grant manifest/provisioning; revoke to a known baseline; grant only exact columns/functions/sequences; assert memberships, owners, default ACLs, schema/database rights, and security-definer posture.
- Excluded: Application feature code, scoring, retention policy, data rewrite/delete, provider/cron changes, and unrelated migration cleanup.
- Tests/evidence: B3 positive/negative suite under the final role; complete catalog/grant diff; compromised-runtime transaction cannot mutate protected history or cross league scope; natural current/future/observer/public reads remain healthy.
- Release checks: G0 through G6, including G4; exact deployment SHA; migration/catalog/grants/pointers/lineage/authorities/leases; both leagues; naturally scheduled jobs. Stop immediately on permission-denied normal work.
- Rollback/recovery: Use only the pre-reviewed narrow break-glass grant restoration necessary for the failed normal statement, then ship a forward correction. Never restore table-wide mutation casually or mutate historical rows.
- User decisions/authority: Explicit Neon permission-cutover and production release authority; named break-glass approver.
- Change matrix: Code Yes, provisioning/migration manifest only; Configuration Yes, production database grants; Billing No; Data Yes, schema/grant and migration-ledger metadata only, no business rows; Production Yes.
- Closure owner: Final owner of DB-001.
- Individual prompt:

> In a fresh isolated worktree, execute only B4 from docs/audits/2026-09-04-production-systems-audit-remediation.md after B3 is deployed and proven. Reproduce the excess grants, apply the reviewed exact grant manifest, and verify every normal path plus all denied mutations under the final runtime role. Do not change application features, scoring, retention, cron, provider settings, or business data. Require a fresh restore point and pre-reviewed narrow break-glass grants; open one privilege-only PR and do not merge, migrate, or deploy without explicit database and release authorization.

### C1 — Scoring disclosure option

- Findings: SCORE-001 — Contract conflict / High / High — Ten active Sleeper rules per league are excluded from projections.
- Evidence/reproduction: Independently compare current active Sleeper settings with the canonical supported map. Revalidate the original ten-rule observation; do not assume the list is still current.
- Dependencies/prerequisites: The user explicitly selects disclosure instead of the C2A → C2B coverage path; G0, G1, G3, G5; approved wording and accessible presentation.
- Protected behavior: Scorer, supported weights, model version, profile hashes, existing/current/historical snapshots, projected totals, APIs unless a backward-compatible optional disclosure field is approved, and both-league independence remain unchanged.
- In scope: Narrow the public promise and show a clear, current, accessible notice that projections use a supported subset; list or summarize active omitted rules from existing server-side scoring provenance through the canonical path; document what remains official versus projected.
- Excluded: Mapping new Tank01 fields, changing scoring/totals/model/revisions, rewriting snapshots, adding a second scoring pipeline, provider calls from the browser, or beginning C2A/C2B in the same unit.
- Tests/evidence: Production-like fixture with all ten originally observed rules; changed/empty/different per-league omissions; exact wording/accessibility; no disclosure when all active rules are supported; scorer golden totals and snapshot revisions unchanged; both leagues and G4.
- Release checks: G0, G1, G3, G4, G5; exact preview/production SHA; current active-rule comparison; both-league UI/API compatibility.
- Rollback/recovery: Revert the disclosure PR. No data rollback is needed because scoring and snapshots do not change.
- User decisions/authority: Explicit selection of disclosure and approval of user-facing wording. This plan does not choose this option.
- Change matrix: Code Yes, including docs/UI and only minimal backward-compatible metadata if approved; Configuration No; Billing No; Data No; Production Yes after release authorization.
- Closure owner: Final owner of SCORE-001 if disclosure is selected, visible, accurate, and approved. The C2A → C2B implementation path must not also run.
- Individual prompt:

> In a fresh isolated worktree, execute only C1 from docs/audits/2026-09-04-production-systems-audit-remediation.md after the user explicitly chooses disclosure. Reproduce the current unsupported active rules and add an accessible, current supported-subset disclosure through the canonical server/UI path while leaving the scorer, model, hashes, revisions, snapshots, and totals unchanged. Test the original ten-rule fixture, different per-league states, wording, and My Team/league switching. Open one disclosure-only PR; do not implement scoring coverage, map provider fields, rewrite data, merge, or deploy without authorization.

### C2A — Scoring-semantics proof for the coverage option

- Findings: SCORE-001 — Contract conflict / High / High — Ten active Sleeper rules per league are excluded from projections.
- Evidence/reproduction: Revalidate every currently active unsupported Sleeper rule, then prove Tank01 field/event semantics, units, precision, null/missing behavior, and single-event ownership for every candidate from authoritative provider documentation and sanitized samples from normal existing calls. Never infer a mapping from a field name. If any active rule cannot be represented without ambiguity or double counting, stop before implementation and return the scoring choice to the user.
- Dependencies/prerequisites: The user explicitly selects investigation of coverage instead of immediate C1 disclosure; A1 complete; G0, G1, G5; provider-documentation access and independent scoring review.
- Protected behavior: This unit is read-only. Sleeper remains scoring authority; the one normalizer/scorer, existing supported map, model version, projection totals, snapshots, requests, and both-league behavior remain unchanged.
- In scope: A rule-by-rule semantics and ownership matrix for all active unsupported settings; evidence quality, sample provenance, representability, precision, collision/double-count risk, and an explicit implement/do-not-implement conclusion for each.
- Excluded: Code/config/data change, provider diagnostic call, scoring estimate, partial implementation, guessed mapping, provider-plan/cadence change, and C1 disclosure implementation.
- Tests/evidence: Current settings for both leagues; authoritative field definitions; sanitized normal-call samples; missing/zero/fractional values; return versus offense/defense ownership; D/ST aggregation; duplicate event scenarios; a peer-reviewed conclusion that every active rule is either fully representable or blocks C2B.
- Release checks: G0, G1, G5; no preview, merge, or production release occurs. Record only sanitized evidence and leave every ambiguous case Unverified.
- Rollback/recovery: None; correct or retract the evidence record if later provider documentation contradicts it.
- User decisions/authority: Provider-documentation/read authority. After the result, the user must either approve the complete verified C2B contract or choose C1; the plan makes neither choice.
- Change matrix: Code No; Configuration No; Billing No; Data No; Production No, read-only evidence only.
- Closure owner: Supporting prerequisite only. It does not close SCORE-001, and C2B may start only if every active unsupported rule has an approved unambiguous representation.
- Individual prompt:

> In a fresh task, execute only C2A from docs/audits/2026-09-04-production-systems-audit-remediation.md after the user selects coverage investigation. Revalidate both leagues' active unsupported Sleeper rules and prove every Tank01 field's semantics, precision, missing behavior, and event ownership from authoritative documentation plus sanitized normal-call samples. Do not infer from names, make diagnostic provider calls, edit code/config/data, or implement partial coverage. If any active rule is ambiguous or unrepresentable, stop, leave SCORE-001 open, and return the C1-versus-no-change decision to the user.

### C2B — Verified scoring coverage implementation

- Findings: SCORE-001 — Contract conflict / High / High — Ten active Sleeper rules per league are excluded from projections.
- Evidence/reproduction: Reproduce the current unsupported-rule contract on current main and use only the complete peer-reviewed C2A semantics matrix. Independently verify that the approved mapping covers every currently active unsupported rule without duplicate event ownership before editing.
- Dependencies/prerequisites: The user explicitly selects the complete coverage contract instead of C1; C2A proves every active rule representable; A3B complete; G0, G1, G2, G3, G4, G5; approved model/version/compatibility contract; independent scoring review.
- Protected behavior: Sleeper remains scoring authority; one normalizer and one scorer; full precision; no return/offense/defense double count; immutable historical snapshots and old revisions remain readable; exact-week, bye, empty-slot, missing-projection, D/ST, live, and final behavior remain.
- In scope: Implement exactly the approved verified mappings in the canonical normalizer/scorer under a new explicit model/version; intentionally version scoring identity, cache, revision, and new immutable snapshots.
- Excluded: Partial or guessed coverage, disclosure as an afterthought, silent incomplete totals, historical rewrite, broad provider refactor, quota/cadence/plan change, schema/permission change, or a second scorer.
- Tests/evidence: Rule-by-rule golden player values and full-precision team totals; all active unsupported rules covered; missing/zero/fractional fields; duplicate-event ownership; returns/offense/defense; bye, empty slot, missing projection, D/ST/live/final; both leagues with equal/different hashes; old/new snapshot compatibility; sanitized real samples.
- Release checks: G0 through G5, including G4; exact preview and production SHA; supported A3B reserve and admission; independent review; approved canary/model selection; natural real-game follow-up in I1.
- Rollback/recovery: Revert model selection/code while preserving all immutable old and new snapshots. Never rewrite history. Restore the prior scoring model only through its existing compatible read path.
- User decisions/authority: Explicit approval of the complete semantics/version, changed projection totals, canary, and production release. This plan does not choose this option.
- Change matrix: Code Yes; Configuration No; Billing No; Data Yes, new versioned immutable snapshots only and no historical rewrite; Production Yes, scoring behavior changes.
- Closure owner: Final owner of SCORE-001 only when the user selected coverage and every active unsupported rule is verified, implemented, and released. C1 and C2B are mutually exclusive outcomes.
- Individual prompt:

> In a fresh isolated worktree, execute only C2B from docs/audits/2026-09-04-production-systems-audit-remediation.md after complete C2A proof, completed A3B with supported reserve/admission, and explicit user approval of coverage. Reproduce the contract, then implement exactly the approved mappings in the one canonical normalizer/scorer under a new model/version. Preserve historical snapshots and prevent event double counting. Run golden player/team, both-league, bye/empty/missing/DST/live/final, compatibility, quota, database-safety, and G4 checks. Open one scoring-only PR; stop rather than ship partial coverage, and do not merge, deploy, rewrite history, or change provider/cron/schema/settings without authorization.

### D1 — Reject contradictory provider game state

- Findings: PROVIDER-001 — Confirmed defect / Medium / High — Contradictory Tank01 fields can become a publishable clock.
- Evidence/reproduction: Reproduce the lossy conflict-versus-missing path and demonstrate a contradictory fixture becoming usable before editing.
- Dependencies/prerequisites: G0, G1, G3, G5.
- Protected behavior: Valid Q1–Q4, halftime, overtime, postponed, final, and absent optional fields; one clock-v1 implementation; last-known-good publication; no scoring/cadence/provider-request change.
- In scope: Carry explicit conflict state through normalization and reject/force unknown before status or halftime fallback.
- Excluded: Formula changes, scoring, cache, schedule authority, identity refactor, database schema, or provider traffic changes.
- Tests/evidence: Q2 plus alternate Q3 plus status Q1; two distinct opaque periods plus recognized status; conflicting clocks plus Halftime; valid full state matrix; no pointer movement on invalid input.
- Release checks: G0, G1, G3, G4, G5; exact preview/production SHA; both leagues; deterministic isolated contradiction fixtures prove no pointer movement, while natural logs are used only to confirm healthy operation and no regression. A naturally occurring contradiction is not required for release.
- Rollback/recovery: Reviewed code revert; last-known-good snapshots remain.
- User decisions/authority: Normal PR/release authority; no product decision.
- Change matrix: Code Yes; Configuration No; Billing No; Data Yes, prospective snapshot/current-pointer publication outcomes only and no schema or historical rewrite; Production Yes after release authorization.
- Closure owner: Final owner of PROVIDER-001.
- Individual prompt:

> In a fresh isolated worktree, execute only D1 from docs/audits/2026-09-04-production-systems-audit-remediation.md. Reproduce PROVIDER-001, preserve conflict separately from missing, and reject contradictions before fallback. Add the three named negative cases and the valid phase matrix while leaving clock-v1, scoring, cadence, identity, cache, database, and request counts unchanged. Open one narrow PR; do not merge or deploy without authorization.

### D2 — Align future cache and freshness scheduling

- Findings: FUTURE-001 — Confirmed defect / Medium / High — Future default-period cache can deterministically self-fail freshness.
- Evidence/reproduction: Reproduce prior success at 12:04:57, a warm one-hour cache, and a 13:00 due attempt returning an observation older than last_succeeded_at.
- Dependencies/prerequisites: A3B complete so request impact is measurable against a supported reserve and admission policy; G0, G1, G3, G5.
- Protected behavior: Database new-observation freshness remains strict; shared cache namespace/TTL and one-action-per-invocation remain unless a deliberate reviewed migration is selected; no cadence broadening, scoring change, or extra per-league calls.
- In scope: Schedule after cache expiry plus measured headroom or use an explicit fresh-ingest path; preserve failure/backoff and later materialization.
- Excluded: Relaxing database freshness, disabling cache globally, cron changes, quota-plan changes, scoring, or future-worker redesign.
- Tests/evidence: Exact warm-cache/prior-success reproduction; no stale success; first failure/backoff and recovery; before/after provider request counts; cold/warm and same-period sharing.
- Release checks: G0, G1, G3, G4, G5; exact preview/production SHA; supported A3B reserve and admission; both leagues; natural future results and unchanged cron.
- Rollback/recovery: Reviewed code revert; never relax the database freshness invariant as rollback.
- User decisions/authority: Approve the measured request-count effect if the fresh-ingest option is chosen.
- Change matrix: Code Yes; Configuration No; Billing No; Data Yes, prospective future observation/job/snapshot timing and publication only and no schema or historical rewrite; Production Yes after release authorization.
- Closure owner: Final owner of FUTURE-001.
- Individual prompt:

> In a fresh isolated worktree, execute only D2 from docs/audits/2026-09-04-production-systems-audit-remediation.md after A3B. Reproduce the warm-cache/prior-success failure, then align scheduling to expiry plus supported headroom or implement a deliberate fresh-ingest path with measured request counts. Never weaken database freshness, broaden cron/cadence, multiply per-league calls, or change scoring. Open one narrow PR and do not merge or deploy without authorization.

### E0 — Performance measurement instrumentation

- Findings: PERF-001 — Missing proof / Medium / High — Representative p95/p99 and burst capacity are absent.
- Evidence/reproduction: Reproduce on current main the absence or insufficiency of per-stage duration, request-unit, query-volume, and end-to-end correlation needed to measure the audited worker and reader paths. Inventory existing logs/metrics first and add nothing already available.
- Dependencies/prerequisites: A3A and B2 released and stable; G0, G1, G2, G3, G4, G5; approved non-private telemetry schema, retention, and owner; relevant generated Next.js documentation. Reuse A3A quota fields and correlation on the canonical path rather than creating duplicate provider instrumentation.
- Protected behavior: Timing thresholds, cancellation, leases, cadence, cache, query semantics, provider calls, scoring, publication, reader responses, and production workload remain identical. Instrumentation cannot become an admission dependency.
- In scope: Observation-only timers/counters on existing canonical paths for worker stages, A3A provider attempts/billed units, database query count/rows/bytes, cleanup, reader waits, and end-to-end lineage; correlation identifiers without league/member/player identity; and a checked-in deterministic load/fault tool that requires an explicit non-production base URL and isolated database fingerprint.
- Excluded: Duplicate quota capture or a second provider telemetry path; timeout/deadline/lease change; query or cache optimization; new provider call; production load generation; new monitoring vendor; private payload logging; schema/permission change; retention; or application behavior change.
- Tests/evidence: Deterministic clock fixtures; success/error/abort coverage; reuse of A3A absent/malformed header handling; correlation across due bucket → accepted observation → verified snapshot → browser adoption; silent secret/identity checks; load tool rejects localhost ambiguity and production fingerprints; before/after outputs prove request counts and results unchanged; one canonical quota event per existing provider response.
- Release checks: G0 through G5, including G4; exact preview and production SHA; both leagues; natural traffic proves bounded telemetry without latency/error/request-count regression. Do not generate production load.
- Rollback/recovery: Revert instrumentation/load-tool code through a reviewed PR; retain only sanitized aggregate evidence needed for comparison. No timing threshold is changed or restored.
- User decisions/authority: Approve telemetry fields, retention, observation owner, and production release. A new paid telemetry service or unexpected cost requires a new unit and approval.
- Change matrix: Code Yes, observation instrumentation and non-production load tooling; Configuration No; Billing No; Data Yes, aggregate non-private operational telemetry only; Production Yes, instrumentation release only.
- Closure owner: Supporting prerequisite for E1 and PERF-001; it closes no performance or timeout finding by itself.
- Individual prompt:

> In a fresh isolated worktree, execute only E0 from docs/audits/2026-09-04-production-systems-audit-remediation.md after A3A and B2 are released and stable. Reuse A3A quota fields and correlation on the canonical provider path; do not create duplicate quota instrumentation. Reproduce the remaining measurement gaps, add only missing bounded non-private instrumentation to existing worker/reader paths, and add a load/fault tool that refuses production and ambiguous targets. Prove timing, query, request, scoring, cache, lease, and response behavior are unchanged. Run G4 and secret-safe gates, open one instrumentation-only PR, and do not tune timeouts, add provider calls/vendors/schema, load-test production, merge, or deploy without authorization.

### E1 — Required pre-change performance baseline

- Findings: PERF-001 — Missing proof / Medium / High — Representative p95/p99 and burst capacity are absent.
- Evidence/reproduction: Replace A-only samples with a preregistered measurement method using released, stable E0 instrumentation and its checked-in tool. Measure current-worker stages, provider and database waits, cleanup, public readers, and 300-viewer steady/synchronized behavior before choosing any worker or reader deadline or compact-read optimization.
- Dependencies/prerequisites: E0 released and stable; G0, G1, G2, G5; approved SLO, sample method, and non-production load envelope. Production observation is natural and read-only; load generation targets Preview/isolated Neon only. E0 carries the required A3A prerequisite; E1 does not require A2 or A3B and cannot close OPS-001.
- Protected behavior: No timeout, lease, cadence, cache, query, provider, or production behavior changes in this unit; no unexpected quota consumption or production load.
- In scope: Define SLOs and sampling windows before collection; capture p50/p75/p95/p99, maximum, errors/timeouts, cold/warm state, provider attempts/billed units, database query count/rows/bytes, CPU/memory, throttle, and stage/end-to-end duration. Exercise 300 steady visible viewers and a synchronized minute boundary against Preview/isolated DB. Treat a percentile as Unverified when the comparable sample size is insufficient; never present a few healthy samples as p99.
- Excluded: Production load test, forced cron/provider call, timeout/cancellation change, query/schema optimization, retention, or tuning during measurement.
- Tests/evidence: E0 load/fault tool and fixture; clock-synchronized sanitized aggregates with no private payload; at least the predeclared comparable sample count and confidence statement; due bucket → accepted observation, accepted observation → verified snapshot, and verified snapshot → browser adoption. Capture a slow/never-settling fault-injection baseline in isolation.
- Release checks: G0, G2, G4, G5. Exercise G4 on Preview after load to prove state/isolation survived; observe production naturally and read-only; no repository merge or production release occurs in E1.
- Rollback/recovery: Stop the isolated load, preserve evidence, and remove only verified disposable test resources after confirming no other user. No runtime rollback applies.
- User decisions/authority: Approve SLOs, sample method, and Preview load envelope. Any unexpected cost stops E1 and requires a new approval. If evidence is not representative, E2, E3, and E4 remain blocked.
- Change matrix: Code No; Configuration No; Billing No; Data Yes, isolated synthetic test data only; Production No change, natural read-only observation only.
- Closure owner: Required support for WORKER-001, READER-001, and READER-002. PERF-001 closes only after E1 plus the applicable natural I1 tail evidence meet the preregistered method.
- Individual prompt:

> In a fresh task, execute only E1 from docs/audits/2026-09-04-production-systems-audit-remediation.md after E0 is released and stable. Predeclare the SLOs, sample size, and method, then use the E0 tool to collect representative worker/reader p50/p75/p95/p99 and 300-viewer steady/synchronized evidence against Preview and isolated Neon, plus natural read-only production observations. Do not edit code/config, load-test production, force cron/provider calls, tune timeouts, incur unexpected cost, or expose private payloads. If evidence is insufficient, retain PERF-001 as Missing proof and keep E2–E4 blocked; do not make an OPS-001 closure claim.

### E2 — Current-worker deadline and cleanup budget

- Findings: WORKER-001 — Operational risk / Medium / High — Current worker exceeds its platform proof envelope.
- Evidence/reproduction: Reproduce the 60-second function ceiling, 120-second lease, and absence of a whole-current-run budget. Use E1 tails to justify every stop-admission, abort, cleanup, and lease value.
- Dependencies/prerequisites: E1 complete and representative; G0, G1, G2, G3, G5; independent concurrency/operations review.
- Protected behavior: Ownership/generation/source/skew fences, current-over-future priority, partial-league isolation, last-known-good, and existing 503/result-count contracts remain.
- In scope: One request-lifetime signal; measured stop-admission and abort points with cleanup headroom below 60 seconds; propagation through provider/database work; lease completion/failure/recovery aligned with the measured budget.
- Excluded: Retention redesign, provider/cadence/quota changes, longer platform timeout, scoring, schema, or relaxed ownership.
- Tests/evidence: Slow and never-settling provider/DB; no new work after admission cutoff; abort before ceiling; bounded cleanup; lease expiry/replacement; stale owner cannot publish; partial fleet isolation; exact duration/request telemetry.
- Release checks: G0, G1, G3, G4, G5; exact preview/production SHA; E1 before/after comparison; natural cron durations and leases; unchanged cron definitions.
- Rollback/recovery: Reviewed code revert; stop new current work if platform kills recur; allow leases to expire naturally and prove stale owners cannot publish. Do not clear leases manually.
- User decisions/authority: Approve measured timing values and release. There is no performance-evidence exception for this unit because it changes timing constants. A purely mechanical signal refactor with no threshold/lease behavior change would require a separately justified unit.
- Change matrix: Code Yes; Configuration No; Billing No; Data Yes, prospective lease/job/completion/failure records only and no schema or historical rewrite; Production Yes after release authorization.
- Closure owner: Final owner of WORKER-001.
- Individual prompt:

> In a fresh isolated worktree, execute only E2 from docs/audits/2026-09-04-production-systems-audit-remediation.md after representative E1 evidence. Reproduce WORKER-001 and derive each admission, abort, cleanup, and lease value from the measured tails while remaining below the 60-second ceiling. Propagate one cancellation signal and preserve all ownership, skew, last-known-good, and partial-fleet contracts. Run slow/never-settling and lease-race tests, open one worker-only PR, and do not change retention, quota/cadence, scoring, schema, merge, or deploy without authorization.

### E3 — Public-reader cancellation and deadline

- Findings: READER-001 — Operational risk / Medium / High — Public Neon reads lack a backend deadline.
- Evidence/reproduction: Reproduce a never-settling reader/store wait and show that SSR fallback or API 503 cannot be reached. Use E1 reader/database tails to select a deadline.
- Dependencies/prerequisites: E1 complete and representative for the chosen value; G0, G1, G2, G3, G5.
- Protected behavior: One canonical reader/freshness policy; browser never accesses Neon/providers directly; SSR official-Sleeper fallback; API 503/no-store; existing status, revision, and cache semantics.
- In scope: Thread request abort and one measured compile-time code deadline through the canonical reader/store/database boundary.
- Excluded: Runtime/environment deadline configuration, new reader/cache, API body/status change, compact-query optimization, provider calls, polling interval, scoring, or schema.
- Tests/evidence: Never-settling and slow DB; request abort cancels backend; SSR reaches fallback; API returns 503/no-store; no late/stale adoption; both current and future paths.
- Release checks: G0, G1, G3, G4, G5; exact preview/production SHA; E1 before/after latency/errors; both leagues and revision/full fences.
- Rollback/recovery: Reviewed code revert. If the deadline rejects healthy tail traffic, revert the threshold while retaining safe request cancellation only if separately reviewed.
- User decisions/authority: Approve the evidence-sized deadline and production release.
- Change matrix: Code Yes; Configuration No; Billing No; Data No; Production Yes after release authorization.
- Closure owner: Final owner of READER-001.
- Individual prompt:

> In a fresh isolated worktree, execute only E3 from docs/audits/2026-09-04-production-systems-audit-remediation.md after E1. Reproduce the never-settling public Neon read, choose the server deadline from measured tails, and propagate request/server cancellation through the one canonical reader/store/database path. Preserve SSR Sleeper fallback and API 503/no-store plus all revision/cache contracts. Add abort/slow/never-settling and G4 tests, open one reader-only PR, and do not add a second reader/cache, optimize compact reads, merge, or deploy without authorization.

### E4 — Bounded compact revision read

- Findings: READER-002 — Operational risk / Medium / High — Revision polling repeats full JSON validation per viewer.
- Evidence/reproduction: E1 must show that recursive validation exceeds the approved SLO/cost threshold under steady or synchronized load. If it does not, do not start E4: either close through a formal evidence-based reclassification or leave READER-002 open with a named owner and review date. Risk acceptance alone is not closure.
- Dependencies/prerequisites: A documented E1 threshold breach; B1, B2, and B4 complete with an existing owner-controlled publication interface that can write the metadata without a new runtime grant; G0, G1, G2, G3, G4, G5; approved additive publication-metadata design and independent database/reader review.
- Protected behavior: One reader/publication path; exact revision/period/freshness validation; visible <=60-second cadence; hidden/completed stop; bounded 409 retry; stale league/week responses cannot overwrite current state.
- In scope: Add nullable payload-validation version/timestamp metadata to current_projection_snapshots, written only through the already EXECUTE-authorized owner-controlled fenced publication interface after full payload validation. Add no table/column/runtime grant. First release the writer and retain the old recursive fallback for null/unknown versions; after natural publications populate active pointers and evidence confirms parity, switch compact reads to current-pointer plus scalar snapshot metadata without traversing payload arrays. No historical snapshot is rewritten.
- Excluded: Any grant/default-privilege/membership delta, direct runtime column write, second reader, weakened payload/revision validation, polling-interval change, production load test, broad snapshot schema redesign, or opportunistic cache changes. If the existing interface cannot support the field without a permission change, stop and create a separate B1-gated permission unit.
- Tests/evidence: Old null/unknown validation version safely uses the recursive fallback; supported version is written only after complete validation and exact fenced pointer publication; invalid payload never receives an attestation; normalized before/after ACL diff is empty; compromised runtime cannot write the metadata directly; query plan is independent of payload arrays; 300 steady/synchronized viewers; database queries/rows/bytes and p50/p75/p95/p99 before/after; publication race; current/future/completed/hidden behavior; both leagues and G4.
- Release checks: G0 through G5; exact preview/production SHA; B1 catalog/restore gates; B4 exact-function/grant compatibility; phased writer-before-reader release; all active pointers naturally attested before fallback removal; E1 comparison; naturally observed errors/cost.
- Rollback/recovery: Revert readers/writers first. Leave unused additive schema until later reviewed cleanup; never drop it during an incident.
- User decisions/authority: Approve the breach threshold, additive migration/publication design, phased release, and production release. If E1 is acceptable, the user may approve an evidence-based reclassification; a time-bounded risk acceptance leaves the finding open.
- Change matrix: Code Yes; Configuration No; Billing No; Data Yes, additive current-pointer validation metadata only and no historical rewrite; Production Yes after release authorization.
- Closure owner: E4 closes READER-002 after a measured breach and successful bounded-read release. If no breach exists, only a documented evidence-based reclassification closes it; risk acceptance does not.
- Individual prompt:

> In a fresh isolated worktree, execute only E4 from docs/audits/2026-09-04-production-systems-audit-remediation.md only after E1 records an approved breach and B1/B2/B4 are complete. Add versioned validation metadata to the current pointer only through the existing owner-controlled fenced publication interface, with no ACL/grant delta or direct runtime column write. Release writer before reader, keep the recursive fallback for legacy/null versions, and prove the compact query is payload-size independent. Preserve every revision/period/freshness/race check; run isolated migration, empty-ACL-diff, 300-viewer, both-league, and G4 gates. Stop for a separate permission unit if a grant is needed; do not merge, migrate, or deploy without authorization.

### F0 — Retention policy and dry-run design

- Findings: RET-001 — Operational risk / Medium / High — Retention has no owner during future-only operation; RET-002 — Technical debt / Low / High — Retention has no complete multi-season policy.
- Evidence/reproduction: Reproduce lane-coupled, swallowed, sequential retention behavior on current main. Inventory every table, foreign-key/reference path, current/frozen/active authority, existing predicate/index, natural owner opportunity, and database write statement. Use B1 restore/schema/capacity-maintenance evidence and a preregistered isolated representative-volume batch benchmark before selecting retention limits.
- Dependencies/prerequisites: B1 complete; G0, G1, G2, G5, G6; user-approved per-table/per-season horizons, audit/legal exceptions, RPO/RTO, and ownership objective.
- Protected behavior: Current pointers, frozen baselines, active slate/materialization/lineup lineage, referenced observations, immutable release/audit evidence, both-league isolation, publication availability, and exactly one eventual retention owner.
- In scope: A documentation-only contract containing exact table predicates, protected reference sets, dependency/FK order, indexed bounded batch sizes, dry-run/result schema, deadline/resume/retry semantics, metrics, proposed existing-schedule admission point, canary bounds, and the exact future F1 interface/write-set/permission design.
- Excluded: Code/migration/grant/configuration change, new cron, deletion, production write, manual cleanup, ad hoc pointer repair, provider/scoring/cadence change, or an index not supported by B1 safe EXPLAIN without ANALYZE and isolated evidence.
- Tests/evidence: For every table, synthetic keep/delete/reference fixtures and expected dry-run counts; dependency-order simulation; p50/p75/p95/p99 and maximum batch/query timing against an isolated schema-matched dataset at least as large as current aggregate volume plus the approved growth margin; production SELECT-only aggregate counts/oldest-newest timestamps; proof that no current/frozen/active/referenced row matches. No row payload is retained and insufficient samples block F1/F2.
- Release checks: G0, G1, G2, G5, G6; documentation-only G3 if the design is committed. G4 is not applicable because no runtime or data change occurs.
- Rollback/recovery: Stop the isolated benchmark and remove only its verified disposable synthetic fixtures after evidence capture and no-user checks; revert the design document if needed. Any failed predicate or proof gap blocks F1/F2 and is never corrected by editing production data.
- User decisions/authority: Approve each horizon, exception, RPO/RTO, ownership design, isolated benchmark envelope, batch/canary bound, and recovery owner. Any unexpected cost stops the unit. Deletion authority is reserved for F2.
- Change matrix: Code No; Configuration No; Billing No; Data Yes, isolated synthetic benchmark data only; Production No, SELECT-only aggregate evidence only.
- Closure owner: Supporting prerequisite for RET-001 and RET-002; it closes neither finding.
- Individual prompt:

> In a fresh task, execute only F0 from docs/audits/2026-09-04-production-systems-audit-remediation.md after B1 and the user's horizon decisions. Reproduce the current retention ownership/timing defects and produce exact table predicates, reference protections, dependency order, bounded batches, dry-run schema, existing-schedule ownership, interface/permission design, and recovery/canary contract. Derive limits from a preregistered representative-volume isolated benchmark and use only SELECT aggregates in production. Do not edit code/migrations/grants/config, add cron, or delete/write production data; leave F1/F2 blocked on every unproved predicate or insufficient timing sample.

### F1 — Narrow retention database interface

- Findings: RET-001 — Operational risk / Medium / High — Retention has no owner during future-only operation; RET-002 — Technical debt / Low / High — Retention has no complete multi-season policy.
- Evidence/reproduction: Reproduce in isolated Neon that the existing runtime delete surface is broader and less bounded than the approved F0 write contract. Revalidate B1 catalog/restore evidence and B4 effective grants immediately before editing.
- Dependencies/prerequisites: F0, B1, and B4 complete; G0, G1, G2, G3, G5, G6; independent migration/database-security review; migration and exact permission authority.
- Protected behavior: All F0 protected rows; immutable migration history; runtime role remains non-owner/non-superuser; existing publication/reader/worker behavior; no production row is deleted in this unit.
- In scope: One forward-only additive owner-controlled database function/interface that enforces the exact F0 table allowlist, predicates, reference exclusions, batch cap, deadline, dry-run/delete mode, and aggregate result; exact EXECUTE/revoke/default-privilege updates for only that interface; caller contract types/tests. Production invocation remains disabled.
- Excluded: Scheduler/worker ownership code, new cron, retention enablement or canary, production delete, ad hoc SQL, broader grants, unrelated schema/index work, provider/scoring/cadence change, or historical rewrite.
- Tests/evidence: All F0 keep/delete/reference fixtures in isolated Neon; unauthorized table/predicate/batch/mode rejected; dry-run and delete counts reconcile; deadline/resume/idempotency; compromised runtime cannot bypass the interface or mutate protected history; final normalized schema/grant diff; G6 synthetic selective recovery.
- Release checks: G0 through G6, including G4 because production schema/permission state changes; exact preview/production SHA; isolated integration; fresh restore point; post-migration catalog/grants/lineage/pointers/authorities/leases; no production retention invocation.
- Rollback/recovery: Disable/revoke interface execution with the pre-reviewed forward change and revert callers if needed; leave safe additive schema until reviewed cleanup. No rows should require recovery because F1 performs no production deletion.
- User decisions/authority: Explicit migration, production schema/permission, and release authorization; named database reviewer and rollback owner.
- Change matrix: Code Yes, migration/interface contract only; Configuration Yes, production database permissions; Billing No; Data Yes, schema/grant/migration-ledger metadata only and no business-row deletion; Production Yes, database interface state only.
- Closure owner: Supporting prerequisite for RET-001 and RET-002; F2 owns operational closure.
- Individual prompt:

> In a fresh isolated worktree, execute only F1 from docs/audits/2026-09-04-production-systems-audit-remediation.md after F0/B1/B4. Add one owner-controlled retention interface enforcing exactly the approved tables, predicates, references, batch/deadline, modes, and aggregate result, with only exact permissions. Prove every negative and recovery case in isolated Neon. Do not add scheduler/cron code, enable or invoke production deletion, broaden grants, rewrite rows, merge, migrate, or deploy without separate database and release authorization. Open one database-interface-only PR.

### F2 — Retention owner and controlled enablement

- Findings: RET-001 — Operational risk / Medium / High — Retention has no owner during future-only operation; RET-002 — Technical debt / Low / High — Retention has no complete multi-season policy.
- Evidence/reproduction: Reproduce that the current business-lane tail step has no durable future-only owner, swallows failures, and performs sequential unbounded work. Reconfirm the exact released F1 interface and approved F0 predicates before editing.
- Dependencies/prerequisites: F1 released and stable; fresh G6 restore point/rehearsal; G0 through G6; explicit production deletion, dry-run window, batch, canary, and release authority.
- Protected behavior: All F0 protected rows; exactly one retention owner; publication continues when retention fails; current/future workers, scoring, projections, provider demand, cron declarations, and both-league behavior remain otherwise unchanged.
- In scope: Admit one bounded observable lifecycle-independent owner through an existing authenticated schedule; call only the F1 interface; durable attempts/retry/failure; dry-run first; approved tiny canary; aggregate metrics without row payloads; bounded deadline and resumable batches.
- Excluded: New cron or schedule change, migration/schema/permission change, direct SQL/delete bypass, unbounded/cascade/manual cleanup, pointer repair, provider/scoring/cadence change, or any table/predicate outside F0. Any need for one is a stop and a new unit.
- Tests/evidence: Future-only/preseason and current-lane-outage ownership; exactly one owner; dry-run/delete reconciliation; batch/deadline/resume/idempotency; durable failure without publication failure; all protected references survive; G6 accidental-deletion recovery; no extra provider calls or cron definitions.
- Release checks: G0 through G6, including G4; exact preview/production SHA; pre-enable restore point; approved production dry-run window; tiny bounded canary; post-state counts/catalog/lineage/pointers/authorities/leases; both leagues; named stop/recovery owner.
- Rollback/recovery: Disable only retention admission immediately and revert owner code. If any row was wrongly deleted, execute G6; a code revert does not restore data. Re-enable only a fixed exact SHA after dry-run and a new canary.
- User decisions/authority: Explicit production deletion, dry-run duration, canary bound, release, and recovery authorization.
- Change matrix: Code Yes, retention owner/caller only; Configuration No; Billing No; Data Yes, deletion only of user-approved expired production rows; Production Yes.
- Closure owner: Final owner of RET-001 and RET-002 after the dry-run/canary/recovery and natural future-only ownership evidence pass.
- Individual prompt:

> In a fresh isolated worktree, execute only F2 from docs/audits/2026-09-04-production-systems-audit-remediation.md after F1 is released, G6 is freshly rehearsed, and the user approves exact deletion/canary authority. Add one bounded observable owner through an existing authenticated schedule and call only the F1 interface. Prove future-only/single-owner/failure/batch behavior, release dry-run first, and use only the approved tiny canary. Do not add/change cron, migrations, grants, predicates, direct SQL, provider/scoring/cadence, merge, deploy, or delete production data without each named authorization. If deletion is wrong, stop admission and execute G6.

### CI1 — Stable CI workflow contexts

- Findings: CI-001 — Contract conflict / High / High — Protected branch does not enforce documented browser/preview gates.
- Evidence/reproduction: Revalidate current workflow job names and conclusions on an actual PR. First prove whether existing verify and browser-smoke contexts are already stable; make no workflow diff merely to populate this unit.
- Dependencies/prerequisites: G0, G3, G5; GitHub Actions read/write authority for a test PR.
- Protected behavior: Frozen dependency install, Node 24/pnpm 11.19.0, verify semantics, separate browser diagnosis, least workflow permissions, and docs-only PR compatibility.
- In scope: Repository workflow code only when needed to make deterministic verify/browser context names stable and truthful. Record the existing stable Vercel check name but do not configure it.
- Excluded: GitHub protection settings, isolated Neon automation, secrets, database access, dependency policy, Vercel settings, or app runtime code.
- Tests/evidence: Workflow syntax/action validation; successful and deliberately failed PR job; exact job/check names and app identities; browser job cannot be masked by verify.
- Release checks: G0, G3, G5. G4 is not applicable because no application release is made.
- Rollback/recovery: Revert workflow-only changes through a PR; retain the previous working workflow until replacement contexts are observed.
- User decisions/authority: Workflow PR authority. No repository-admin settings change is authorized.
- Change matrix: Code Yes on the remediation path, workflow only; Configuration No; Billing No; Data No; Production No application or control-plane change. If current contexts are already stable and truthful, record a no-change outcome instead.
- Closure owner: Supporting prerequisite for CI-001; CI2 and CI3 own remaining closure.
- Individual prompt:

> In a fresh isolated worktree, execute only CI1 from docs/audits/2026-09-04-production-systems-audit-remediation.md. Revalidate the existing verify and browser-smoke contexts on a real PR and make no diff if they are already stable and truthful. If needed, change only repository workflow code to stabilize those contexts and prove success/failure. Do not add isolated DB automation, edit GitHub protection, Vercel, dependencies, secrets, or application code. Open one workflow-only PR if a change is required and do not merge without authorization.

### CI2 — Path-aware isolated database CI automation

- Findings: CI-001 — Contract conflict / High / High — Protected branch does not enforce documented browser/preview gates.
- Evidence/reproduction: Show that persistence-affecting PRs lack a stable guarded isolated-DB status and that non-persistence PRs still need a stable not-applicable/success result if the context becomes required.
- Dependencies/prerequisites: B1, B2, and CI1; G0, G2, G3, G5; dedicated non-production Neon branch and narrowly scoped CI credentials.
- Protected behavior: Destructive integration can never reach production; every authorization, identity, sentinel, TLS, role, safe-name, and denylist guard remains; docs/non-persistence PRs are not blocked by a missing context.
- In scope: A separate path-aware workflow/status for persistence paths; guarded isolated branch setup/use/teardown; stable success/not-applicable reporting; least GitHub/Neon credential scope.
- Excluded: General verify/browser workflow changes, GitHub protection settings, production DATABASE_URL, production migrations/data, application behavior, or reusing Preview production-like credentials.
- Tests/evidence: Every guard negative; direct/pooled same-target rejection; production fingerprint denial; persistence path runs full isolated suite; non-persistence path reports not applicable with the same stable context; failed integration fails the context; credentials and row data suppressed.
- Release checks: G0, G2, G3, G5. The G4 My Team gate is not applicable. Observe the stable context on real persistence and documentation test PRs before CI3.
- Rollback/recovery: Disable the isolated job, revoke only its CI credentials, and delete only the verified disposable branch after identity/no-user checks. Revert the workflow through a PR.
- User decisions/authority: GitHub/Neon non-production secret and branch authority. Any unexpected CI/branch cost stops this unit and requires a new approval.
- Change matrix: Code Yes, dedicated CI workflow/harness only; Configuration Yes, non-production GitHub/Neon CI configuration; Billing No; Data Yes, destructive isolated test data only; Production No.
- Closure owner: Supporting prerequisite for CI-001; CI3 owns enforcement.
- Individual prompt:

> In a fresh isolated worktree, execute only CI2 from docs/audits/2026-09-04-production-systems-audit-remediation.md after B1, B2, and CI1. Add a separate stable path-aware isolated-Neon status that runs destructive integration only for persistence paths and reports not applicable/success otherwise. Preserve every identity/sentinel/TLS/role/denylist guard and use only narrowly scoped non-production credentials. Do not edit general CI, GitHub protection, production DB/config/data, or application behavior. Open one isolated-automation PR and do not merge or change control-plane settings without authorization.

### SC1 — Supply-chain workflow policy

- Findings: SUPPLY-001 — Technical debt / Low / High — Supply-chain policy lacks automated gates and immutable Actions.
- Evidence/reproduction: Reproduce mutable Action tags and absence of an enforced dependency review/audit policy. Revalidate current vulnerabilities and available patch drift; do not equate outdated with vulnerable.
- Dependencies/prerequisites: CI1 stable; G0, G3, G5; approved update/vulnerability policy.
- Protected behavior: Frozen pnpm lock install, least CI permissions, existing verify/browser semantics, and reviewable isolated dependency changes.
- In scope: Resolve each Action to a reviewed immutable commit SHA; add a truthful automated dependency-review/audit policy with explicit allow/risk-accept rules. Prefer enforcing it inside the already required stable verify context so no additional branch-protection setting is implied.
- Excluded: Bulk package upgrades, GitHub protection settings, isolated DB automation, app runtime changes, or automatic major updates.
- Tests/evidence: Upstream provenance for every pin; mocked advisory/policy-failing fixture that never installs, commits, or pushes a genuinely vulnerable dependency; clean exact-SHA path; production and full audits; updater PR behavior; no secret output.
- Release checks: G0, G3, G5. The G4 My Team gate is not applicable. Prove the policy blocks through the existing required context or record a separately reviewed future enforcement need.
- Rollback/recovery: Revert pins/policy through a PR to the last reviewed immutable set; never fall back to an unreviewed moving tag during an incident.
- User decisions/authority: Approve vulnerability severity/risk-acceptance and update cadence.
- Change matrix: Code Yes, workflow/policy files; Configuration No external setting in this unit; Billing No; Data No; Production No application/control-plane change.
- Closure owner: Final owner of SUPPLY-001 when the policy blocks through an already required context. If it instead needs a new standalone context, enforcement remains open for a separately reviewed protection unit.
- Individual prompt:

> In a fresh isolated worktree, execute only SC1 from docs/audits/2026-09-04-production-systems-audit-remediation.md after CI1. Reproduce SUPPLY-001, pin each Action to a reviewed SHA, and add the approved dependency-review/audit policy inside the existing required verify context when feasible. Prove failure with mocked advisory data—never a genuinely vulnerable installed/committed dependency—and prove a clean exact-SHA path. Do not bulk-upgrade packages, edit GitHub protection, isolated DB automation, or application code. Open one supply-chain-only PR and do not merge without authorization.

### CI3 — GitHub branch-protection enforcement

- Findings: CI-001 — Contract conflict / High / High — Protected branch does not enforce documented browser/preview gates.
- Evidence/reproduction: Freshly capture branch-protection JSON and rulesets. Verify stable app-bound names for verify, browser-smoke, and path-aware isolated DB. Require a Vercel context only after observing a stable success on deployable PRs and a truthful success/not-applicable result on documentation-only and other non-deployable PRs; otherwise leave Vercel unenforced and record the gap.
- Dependencies/prerequisites: CI1 and CI2 complete; G0; repository-admin authority. No protection change may precede the contexts it requires. SC1 is independent and is not a prerequisite.
- Protected behavior: Existing strict/head-up-to-date checks, linear history, conversation resolution, stale-review behavior, administrator enforcement, and force-push/delete denial remain.
- In scope: GitHub protection/ruleset configuration only, requiring verify, browser-smoke, and the path-aware isolated DB context; require Vercel Preview only if the evidence rule above passes. Do not add a separate supply-chain context when SC1 is enforced inside verify.
- Excluded: Workflow code, database automation, Vercel configuration, app code, merge, or bypassing protections.
- Tests/evidence: Deliberately failed and pending contexts block a disposable test PR; all-green exact-head contexts permit the normal path; docs/non-persistence PR gets stable DB not-applicable success; deployable and non-deployable Vercel context behavior is proved before any Vercel requirement; capture before/after JSON.
- Release checks: G0 and exact control-plane evidence. The G4 My Team gate is not applicable because no app release occurs.
- Rollback/recovery: Restore the captured prior protection JSON only if release is deadlocked by a misnamed/unavailable context, then correct the context and reapply through review. Never disable protections merely to merge.
- User decisions/authority: Explicit repository-admin configuration authorization.
- Change matrix: Code No; Configuration Yes, GitHub branch protection/rulesets; Billing No; Data No; Production Yes, production release-control plane only and no application deployment.
- Closure owner: Final owner of CI-001 jointly with CI1 and CI2 only when verify, browser, isolated DB, and a truthful preview gate are all actually enforced. If no stable Vercel/preview context exists, retain CI-001 open and propose a separate narrowly scoped context unit rather than requiring a broken check.
- Individual prompt:

> In a fresh task, execute only CI3 from docs/audits/2026-09-04-production-systems-audit-remediation.md after CI1 and CI2. Capture current protection JSON and require only proven verify, browser-smoke, and path-aware isolated-DB contexts. Require Vercel Preview only if it is stable on deployable PRs and truthfully succeeds/reports not applicable on documentation-only and other non-deployable PRs; otherwise record the gap, leave it unenforced, and keep CI-001 open. Preserve strict/admin/linear/conversation/force-push protections and prove failed/pending checks block a disposable PR. Do not edit workflows, databases, Vercel, app code, merge, or deploy; stop without explicit repository-admin authorization.

### H1 — Local browser-server provenance

- Findings: TEST-001 — Confirmed defect / Medium / High — Local Full Verify can test an unrelated server.
- Evidence/reproduction: Occupy the configured port with unrelated content and reproduce non-CI existing-server reuse against current main.
- Dependencies/prerequisites: G0, G3, G5.
- Protected behavior: Explicit BASE_URL Preview testing remains; default local Full Verify proves the current checkout/build; browser test semantics stay unchanged.
- In scope: Disable default unrelated-server reuse or require explicit opt-in plus unique port/exact build-SHA provenance; add a fail-fast negative.
- Excluded: Browser test feature expansion, CI protection, app runtime behavior, Vercel configuration, or production tests.
- Tests/evidence: Occupied-port/unrelated-content negative; stale checkout marker negative; normal local build positive; explicit BASE_URL positive; exact reported target provenance.
- Release checks: G0, G3, G5. G4 behavior is not applicable; no app release is needed.
- Rollback/recovery: Revert tooling-only PR.
- User decisions/authority: Normal tooling PR authority.
- Change matrix: Code Yes, local test tooling only; Configuration No; Billing No; Data No; Production No.
- Closure owner: Final owner of TEST-001.
- Individual prompt:

> In a fresh isolated worktree, execute only H1 from docs/audits/2026-09-04-production-systems-audit-remediation.md. Reproduce TEST-001 with unrelated content on the configured port, then make default Full Verify prove the current checkout/build while preserving explicit BASE_URL Preview mode. Add occupied-port, stale-checkout, local-positive, and Preview-positive tests. Do not change application runtime, CI protection, Vercel, database, or production. Open one tooling-only PR and do not merge without authorization.

### H2 — Doctor remote-evidence truth

- Findings: DOCTOR-001 — Confirmed defect / Medium / High — Doctor can label failed/redirected remote evidence healthy.
- Evidence/reproduction: Reproduce successful parsing being labeled healthy despite failed/wrong-SHA workflow and redirected/final-origin mismatch.
- Dependencies/prerequisites: G0, G3, G5.
- Protected behavior: Doctor remains read-only, never fetches secrets or invokes workers/providers, and unavailable evidence remains Unverified.
- In scope: Pure evaluators requiring successful exact-SHA workflow conclusion and expected final URL/origin/path without unexpected redirect; distinguish active, absent, failed, wrong SHA, and unavailable.
- Excluded: Fixing TEST-001, changing public routes, network retries that hide absence, Vercel/GitHub settings, or production.
- Tests/evidence: Successful exact SHA; failed exact SHA; wrong SHA; active only; absent; API unavailable; unexpected redirect/final origin/path; marker collision; redaction.
- Release checks: G0, G3, G5. G4 is not applicable.
- Rollback/recovery: Revert tooling-only PR.
- User decisions/authority: Normal tooling PR authority.
- Change matrix: Code Yes, Doctor tooling only; Configuration No; Billing No; Data No; Production No.
- Closure owner: Final owner of DOCTOR-001.
- Individual prompt:

> In a fresh isolated worktree, execute only H2 from docs/audits/2026-09-04-production-systems-audit-remediation.md. Reproduce DOCTOR-001 and extract pure evaluators that require successful exact-SHA workflow evidence and reject unexpected redirect/final URL/origin/path while reporting absent/active/failed/unavailable truthfully. Keep Doctor read-only and redacted. Do not change H1, public routes, GitHub/Vercel settings, database, or production. Open one Doctor-only PR and do not merge without authorization.

### I1 — Natural first-game and tail evidence

- Findings: LIVE-001 — Missing proof / High / High — Real 2026 transition/provider semantics remain unvalidated; PERF-001 — Missing proof / Medium / High — Representative p95/p99 and burst capacity are absent.
- Evidence/reproduction: Observe natural 2026 game windows only after A3A makes quota use visible from normal existing calls. Do not simulate production writes, add provider traffic, or burn quota for evidence. I1 may supply representative natural-burn evidence to A3B but does not need A3B to start.
- Dependencies/prerequisites: A3A released and stable; natural game window; G0, G1, G4, G5; read-only production-observation authority. No runtime remediation, A2, or A3B is an implicit prerequisite: observe the exact deployed SHA. If A3B is not complete, reserve and admission remain unverified and I1 cannot close OPS-001. Evidence may be credited to D1, D2, E2, E3, or another runtime unit only when that exact unit was already authorized, released, and named in the observation record.
- Protected behavior: Last-known-good on invalid input; current priority; exact period/source lineage; no forced work; both leagues; private identities and raw payloads excluded.
- In scope: Natural pregame → Q1 → quarter → halftime → second half → final; postponed/delayed/OT when naturally available; near-kickoff and future lineup changes; missing projection, empty slot, bye, D/ST, full-precision team sums; source skew; request units/cache/grouping; worker and browser lineage/adoption; representative tail durations.
- Excluded: Provider diagnostic call, authenticated forced cron, production data write, behavior tuning, synthetic production states, or declaring unobserved cases proven.
- Tests/evidence: Exact source/deployment SHA; authority and pre-state revision; non-secret provider remaining/reset; monotonic phase/clock; no publication on invalid input; observation → pending → materialization → acknowledgment; final official convergence; compact/full fence; G4; p50/p75/p95/p99 only with adequate samples.
- Release checks: Observation-only G0, G1, G4, G5; naturally scheduled results; no release.
- Rollback/recovery: None. Preserve sanitized evidence and open newly observed defects as separate findings; do not tune production inline.
- User decisions/authority: Read-only production observation authority. Any action needed to create a state is out of scope and requires a new decision.
- Change matrix: Code No; Configuration No; Billing No; Data No mutation, sanitized evidence record only; Production No change, natural read-only observation.
- Closure owner: Final owner of LIVE-001 for cases actually observed; joint with E1 for PERF-001. It may support A3B with natural-burn evidence but does not close OPS-001; unobserved cases and any absent reserve/admission proof remain Missing proof.
- Individual prompt:

> In a fresh task, execute only I1 from docs/audits/2026-09-04-production-systems-audit-remediation.md after A3A is released and stable and during a natural 2026 game window. Observe and correlate the full transition, lineup, missing/bye/empty/DST/team-total, quota, duration, lineage, browser, both-league, and G4 matrix without forcing cron/provider calls or writing production. Report only sanitized aggregates and exact SHAs. Natural-burn evidence may inform A3B, but absent A3B reserve/admission proof never closes OPS-001. Do not tune or fix anything; retain every unobserved case as Missing proof and file new defects separately.

### I2 — Historical release ledger closure

- Findings: LEDGER-001 — Missing proof / Low / High — PR5 durable production release record is incomplete.
- Evidence/reproduction: Reconstruct only immutable facts from authenticated GitHub PR/Actions and retained Vercel deployment history. Current health is not evidence of the historical release instant.
- Dependencies/prerequisites: G0; access to immutable historical records; factual peer review.
- Protected behavior: Existing historical entries remain factual and timestamp/SHA-specific; uncertainty stays visible.
- In scope: Commit, checks, preview/production deployment IDs and timestamps, source/root/branch, retained both-league observations, rollback disposition, and explicit Unverified fields.
- Excluded: Application/config/data change, invented timestamps, current-state inference, or rewriting history to look complete.
- Tests/evidence: Every SHA/URL/time cross-checked by a peer against its retained source; documentation links resolve; unavailable fields say Unverified.
- Release checks: Documentation-only G3; G4 is not applicable.
- Rollback/recovery: Documentation revert.
- User decisions/authority: Historical control-plane read access; no production authority.
- Change matrix: Code No; Configuration No; Billing No; Data No; Production No.
- Closure owner: Final owner of LEDGER-001.
- Individual prompt:

> In a fresh isolated worktree, execute only I2 from docs/audits/2026-09-04-production-systems-audit-remediation.md. Reconstruct the incomplete PR5 release record solely from immutable GitHub/Vercel history, cross-check every SHA/URL/timestamp, and label unavailable fields Unverified. Do not infer history from current health or change application/configuration/data. Open one documentation-only PR, obtain factual peer review, and do not merge without authorization.

### J1A — Legacy environment ownership and consumer inventory

- Findings: ENV-001 — Operational risk / Low / High — Legacy suspected secret remains a broad Config variable.
- Evidence/reproduction: Freshly determine whether each named candidate has a source, generated client/server bundle, build configuration, deployment integration, runtime-log name reference, external automation, or documented human/operator consumer. Report only approved names, scopes, owners, and status—never values or value-derived fingerprints.
- Dependencies/prerequisites: G0, G5; Vercel read authority and human owner/consumer coordination.
- Protected behavior: All environment values and service credentials remain untouched; cron authentication, build, fallback, provider/database access, and both leagues remain unchanged.
- In scope: A read-only names/scopes/owner/consumer/expiry inventory; silent repository and generated-artifact checks; explicit conclusions of required, unowned, or proven-unused per environment.
- Excluded: Viewing/copying/comparing values, configuration/source change, deployment, rotation/revocation, bulk cleanup, or declaring unused solely because repository search is empty.
- Tests/evidence: G5 silent scan; generated client and server artifacts; workflow/build/integration references; control-plane names/scopes; documented external and human-owner attestation; no credential or private runtime payload in evidence.
- Release checks: G0 and G5 only; G3/G4 are not applicable because nothing changes or releases.
- Rollback/recovery: None; correct or retract the inventory if a consumer is later identified.
- User decisions/authority: Human owners decide whether a non-repository consumer exists. Any unresolved consumer leaves J1B/J1C blocked.
- Change matrix: Code No; Configuration No; Billing No; Data No; Production No, read-only metadata only.
- Closure owner: Supporting prerequisite for ENV-001; it does not close the finding.
- Individual prompt:

> In a fresh task, execute only J1A from docs/audits/2026-09-04-production-systems-audit-remediation.md. Inventory the candidate environment names/scopes/owners and all repository, generated-artifact, build, integration, automation, runtime-name, and human consumers using G5-silent checks. Never reveal, copy, compare, fingerprint, rotate, revoke, or remove a value. Produce a read-only per-environment conclusion and leave every unresolved consumer blocking; do not edit or deploy anything.

### J1B — Preview legacy-variable retirement

- Findings: ENV-001 — Operational risk / Low / High — Legacy suspected secret remains a broad Config variable.
- Evidence/reproduction: Use J1A to confirm the exact Preview-scoped candidate is proven unused and separately revalidate Preview consumers immediately before removal.
- Dependencies/prerequisites: J1A complete with no unresolved Preview consumer; G0, G3, G4, G5; explicit Vercel Preview configuration authority; secure recovery source owned outside logs/artifacts.
- Protected behavior: Production variables and values remain untouched; Preview build, cron authentication where applicable, fallback, provider/database separation, and both-league behavior remain.
- In scope: Remove only the approved candidate name from Preview scope, then rebuild/redeploy Preview naturally and observe it for the approved window.
- Excluded: Production configuration, source change, value viewing/copying, rotation/revocation, bulk cleanup, required-variable rename, other candidates, or production deployment.
- Tests/evidence: Before/after name/scope metadata; exact Preview SHA; successful build; intended Preview database fingerprint; relevant auth metadata; both leagues and full G4; G5 artifact scan; approved observation window with no missing-variable error.
- Release checks: G0, G3, G4, G5 on the exact Preview SHA; no production release.
- Rollback/recovery: Restore only that proven-required Preview variable from the secure owner at minimum Preview scope, never from logs or this plan; repeat G4 and artifact checks.
- User decisions/authority: Explicit removal of the named Preview variable and observation window; no Production or rotation authority is implied.
- Change matrix: Code No; Configuration Yes, Vercel Preview variable only; Billing No; Data No; Production No.
- Closure owner: Supporting prerequisite for ENV-001; J1C owns final production closure.
- Individual prompt:

> In a fresh task, execute only J1B from docs/audits/2026-09-04-production-systems-audit-remediation.md after J1A proves the exact Preview candidate unused and the user authorizes its removal. Remove only that name from Preview, never view/copy its value, and verify the exact Preview SHA, isolated DB fingerprint, build, auth metadata, both leagues, G4, and G5 through the approved observation window. Do not edit code, touch Production, rotate/revoke anything, or bulk-clean variables. Restore only from the secure owner if a real consumer appears.

### J1C — Production legacy-variable retirement and credential disposition

- Findings: ENV-001 — Operational risk / Low / High — Legacy suspected secret remains a broad Config variable.
- Evidence/reproduction: After J1B's observation window, freshly confirm the exact Production-scoped candidate has no source, deployment, automation, runtime, or human consumer and classify whether the underlying credential is still live without revealing or comparing its value.
- Dependencies/prerequisites: J1A and J1B complete and stable; G0, G3, G4, G5; explicit authorization for the named Production variable removal; secure credential owner; separate explicit rotation/revocation authorization when applicable.
- Protected behavior: All other Production variables, minimum scopes, cron authentication, provider/database access, fallback, deployment SHA, and both leagues remain unchanged.
- In scope: Remove only the approved unused name from Production. If the secure owner confirms it represents a live credential, execute only the separately approved rotation or revocation and update only already-approved consumers through their secure managers; record names/scopes/status, never values.
- Excluded: Source change, value viewing/copying/comparison, bulk environment cleanup, unrelated credential rotation, required-variable rename, provider plan/database change, or production deployment beyond the configuration-triggered rebuild.
- Tests/evidence: Before/after name/scope metadata; secure-owner disposition; exact Ready Production SHA/source binding; successful build/redeploy if triggered; natural cron-auth result; both leagues and full G4; G5 artifacts; approved observation window.
- Release checks: G0, G3, G4, G5; exact production source/SHA and both leagues; no unrelated Vercel, provider, database, or schedule setting changes.
- Rollback/recovery: If the variable is proven required, restore only the named item from its secure owner at minimum scope and repeat release checks. A revoked credential is replaced through the secure issuer, never recovered from logs or this plan.
- User decisions/authority: Exact Production variable removal and observation authority; separately name the credential rotation/revocation action and owner. Removal authorization alone does not authorize rotation or revocation.
- Change matrix: Code No; Configuration Yes, the named Production variable and separately approved credential disposition only; Billing No; Data No; Production Yes, configuration/credential state only.
- Closure owner: Final owner of ENV-001 after consumer proof, Preview observation, authorized Production retirement, credential disposition, and production checks all pass.
- Individual prompt:

> In a fresh task, execute only J1C from docs/audits/2026-09-04-production-systems-audit-remediation.md after stable J1A/J1B evidence and exact user authorization. Reconfirm the named Production variable is unused, remove only it, and rotate/revoke an underlying live credential only when that separate exact action is authorized by its secure owner. Never reveal/copy/compare values or bulk-clean. Verify the exact Ready SHA/source binding, natural auth, both leagues, G4, and G5; do not edit code or touch unrelated Vercel/provider/database/schedule state.

### J2 — CSP report-only characterization

- Findings: SEC-001 — Technical debt / Low / High — CSP and avatar-origin containment are absent.
- Evidence/reproduction: Revalidate current headers and actual required framework, font, image, and avatar origins on both leagues.
- Dependencies/prerequisites: G0, G1, G3, G4, G5; relevant generated Next.js documentation; approved Preview observation window.
- Protected behavior: All routes/assets, responsive/mobile layout, dark mode, managers/transactions, cache/fallback headers, and approved avatars remain functional.
- In scope: A report-only CSP on the exact Preview SHA and a sanitized violation/origin compatibility matrix. Characterize avatar origins without recording identity-bearing URLs.
- Excluded: Production enforcement, broad unsafe directives, new reporting vendor, avatar proxy/allowlist enforcement, or unrelated security headers.
- Tests/evidence: Both leagues; manager/roster/transactions/week navigation; framework scripts/styles/fonts/images; phone/desktop; G4; violation classification and required-origin justification.
- Release checks: G0, G1, G3, G4, G5; Preview only. No production release.
- Rollback/recovery: Remove/revert the report-only header if it disrupts Preview diagnostics.
- User decisions/authority: Approve Preview report-only observation. J3 requires a later explicit enforcement decision.
- Change matrix: Code Yes, report-only header/diagnostics; Configuration No; Billing No; Data No private data, sanitized violation aggregates only; Production No, Preview only.
- Closure owner: Supporting prerequisite for SEC-001; J3 owns final closure.
- Individual prompt:

> In a fresh isolated worktree, execute only J2 from docs/audits/2026-09-04-production-systems-audit-remediation.md. Revalidate current origins, add a report-only CSP for Preview, and produce a sanitized compatibility matrix across both leagues, assets, mobile/desktop, managers/transactions, and G4. Do not enforce in production, add a reporting vendor, proxy/restrict avatars, or alter unrelated headers. Open one report-only PR and stop after Preview evidence; do not merge/deploy to production without authorization.

### J3 — CSP and avatar-origin enforcement

- Findings: SEC-001 — Technical debt / Low / High — CSP and avatar-origin containment are absent.
- Evidence/reproduction: Use J2 to justify each directive/origin. Revalidate that approved avatar origins are bounded and no required asset needs an unjustified broad exception.
- Dependencies/prerequisites: J2 complete; explicit enforcement approval; G0, G1, G3, G4, G5; independent security review.
- Protected behavior: All J2 behavior, accessibility, cache/fallback, and identity privacy remain.
- In scope: Enforce the reviewed CSP and restrict avatar loading to the exact static origin allowlist proven by J2; use no broad unsafe exception without written review.
- Excluded: Avatar proxy, new endpoint/vendor/service/configuration, new cost, authentication change, unrelated header hardening, or identity-bearing logs. If J2 shows an allowlist is insufficient, stop and create a separate proxy design/authority unit.
- Tests/evidence: Clean report-only window; enforced Preview suite; rejected unapproved origin; approved avatar rendering; both leagues/mobile/G4; no secret/PII leakage.
- Release checks: G0, G1, G3, G4, G5; exact preview/production SHA; clean observation window; both leagues and headers.
- Rollback/recovery: Header/allowlist code revert; keep a tested previous policy ready. Do not disable unrelated protections.
- User decisions/authority: Explicit production enforcement of the exact directives/origin allowlist. A proxy/cost/privacy decision is out of scope and requires a new unit.
- Change matrix: Code Yes; Configuration No; Billing No; Data No private data; Production Yes.
- Closure owner: Final owner of SEC-001 jointly with J2.
- Individual prompt:

> In a fresh isolated worktree, execute only J3 from docs/audits/2026-09-04-production-systems-audit-remediation.md after J2 and explicit user approval. Enforce only the CSP directives and static avatar-origin allowlist justified by report-only evidence, with no broad unsafe exception or identity-bearing logs. Run both-league, mobile, asset, rejected-origin, security-header, and G4 checks. Stop and request a separate unit if a proxy, service, configuration, or cost is needed. Open one enforcement-only PR and do not merge or deploy without security review and release authorization.

### K1 — Triggered league-aware kicker slate coverage

- Findings: KICKER-001 — Technical debt / Low / High — Slate trust omits the K category.
- Evidence/reproduction: Confirm current configured leagues still have no K before doing anything. If no K activation is proposed, leave this unit dormant and make no change.
- Dependencies/prerequisites: Explicit approved K roster/provider-support proposal; G0, G1, G3, G4, G5; must complete before K activation.
- Protected behavior: No-K leagues retain current provider requirements, scoring, snapshots, totals, cache/revision, and missing-projection behavior; one canonical normalizer/scorer.
- In scope: Derive required slate categories from league roster use and require K/PK coverage only for K-enabled leagues.
- Excluded: Enabling a K roster, changing K scoring weights, requiring K for current no-K leagues, provider-plan/cadence changes, or a second scorer.
- Tests/evidence: Both current no-K configurations unchanged; K-enabled complete coverage; zero/partial K truncation fails closed; player/team golden totals; bye/missing/final/exact-week isolation.
- Release checks: G0, G1, G3, G4, G5; exact preview/production SHA if released; both no-K leagues unchanged.
- Rollback/recovery: Reviewed code revert before any K activation; do not activate K while coverage is absent.
- User decisions/authority: Explicit K activation and provider-support decision. No current work is recommended.
- Change matrix: Code Yes only when triggered; Configuration No; Billing No; Data No historical rewrite; Production Yes if the preparatory code is released.
- Closure owner: Final owner of KICKER-001 only when triggered; otherwise retained technical debt.
- Individual prompt:

> In a fresh task, execute only K1 from docs/audits/2026-09-04-production-systems-audit-remediation.md only if the user has approved a K roster/provider-support proposal. First confirm current leagues remain no-K; otherwise make no change. Add league-aware K/PK slate coverage in the canonical path while preserving every no-K behavior, then test complete/partial/absent K, totals, bye/missing/final, both leagues, and G4. Do not enable K, change scoring weights, add provider traffic, merge, or deploy without separate authorization.

### K2 — Triggered provider-scoped identity migration plan

- Findings: ID-001 — Technical debt / Low / High — Legacy UUID seed is not provider-scoped.
- Evidence/reproduction: Confirm Sleeper remains the sole official provider. If no second official provider is approved, leave this unit dormant. When diversification is approved, inventory every identity seed, stored/reference column, external mapping, API/cache key, immutable lineage consumer, and cross-league boundary before proposing implementation.
- Dependencies/prerequisites: Explicit approval to evaluate a named second official provider; G0, G1, G2, G5; B1 catalog evidence; independent identity/database review.
- Protected behavior: Existing UUIDs and immutable historical lineage remain readable and stable; Sleeper authority is unchanged by planning; provider/resource/kind and league scope remain distinct; no production state changes.
- In scope: A documentation-only, versioned migration plan split into independently authorized compatibility-schema, writer, backfill, dual-read, validation, cutover, provider-authority, and cleanup units, each with collision fixtures, restore/reconciliation, rollback, cost, data, and release gates.
- Excluded: Code/migration/config/provider/billing/data/production change; second-provider activation; historical UUID/snapshot rewrite; credential acquisition; opportunistic cleanup; or treating this plan as execution authority.
- Tests/evidence: Proposed two-provider same-opaque-ID collision matrix; complete dependency/reference inventory; deterministic/restartable additive mapping design; zero-dangling/cross-provider/cross-league acceptance criteria; old/new read compatibility; G4 and isolated restore gates assigned to future units.
- Release checks: Documentation-only G3; G0, G1, G2, G5. No preview/runtime deployment, migration, provider connection, or production release occurs.
- Rollback/recovery: Documentation revert. Future implementation must use forward compatibility and must never recover by rewriting historical IDs.
- User decisions/authority: The user must separately approve the provider, commercial terms, authority model, detailed migration plan, and each future configuration/data/release unit. None is granted here.
- Change matrix: Code No; Configuration No; Billing No; Data No; Production No, documentation plan only.
- Closure owner: K2 does not close ID-001. It creates the required future implementation work order; ID-001 remains technical debt until those separately approved units pass.
- Individual prompt:

> In a fresh isolated worktree, execute only K2 from docs/audits/2026-09-04-production-systems-audit-remediation.md only after the user approves evaluation of a named second official provider. Confirm present authority, inventory every identity/reference consumer, and write a separate versioned migration plan broken into compatibility-schema, writer, backfill, dual-read, validation, cutover, authority, and cleanup units with collision/restart/restore/G4 gates. Do not write application code or migrations, connect a provider, change configuration/billing/data/production, rewrite history, merge, or implement anything. Leave ID-001 open.

## 6. Closure map

| Finding | Closure owner and rule |
|---|---|
| OPS-001 | A1 + a defensibly proved current or post-A2 capacity state + sufficient A3A evidence + A3B only when the supported reserve and measured admission are genuinely demonstrated. A2 is needed only if a capacity change is required; a precautionary upgrade, A3A alone, risk acceptance, or any Missing proof leaves OPS-001 open. |
| TANK-002 | A1 owns account/application/subscription/environment attestation; A3A owns normal-call reset/header/billing/endpoint-weight evidence. Any unobserved element stays Missing proof; A3B cannot manufacture or close an absent telemetry fact. |
| DB-PROOF-001 | B1 only, including timed isolated restore and synthetic selective recovery. |
| PREVIEW-001 | B2 only. |
| DB-001 | B3 is compatible preparation; B4 closes after exact-grant production verification. |
| SCORE-001 | Exactly one user-selected outcome: C1, or C2A followed by C2B. If neither ships, the finding remains open; risk acceptance is not closure. |
| PROVIDER-001 | D1 only. |
| FUTURE-001 | D2 only. |
| PERF-001 | E0 instrumentation, E1 pre-change evidence, and I1 natural evidence; insufficient samples remain Missing proof. |
| WORKER-001 | E2 only, after E1. |
| READER-001 | E3 only, after E1. |
| READER-002 | E4 when the approved threshold is breached. Without a breach, only formal evidence-based reclassification closes it; risk acceptance leaves it open. |
| RET-001, RET-002 | F0 design + F1 narrow database interface + F2 owner/enablement after B1/B4 and approved horizons/recovery. |
| CI-001 | CI1 + CI2 + CI3, including an enforceable truthful preview gate. Workflow code, DB automation, and protection settings are never one unit; an unavailable preview context leaves the finding open. |
| SUPPLY-001 | SC1 when its policy blocks through an existing required context; a new standalone context needs a separate future protection unit. |
| TEST-001 | H1 only. |
| DOCTOR-001 | H2 only. |
| LIVE-001 | I1 only for naturally observed cases; remaining cases stay Missing proof. |
| LEDGER-001 | I2 only. |
| ENV-001 | J1A inventory + J1B Preview proof + J1C separately authorized Production retirement/disposition. |
| SEC-001 | J2 evidence then J3 enforcement. |
| KICKER-001 | K1 only when triggered; otherwise intentionally retained. |
| ID-001 | K2 creates a future migration work order when triggered but does not close the finding; otherwise it remains intentionally retained. |

## 7. Recommended first action

After this corrected plan is reviewed, execute A1 and nothing else: freshly establish what can be proved about the non-secret Tank01 account/application/subscription relationship, current quota, safely exposed reset/weight facts, and current raw scheduled-demand envelope. Retain unavailable reset/weight facts as Missing proof, then return only supportable cost/capacity options to the user for the A2 decision. Do not make a provider call, promise sustainability, or change a subscription merely to complete the proof.
