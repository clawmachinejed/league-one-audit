# Backend decisions selected under delegated authority

The user explicitly delegated the outstanding decisions in this continuing backend-planning task. The exact instruction and machine-readable choices are in [backend-decisions.json](backend-decisions.json). These choices supersede the earlier open D03–D05 dispositions; the original approval history remains byte-preserved. D02 remains3,600 seconds and not deployed. Nothing here claims that the target is implemented or authorizes production deployment.

Owner names below are accountable engineering roles. The lead engineer owns assignment and closure; no claim is made that a separate staffed on-call team already exists.

## D03 — Exclusive-claim conflict and recovery

**Owner:** Account/security owner. **Implementation gate:** BC-M1.

No automatic displacement. An authenticated actor may release their own association after fresh login (validated session creation age <= 5 minutes at command admission; ordinary activity does not refresh it). Conflicts expose no competing actor. A dispute creates a private operator case; reassignment requires incumbent authenticated release or independently verified provider-control proof through an implemented, reviewed provider-authentication mechanism. Sleeper username lookup, screenshots, public team details and commissioner status are not proof. Because the current adapter has no such proof mechanism, unsupported disputes remain locked; support cannot override based on discretion.

**Reason and consequence:** Accept inconvenience in unsupported disputed cases to avoid account takeover. Initial Sleeper association remains explicitly user-asserted; this does not add provider authentication to the current slice.

**Required evidence:** Race two claims; stale recovery and release receipts; spoofed public evidence; operator attempts without approved proof; retry and incumbent-session revocation. Exactly one active association; no competing identity leaked.

## D04 — Follow intention and effective demand

**Owner:** Account/domain owner. **Implementation gate:** BC-M1.

Store explicit actor/stable-league follow intention independently of access. Expiry, proven membership loss or disconnect suspends effective following, private serving and its ordinary collection demand; it does not rewrite the preference. Fresh qualified membership under an active association resumes only still-current explicit follow intention. Explicit unfollow wins by revision and never resurrects. Renewal carries intention only under the existing qualified predecessor/successor rules.

**Reason and consequence:** A returning manager need not re-follow; retained intention alone grants neither access nor permission. Disconnect ends association authority; only separately valid shared demand may keep collection alive.

**Required evidence:** Exercise every commit order of loss, regain, disconnect, reassociation, renewal and unfollow, including A-B-A associations. Revalidate private output and effective demand independently.

## D05 — Zero-demand collection and retention

**Owner:** Worker/data lifecycle owner. **Implementation gate:** BC-M1.

Routine demand is the union of eligible explicit follows, authorized visible-view leases and explicit existing registry obligations. Recovery/import jobs authorize only their bounded purpose; they never reset the zero-routine-demand cooldown or restart ordinary polling. View leases last120 seconds and are renewed by active authorized viewing. After30 minutes with zero effective demand stop routine league polling. Ineligible retained follows permit independently authorized recovery at most hourly for 7 days after first loss; failures do not restart the 7-day clock. Then pause until a new authenticated recovery demand. Disconnect is not a recovery credential. Last-follower departure never deletes shared accepted history or frozen baselines.

**Reason and consequence:** Bounds cost without making user absence erase history. Existing named-league operational obligations remain until explicitly retired. Long-term shared storage has a measured cost and disposal policy under ENG08.

**Required evidence:** Virtual-clock tests at all boundaries; multiple managers and seeds; crash/retry; stale lease; failure resetting loss clock; no deletion or unauthorized recovery after disconnect.

## ENG01 — One transaction owns command authority

**Owner:** Data/security owner. **Implementation gate:** BC-M1.

The account transaction that commits a mutation or final read acquires the auth advisory gate and actual admission/user/session row locks through public.lock_account_session_authority_v2(jsonb), before account/domain locks. Its nine-field ephemeral server receipt binds actual session token and admitted email by SHA-256 digests. Mandatory guards cover legacy direct DML and identity bootstrap as well as new commands. No receipt is logged, queued, cached or public.

**Reason and consequence:** Coordinator death cannot release authority locks while a separate account transaction later commits. Exact helper, writer inventory, lock order and privileges are in the relational/security designs.

