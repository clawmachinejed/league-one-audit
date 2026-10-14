# CP17 draft selections candidate

## Scope and authority — October 14, 2026

CP17 authors exact **2026 Sleeper draft selections** through the existing adapter, administration writer, immutable capture lineage and stored readers. It does not include CP18 traded-pick ownership or future-pick traversal, or CP19 ordinary DATA intake/refresh scheduling. CP1/CP2 and their operating targets remain unchanged. The source work is based on the accepted CP16 candidate `46edac981968a07b92e53202a330fb0436be47a8`; canonical local/GitHub `main` and production were independently reconciled to `87da4d0cb909ee280e125e73ad10e1c3dbd7cd9f` before implementation, with Vercel deployment `8C3YSnXRCbmPETftQgRtirfyck5e` bound to the canonical repository, `apps/site` root and `main` production branch.

Local authoring, ordinary branch publication, a draft pull request and its preview are authorized. No paid SQL run, provisioning, credential retrieval or rotation, retained migration installation, DATA activation, merge or production release is authorized. A later qualification attempt would require separate authorization for one final immutable SHA; the proposed fixed 0.25 CU and $1 ceiling do not themselves grant that authority. No automatic retry is allowed.

## Accepted CP16 dependency overlay — October 14, 2026

CP16 at exact source `46edac981968a07b92e53202a330fb0436be47a8` passed all **8/8 collected, selected, executed and passed cases**, with zero skips, filters, retries, repeats or unhandled errors, in [run 38604592993](https://github.com/clawmachinejed/league-one-audit/actions/runs/38604592993). Actual PostgreSQL **18.6 (c021049) / 180006** was observed **before test launch**. Independent review accepted the source-bound SQL evidence under `DATA-CP16-2026-10-14-QUALIFIED-SQL-EVIDENCE-REVIEW` and the cleanup/version timing under `DATA-CP16-2026-10-14-46EDAC9-CLEANUP-VERSION-TIMING-REVIEW`. The supervisor lifecycle was **124,134 ms**. Acknowledged child closure, schema cleanup, credential revocation and child deletion were independently accepted; a fresh inspection separately confirmed child absence.

This dated overlay is the CP17 dependency status, also tracked in [PR 306](https://github.com/clawmachinejed/league-one-audit/pull/306). Earlier CP16 plan, README and ledger statements that call earlier source or stages unqualified remain historical records and are not rewritten. The accepted CP16 run does not qualify CP17, authorize another run, or prove live provider parity, operating capacity, sustained freshness or production readiness.

## Four scope fields

1. **Data resource:** exact 2026 native draft selections, including native pick identity/order, supplied player and roster identity, keeper evidence, field presence and retained raw values. Native observations remain authoritative; missing, null, invalid and complete-empty states are distinct.
2. **Existing path:** `sleeper.ts:getOfficialDraftAdministration` with the explicit `selectionsOnly` option and existing bounded transport → existing administration normalization plus `aggregator/draft-selections.ts` projection → the shared administration writer and resource attempt/receipt/acceptance lineage → additive `054_draft_selections.sql` typed persistence → `neon/draft-selections.ts:readDraftSelections` current/exact-receipt reads. The existing store exposes only the matching optional reservation/read methods and disabled no-I/O fallback. This increment adds no provider feed, worker, scheduler, publication pipeline or browser acquisition path.
3. **Persisted result:** immutable native capture evidence and typed selection facts, stable native pick identities, separate source order, capture-specific player-link evidence and independent acquisition/acceptance clocks. Corrections, removals, equal-content captures and unresolved-to-resolved directory links must retain prior receipt history; partial, failed, malformed, capped and contradictory attempts must preserve the last accepted head.
4. **Real proof and gaps:** independent preimplementation scope confirmation is recorded under `DATA-CP17-2026-10-14-IMPLEMENTATION-SCOPE` and `DATA-CP17-2026-10-14-QUALIFICATION-SCOPE`. Local targeted checks passed **266/266 tests across eight files**, zero failures/skips, plus nonincremental TypeScript checking and scoped lint; after the fixture EOF whitespace correction and repin, **104/104** profile checks passed again. PGlite **0.5.8 / PostgreSQL 18.3** reran the exact corrected fixture in attempt 05: all eight actual bodies passed with **356 passing body assertions**, 54 migrations and three role scripts; `afterAll` passed. The unchanged `beforeAll` LOGIN assertion fails under embedded `SET ROLE` with `session_user = postgres`, so this is not a hosted profile pass. The [dated evidence](data-backend-evidence.md#cp17-draft-selections-authored-candidate-and-proof-boundary--october-14-2026) retains exact source/report bindings and limitations. Final independent review binding and exact-source complete verification remain pending. CP17 has no hosted restricted-LOGIN PostgreSQL qualification, live-provider parity, retained installation, ordinary intake/refresh, independent-session contention, process-death/restore, natural cadence or capacity evidence.

## Closed qualification contract

The existing collector makes one catalog GET and at most eight picks GETs under one original twenty-second deadline. CP16 metadata-only and omitted-option legacy behavior remain separate and preserved; traded picks are unrequested. Shared response limits remain **8 MiB decoded body, 250,000 values and depth 64**, with an **8 MiB aggregate retained native-body** allowance. The selection projection has a **10,000-row structural limit**. The independent **32 MiB submission/read budget** includes native and projected values, mapping and provenance, and reserves **8 MiB for frozen link evidence**, **64 KiB fixed framing**, plus per-entry framing of **1,536 bytes + twice the JSON byte length of the native league ID + twice the JSON byte length of the native draft ID**. SQL uses conservative expanded JSON text; TypeScript uses compact JSON. A capture below the structural row limit can still exceed this byte budget: refusal is atomic, creates no new receipt or accepted head, and preserves last-good state. The reader omits redundant scalar values from its selected native-field objects and reconstructs them from typed columns. These source bounds do not prove worst-case SQL latency, capacity or complete ordinary intake coverage.

Diagnostic duplicate, invalid and contradictory selection rows retain their supplied native roster field without creating or linking a canonical season-team identity. Only a valid native selection identity can establish that scoped team reference; neither current ownership, manager identity nor draft-slot arithmetic supplies it. Frozen player mapping validity uses the existing PostgreSQL microsecond convention and retains original proof timestamp spelling.

The single manual profile is `data-draft-selections-v1`, selecting `integration/draft-selections.integration-case.ts` and the suite `official draft selections through restricted PostgreSQL`. The stable fixture normalized-LF SHA-256 is `50b1fedb499982b4b6fd4fee3b49ba4c54fe0a3ac34b92c4f8c049e48fa82eb1`. The validator binds the exact source digest, names/order, anchored selector, chronological execution, one suite, one `beforeAll`, one `afterAll`, immutable report and acknowledged global cleanup. Expected collected/selected/executed/passed inventory is **8/8/8/8**, with zero skips, filters, retries, repeats or unhandled errors. Default non-live discovery increases from 64 to 65 modules; older fixture bytes, pins, workflow choices and guards stay unchanged.

| Order | Exact case name |
| ---: | --- |
| 1 | stores native selections and source ordering through fixture HTTP and restricted stored readers |
| 2 | preserves optional field states complete empty keeper evidence and legacy draft compatibility |
| 3 | retains duplicate contradictory malformed capped and failed captures without replacing last good selections |
| 4 | retains corrected removed equal and replayed selections with stable native pick identities |
| 5 | freezes unresolved directory conflict and later resolved player links without rewriting history |
| 6 | rejects out of order foreign remapped and forged selection submissions |
| 7 | rolls back expired reservations and deferred changed or equal commits under original twenty second fences |
| 8 | denies direct typed mutations private helpers and history edits while reads remain provider free |

Case 7 is bounded sequential expiry/deferred-commit evidence under the original twenty-second fence. It does not claim independently observed lock contention or CP23 concurrency qualification. The narrowing retains the already confirmed expired-fence scope; final independent source review remains pending.

The narrowed case is the CP17 expired-fence/commit boundary; it does not weaken the underlying lock or commit checks for compatibility with an embedded test engine. Final independent source review must verify that the original deadline is checked after blocking locks and again before commit. CP23 broader contention evidence remains separate.

| Authored allowance | Minutes | Boundary |
| --- | ---: | --- |
| Eight 60-second cases and two 120-second hooks | 12 | Selected suite |
| Global setup, migrations and runtime-role provisioning | 8 | Within work deadline; no hosted execution authorized |
| Reporting and global teardown | 3 | Within work deadline |
| Remaining work margin | 7 | Within work deadline |
| **Total work envelope** | **30** | Unchanged hard limit |
| Supervisor cleanup reserve | 10 | Separate reserve; 40-minute lifecycle |
| CI overhead reserve | 10 | Outside lifecycle; 50-minute CI limit |

These allocations are planning ceilings, not measured runtime or a guarantee of fit. The original twenty-second worker fence, identity/TLS/role/sentinel/denylist guards, immutable checkout, PostgreSQL-version observation before test launch, protected credential, serial workflow, cleanup requirements and no-retry behavior remain unchanged. The workflow adds only one literal manual choice and fixed existing supervisor command; authoring it never dispatches a run.

## Exact-path review boundaries

`DATA-CP17-2026-10-14-QUALIFICATION-SCOPE` covers the new fixture, qualification profile and adverse offline tests, the literal workflow choice/command, this plan, the manifest, integration README and dated evidence appendix. `DATA-CP17-2026-10-14-IMPLEMENTATION-SCOPE` covers the specifically recorded selection projection/reader, opt-in existing adapter/store/writer additions, additive migration, matching source tests and fresh-role parity. These are preimplementation scope confirmations by independent nonauthor GPT-6 Astra ultra reviewer `/root/authority_scope`; they are not final source acceptance or evidence that SQL was installed or executed. Exact application paths and objective proof are recorded in `data-backend-scope.json` as the implementation is finalized.

`DATA-CP17-2026-10-14-IDENTITY-HISTORY-SCOPE` separately confirms the narrow shared-core dependency in additive `054_draft_selections.sql`: replace the existing `public.upsert_scoring_entity_identities(jsonb)` body only to prevent its orphan delete from removing canonical identities referenced by immutable draft-selection links, with an indexed history guard and foreign key. The existing signature, security, locking and other behavior are preserved; migration 042 and `identities.ts` remain untouched. Required proof includes a real directory remap followed by owner cleanup and exact old-receipt reads, genuine unreferenced orphan cleanup and CP6 controls. Authoring that guard is not SQL proof.

Local completion, branch publication, preview readiness, merge state, production state, actual check totals and skips remain separate evidence fields. Final candidate SHA, exact-source verification reports and resulting publication/preview status are bound externally in the candidate pull request and retained evidence, avoiding a self-referential source hash here. No status is inferred from an authored test or a preserved predecessor hash.
