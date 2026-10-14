# CP18 traded-pick ownership candidate

## Scope and dependency — October 14, 2026

CP18 stores traded-pick ownership and uncertainty from the **2026** Sleeper source context. Future pick years remain scalar references without another season, enrollment or acquisition. Frozen CP1/CP2 are unchanged. CP19 ordinary intake/refresh/recovery is separate. Source authoring, local verification and ordinary draft publication/preview are authorized; paid SQL, credentials, provisioning, retained migration installation, DATA activation, merge and production release are not.

The accepted CP17 dependency is exact `2145f695ffd5df33da0467c16c3ce6b4c7279064`, [PR307](https://github.com/clawmachinejed/league-one-audit/pull/307), [run 38617162716](https://github.com/clawmachinejed/league-one-audit/actions/runs/38617162716): **8/8** collected/selected/executed/passed, zero skips/filters/retries/repeats/errors, genuine restricted LOGIN, PostgreSQL **18.6 / 180006** durably observed before launch, and all cleanup independently accepted under `DATA-CP17-2026-10-14-QUALIFIED-SQL-EVIDENCE-REVIEW`. This dated dependency overlay preserves earlier pending records. Consumed CP17 authority grants no CP18 run.

Before authoring, local/GitHub `main` and Ready Current production reconciled to `87da4d0cb909ee280e125e73ad10e1c3dbd7cd9f`; Vercel remained bound to `clawmachinejed/league-one-audit`, root `apps/site`, production branch `main`. Work is isolated on `codex/data-traded-pick-ownership` from the accepted CP17 SHA. No competing CP18 owner was observed; no production release ownership is claimed.

## Four scope fields

1. **Data resource:** native `season`, `round`, original `roster_id`, `owner_id`, `previous_owner_id`, unknown fields and native row order. The [league](https://docs.sleeper.com/#get-traded-picks) and [draft](https://docs.sleeper.com/#get-traded-picks-in-a-draft) traded-pick endpoints remain independent sources. Missing/null/invalid and complete-empty stay distinct.
2. **Existing path:** `sleeper.ts:getOfficialDraftAdministration` explicit `tradedPicksOnly` → unchanged administration normalizer plus `aggregator/traded-picks.ts` → sole administration writer/resource attempts, receipts, acceptances and heads → additive `055_traded_pick_ownership.sql` → `neon/traded-picks.ts` current/exact-receipt reader. Optional store methods and fresh-runtime grants extend the existing owner. No new feed, worker, cache, scheduler, directory prerequisite or UI; metadata-only, selections-only and omitted legacy behavior are preserved.
3. **Persisted result:** stable assets keyed by 2026 league/source, endpoint and native pick-year/round/original-roster tuple. Every native row remains immutable by ordinal, including exact duplicates. Complete trustworthy captures advance independently of owner resolution: current owner can be resolved/unknown/conflict; previous-owner evidence has its own state. Agreeing current owners remain resolved when only previous owners disagree. Ambiguous owners do not create a canonical current owner. Neither array order, manager/slot/selection nor previous-owner relations manufacture a chronological chain. Empty means no traded rows supplied, never presumed ownership reversion. Corrections/removals/equal/replay preserve exact receipt history; partial/malformed/failed/capped and invalid-scope captures preserve the last complete head.
4. **Real evidence and gaps:** nonauthor `/root/cp18_scope_review` independently confirmed exact paths under `DATA-CP18-2026-10-14-IMPLEMENTATION-SCOPE` and `DATA-CP18-2026-10-14-QUALIFICATION-SCOPE`. Actual local SQL evidence is below. Final source review, complete verification, branch/PR/CI/preview and final SHA are bound externally; authored tests and predecessor hashes do not establish hosted CP18 qualification.

## Closed seven-case qualification contract

`data-traded-picks-v1` selects `integration/traded-picks.integration-case.ts`, suite `official traded picks through restricted PostgreSQL`, normalized-LF SHA-256 **`34b3aa905c84eb9eaa13108363be3a2258773190cf1638826f37042be611d68c`**. Seven risk groups form the sufficient inventory; no inherited eight-case quota is used.

| Order | Exact case name |
| ---: | --- |
| 1 | stores endpoint scoped native ownership and future references through fixture HTTP and restricted readers |
| 2 | advances fresh conflict and unknown evidence while preserving field states duplicates and previous owner ambiguity |
| 3 | retains corrections removals equal observations replay and native ordering with stable scoped asset history |
| 4 | retains failed partial malformed capped and oversized evidence without replacing complete endpoint heads |
| 5 | rejects out of order foreign remapped and forged ownership submissions |
| 6 | preserves legacy metadata selections and original twenty second reservation and commit fences |
| 7 | denies direct typed mutations private helpers and history edits while reads remain provider free |

Expected collected/selected/executed/passed is **7/7/7/7**, zero skips/filters/retries/repeats/errors, one completed `beforeAll`/`afterAll` pair. Source bytes, exact names/order, anchored selection, chronological execution, immutable report and acknowledged cleanup are required. Default non-live inventory increases 65→66; predecessor fixtures/pins remain unchanged. A manual choice is not execution authority.

Seven **60s** bodies plus two **120s** hooks allow **11 minutes**. Planning allocations reserve 8 minutes setup/migrations/roles, 3 minutes reporting/cleanup and 8 minutes margin inside the unchanged **30-minute work** limit. **40-minute lifecycle**, **50-minute CI**, fixed **0.25 CU**, no retries and existing identity/TLS/role/sentinel/denylist/version/cleanup guards remain. A future **$1** single-attempt ceiling is only a proposal pending final immutable SHA and separate authorization. These allocations do not guarantee fit or billing.

## Bounds and compatibility

One original **20-second** deadline covers league GET → catalog GET → reservation callbacks and at most 8 catalog-owned draft GETs, **10 total attempts**. Each endpoint retains its own clock; complete league evidence can advance despite catalog/draft failure. Catalog accounting distinguishes known overflow totals and invalid/unrequested/failed siblings. Future-year references cannot construct endpoints.

Existing bounded transport is **8 MiB decoded body / 250,000 values / depth 64** per response and **8 MiB aggregate retained native bodies**. Downloaded/decoded bytes can exceed retained allowance before retention refusal. Ownership projection bounds rows at **10,000**. A separate **32 MiB** persistence/read budget counts native+projected values, mapping/provenance, **64 KiB** fixed framing, and per-entry **2,048 bytes + twice encoded league ID + twice encoded draft ID**. SQL uses conservative expanded JSON; TypeScript uses compact JSON. Structural success can still exceed persistence budget: refusal is atomic, preserving head/history. These source limits do not establish measured capacity.

The existing `drafts` family carries the explicit endpoint wrapper. No normalizer/shared-lineage change or old migration edit. Migration055 delegates after prior job/source/legacy lock ownership, checks the original fence after resource locking, and reuses CP17 deferred receipt/acceptance fence triggers covering all drafts resources. Typed deferred lineage and immutable-child guards enforce commit parity. New clock comparisons retain microseconds, with ≤6 fractional digits, hours 00–23 and offsets through 15:59. Account/auth provisioners remain unchanged.

## Local SQL evidence boundary

Offline PGlite **0.5.8 / PostgreSQL18.3** executed 55 migrations and all 3 role provisioners. Initial smoke exposed the new wrapper's default PUBLIC EXECUTE; source055 now revokes it and the unchanged account-role guard passed. Independent probes reproduced nonobject field-state differences and clock-grammar discrepancies; narrow CP18 repairs passed all 8 malformed-row comparisons and supported/unsupported clock boundaries.

Full local attempt01 passed **7 bodies / 398 body assertions**, with 259 bound source files unchanged, zero provider network, and local wrappers/engine closed. The original deferred-fence body took 20.254 seconds. The unchanged required `beforeAll` LOGIN assertion correctly fails under embedded `SET ROLE` with `session_user=postgres`; **profilePass=false**. The final fixture removes only an unused type import after attempt01. Final-source local evidence and check totals are retained externally, without weakening assertions or rewriting failed evidence.

This is not hosted restricted LOGIN/TLS, independent-session contention, external disposable-child cleanup, live provider parity, CP19 ordinary intake/refresh/recovery, sustained freshness/capacity, process-death/restore, retained installation or production readiness. Local completion, publication, CI/preview, hosted SQL pending, merge and production are reported separately.