**Required evidence:** Kill coordinator/auth bridge; delete/recreate session IDs; change email/config/token; direct DML; bootstrap races; SQL role catalogue and deadlock tests in isolated harness.

## ENG02 — Durable command admission and provider limits

**Owner:** Worker/platform owner. **Implementation gate:** BC-M1.

Admit authorized identify/discover/recover demands and idempotent receipts atomically into the existing job owner. Return private pending handles; workers receive scoped immutable demand, never session receipts. Aggregate actual HTTP starts across every process, host alias, fallback, retry and cache revalidation. Use conservative61-second charged permit windows with <= 1-second dispatch deadline for the 900-per-60-second policy; late permits cannot dispatch and are not refunded.

**Reason and consequence:** Existing scheduler and shared transport remain owners. Per-actor abuse limits and fair reserved lanes prevent one actor/import from consuming live-score capacity. Pending is an honest result, not failed identity or a fabricated empty list.

**Required evidence:** Concurrent multi-instance starts and expired permits; crash before/after dispatch; rate-limit responses; retry waves; future/import coexistence and originator identity forgery.

## ENG03 — Live freshness and capacity

**Owner:** Worker/SRE owner. **Implementation gate:** BC-M4.

Target500 distinct simultaneously watched Sleeper leagues. Live-score scheduling45 seconds; normal acceptance/publication <=5 seconds p95; visible stored-data observer10 seconds. Additional League One score delay target p95<=60 seconds and p99<=75 seconds, measured end to end.900 actual starts/rolling60 seconds; reserved grant lanes680 scores,55 roles/rosters,100 transactions,20 administration,15 interactive,15 import/future,15 retries. Roles600 seconds; transactions310 seconds; settings/directory3600 seconds. Global provider concurrency32; HTTP deadline5 seconds. Select Render Background Worker as the planning execution host, using the same Node worker and existing durable jobs; no new queue. Region, instance sizing, service authority, total cost and standby qualification precede provisioning.

**Reason and consequence:** These are selected targets, not observed performance. Score throughput barely fits and is not a proof of total workload capacity. Existing minute-only scheduling cannot meet45 seconds; select a continuous run mode of the existing worker with one fenced owner per lane, preserving jobs/scoring/normalization/publication. No second acquisition pipeline.

**Required evidence:** Full mixed workload, actual start census, provider latency distribution, observer jitter, DB contention, cold starts, failover, overload, unfairness, both named-league cadences and all future work. Do not advertise500 until BC-M4 passes.

## ENG04 — Season discovery, imports and corrections

**Owner:** Adapter/data owner. **Implementation gate:** BC-M2.

Discovery uses provider NFL league_season, its prior 2 seasons and retained current selections as an explicit finite set. Follow verified previous_league_id links with cycle detection, resumable checkpoints and explicit coverage; no universal-history assertion. For each enrolled current season import every published applicable competition period and remaining published schedule, not a fixed1-14/1-15 range. Preserve official/provider/local finality separately; corrected official results append new versions and re-evaluate dependent derived views without changing frozen pregame baselines.

**Reason and consequence:** Unqueried, unavailable or unsupported periods remain visible coverage states. Year changes do not auto-select, auto-follow or establish renewal. Existing named-league historical boundaries are compatibility constraints, not global discovery truth.

**Required evidence:** Late renewals, different portfolio years, loops, missing predecessors, week0, postseason/multiweek periods, partial schedules, corrections after final, restart and replay.

## ENG05 — Provider qualification and licensing

**Owner:** Adapter/product owner. **Implementation gate:** BC-M4.

Sleeper alone is implemented. Require source-family semantics, stable identities, exact scope/audience, completeness and permission evidence for each supported feature. Official-data support and analytics support are independent. Before commercial activation obtain documentary license/terms authority and qualified quota; Sleeper docs currently describe free non-commercial use and contacting them for commercial licensing. Future Yahoo/ESPN adapters are BC-M6 with their own permissions and qualification, not shipped capability.

**Reason and consequence:** Public accessibility is not a license or a completeness guarantee. No outbound contact, contract, purchase or new provider credential is performed by this plan. Missing external authority is a release gate with a named owner.

**Required evidence:** Evidence receipt for license/quota, independently retained provider fixtures, schema-drift corpus, authorized acquisition and no-permission tests, official-score parity.

## ENG06 — Reliability ownership and recovery

**Owner:** SRE/release owner. **Implementation gate:** BC-M4.

Select a rolling28-day99.9% valid authorized stored-read success objective, p95 server latency<=500ms and p99<=1500ms under the qualified workload. Track freshness separately; fail-closed authorization and truthful stale status remain invariant. Commit RPO0 for acknowledged commands under single-process failure; regional database disaster target RPO<= 5 minutes/RTO<=60 minutes, subject verified service capability and restore rehearsal. Worker-owner failover target<=30 seconds.

**Reason and consequence:** Targets are engineering acceptance criteria, not purchased service guarantees. Keep overall and dependency-attributed error reports; never remove provider failures from the headline denominator to manufacture success. Error-budget exhaustion freezes ordinary rollout.

**Required evidence:** Restore to isolated environment, backup access/retention check, job replay, lost acknowledgement, connection exhaustion, deployment rollback, dead worker, stale authority, dependency outage and post-incident review.

## ENG07 — Incremental coexistence and release

**Owner:** Release/data owner. **Implementation gate:** BC-M5.

Additive migration and internal service first; shadow interpretation reuses captured source and the same normalizer/scorer rather than duplicate acquisition. Migrate caller groups only after their contracts, source coverage, authorization and SQL tests pass. Preserve existing routes/fallbacks/caches and both named leagues until explicit qualified cutover. Every release checks main/source binding/exact production SHA and one observable release owner, with reversible flags and exact rollback artifact.

**Reason and consequence:** No big-bang rewrite, arbitrary conflict winner or unattended destructive cleanup. Schema contraction and old-path removal require a separate proven compatibility window and explicit destructive authorization where applicable.

**Required evidence:** Duplicate-claim/identity census; old/new parity; forward/backward migration rehearsal; actual-role harness; complete repository verification; independent review; actual Vercel preview; exact merged-SHA production and both leagues.

## ENG08 — Privacy, provenance retention and disposal

**Owner:** Data/security owner. **Implementation gate:** BC-M4.

Diagnostic events retain at most 7 days. New restricted security-case/operator records retain 90 days; existing append-only identity audit and immutable provenance are excluded from this generic timer and remain under their established reference/retention rules. Delete unreferenced raw captures after 30 days; keep referenced evidence, normalized official history, scoring versions and frozen lineage while any supported view/audit/reproduction obligation depends on it. Content-addressed unchanged payloads deduplicate; freshness receipts never fabricate new source time. Account deletion revokes sessions/associations immediately, removes personal preferences and direct identifiers within 30 days after applicable hold review, preserving pseudonymous shared competition facts where allowed.

**Reason and consequence:** No production deletion is authorized here. Retention timers, holds, backup expiration and reference closure must be implemented and tested before sweeps. Provider terms and applicable privacy obligations must be documented before commercial launch; no legal compliance certification is asserted.

**Required evidence:** Reference-closure sweeper fixtures, legal/contract hold record, actor deletion/export across every store/cache/audit, backup expiry reconciliation, diagnostic redaction and malicious cross-actor export.

## Sources and methodology boundaries

The database stages and reviewed ERD/DDL artifacts use [Database Design, second edition, Chapter 13](https://opentextbc.ca/dbdesign01/chapter/chapter-13-database-development-process/). Security decisions are risk-tailored against [NIST SSDF1.1](https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-218.pdf) and selected [OWASP ASVS5.0.0](https://github.com/OWASP/ASVS/tree/v5.0.0/5.0/en) requirements. These are design references, not a claim of formal certification.

Service indicators, objectives and a release error-budget policy follow the approach in [Google SRE: Implementing SLOs](https://sre.google/workbook/implementing-slos/); queue bounds and shedding follow [Handling Overload](https://sre.google/sre-book/handling-overload/). The numerical objectives above are League One engineering choices, not numbers prescribed by those books.

[Sleeper API documentation](https://docs.sleeper.com/) was checked October 6, 2026 UTC. Its under 1,000 calls/minute guidance is neither a contractual quota nor a service guarantee; the 900 ceiling leaves margin and all commercial authority remains a documented activation gate.
