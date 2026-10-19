# CP28 lossless storage design

Status: independently reviewed design, October 19, 2026. **Implementation and capacity fit are unproved; CP28 remains INCOMPLETE / CAPACITY UNQUALIFIED.**

## Decision and scope

Keep the existing 10-GiB planning ceiling, 16 distinct 2026 leagues, freshness targets and retention of every accepted observation, correction and required provenance through at least March 31, 2028, without automatic expiry. Develop two incremental storage changes inside the existing writers and readers: share identical resolved roster-link content, then factor repeated immutable capture evidence. Do not claim that either change, or both together, fits the complete workload until measured.

The user approved this design continuation after the local measurement/retention report at `c92dc0722fff8761a06da6c35b7dcd121748467e`. This document defines a reviewable implementation plan; it does not apply migrations, change runtime, access private Neon capacity/billing, provision a database or authorize a hosted run. No budget increase or reduced collection frequency is selected.

| Scope field | This increment |
| --- | --- |
| Data resource | Retained current-roster identity links and repeated capture/acceptance evidence; all other families remain in the capacity denominator. |
| Existing path | Sleeper capture → existing administration writer and SQL acceptance trigger → immutable stored roster/official readers. |
| Persisted result | This source-bound design and evidence-ledger links, in the existing isolated CP28 worktree. |
| Real proof and gaps | Accepted original PostgreSQL measurement, offline table attribution, current source review and prior local retention proof. No new schema, storage-saving measurement, full-workload forecast or freshness qualification. |

The primary checkout, local `origin/main`, fresh GitHub `main` and Ready Vercel production `8C3YSnXRCbmPETftQgRtirfyck5e` were revalidated at `87da4d0cb909ee280e125e73ad10e1c3dbd7cd9f`. Vercel's source remains `clawmachinejed/league-one-audit/tree/main/apps/site`, production branch `main`. PR318 remains draft/open/unmerged at `168a856ae44e7431393b0a8a9404483dda294ccc`. The local design starts from clean `c92dc07`; its application/migration bytes equal `168a856`. No release ownership is claimed.

## What the original measurement actually attributes

The source is the accepted [run 39323139287](https://github.com/clawmachinejed/league-one-audit/actions/runs/39323139287), original companion SHA-256 `73668875846572a703d5667877e5d715062e82e098b6e0988510f28d123c96c5`, and the [verified extraction](data-backend-cp28-measurement.json). The unchanged batches contain 32 fresh core captures, four typed receipts per core, two leagues and 160 held players per league. Attribution below divides their combined physical deltas by 32.

| Disjoint observed component | Bytes/core | Same 591,728-event sensitivity, GiB |
| --- | ---: | ---: |
| Roster-link group | 140,288 | 77.311 |
| Generic capture receipts | 14,336 | 7.900 |
| Resource attempts | 3,584 | 1.975 |
| Resource acceptances | 1,024 | 0.564 |
| Official-standings capture records | 1,280 | 0.705 |
| Shared allocation without new shared rows | 2,048 | 1.129 |
| **Core DATA total** | **162,560** | **89.585** |
| Additional synthetic controls | 7,424 | 4.091 |
| **Core plus observed synthetic controls** | **169,984** | **93.676** |

There are still 14 distinct DATA metadata rows per unchanged core after removing membership fanout: four attempts, four capture receipts, four acceptances, one link receipt and one standings capture. The synthetic control fixture adds six separate rows/core. These event identities cannot be collapsed as a storage shortcut.

The totals are overlapping views, not additional components. The 591,728 events come from the existing 126 active days at five-minute intervals and 695 inactive daily captures for 16 leagues; these are scenario assumptions, not observed production recurrence.

The receipt table's 458,752-byte batch growth includes 262,144 heap bytes and 196,608 TOAST/auxiliary bytes. Attempt, acceptance and standings growth includes 24,576 auxiliary/FSM bytes apiece. Their indexes added no pages in this short window, although new rows were indexed. The link-receipt table added 32 rows and 6,528 tuple-data bytes despite zero new allocated pages. Zero allocation delta therefore cannot mean zero future cost. There is no per-column physical-size evidence attributing the TOAST growth to a particular JSON field. Consult PostgreSQL 18's [TOAST storage description](https://www.postgresql.org/docs/18/storage-toast.html) when interpreting off-row storage.

After the impossible ideal of eliminating the entire link group, the observed residual remains **22,272 DATA bytes/core → 12.274 GiB**, or **29,696 bytes/core → 16.365 GiB** with the synthetic-control proxy. Real shared links still need receipts, content headers, new versions, child rows, foreign keys and indexes. Link sharing alone cannot establish the target.

Tuple-data diagnostics independently show 16,692 bytes/core for the non-link DATA rows including the fresh link receipt, plus 3,603 synthetic-control tuple bytes/core. They are different measurements from allocation and are neither a physical forecast nor a compression floor. Do not subtract auxiliary/shared page deltas, omit indexes or replace physical bytes with JSON/tuple sizes to manufacture a pass.

### Explicit capacity gate

Let `N = 591728`, `B = 10737418240` bytes and the observed once-only catalog increment `C = 31285248` bytes. If `r` is the future measured all-in recurring core rate, the necessary scenario condition is:

```text
C + F + N × r ≤ B
r ≤ (B - C - F) / N
```

`F` must account for starting/retained legacy allocation, first-content costs, distinct correction/link versions, other official families, catalog changes, failures/recovery, non-core controls and maintenance allowances not already included in `r`. Every byte goes in exactly one term. This is an accounting gate, not a forecast.

Even the unrealistically generous `F=0` permits only **18,092.997 bytes/core** after the one catalog increment. Provisionally keeping the observed 7,424-byte synthetic-control proxy inside that allowance leaves **10,668.997 DATA bytes/core**, before all omitted costs. That is already about a 52.1% reduction from the residual DATA rate after ideal link elimination. The proxy is not qualified normal-operation control cost.

No fixed reserve percentage or invented correction frequency can prove the remainder fits. For a real cutover forecast, include all already-retained bytes and only the remaining horizon's event volume; do not claim retroactive savings for legacy history. Preserve the existing historical scenarios as scenarios.

## Slice A: immutable shared resolved roster content

### Ownership and representation

Keep [administration.ts](../../apps/site/lib/league-administration/neon/administration.ts) and the current `record_league_administration_observation` chain as the writer. The existing AFTER INSERT acceptance trigger in [migration 042](../../apps/site/migrations/042_roster_player_links.sql) remains the roster-link owner. No new ingestion route, scheduler, provider request or independent identity resolver is introduced.

A future forward migration adds an explicit internal storage-format discriminator and nullable shared-content reference to `league_roster_player_link_receipts`, plus immutable shared-content and typed-entry tables. Names are provisional. Old receipt/child rows stay unchanged; there is no automatic backfill, rewrite, deletion or migration-number reservation. Keep the existing public link version and reader response shape.

| Keep distinct for every accepted observation | Share only when the complete resolved value matches |
| --- | --- |
| Attempt, receipt and acceptance IDs; ordinals and generations; source mapping revision; roster content/receipt binding; directory version; resolved and mapping-evaluation times; capture provenance and outcome/counts/reasons | Ordered team/native-player membership, ordinal, entity kind, identity state, canonical entity, directory identity status, kind evidence, reasons and complete mapping proof, under explicit league and resolver context |

The reader still selects the exact immutable receipt. Its per-observation mapping/catalog/timestamp bindings never come from the first receipt that used the content.

The content lookup is conservatively scoped by league-season, resolver/storage version, captured source-mapping revision and pinned directory version (including a distinct, equality-preserved NULL state), with a canonical digest of the complete ordered resolved value. Exact typed-value comparison is mandatory on a digest match. A mismatch fails closed and retains the conflict as a failure; it must never attach the wrong content. Removing the conservative mapping/directory-version key boundaries is outside the first slice.

Keep roster-content ID on each receipt, outside the sharing key. A score/standing, manager or category change may leave the complete typed membership result unchanged. The first slice supports reuse across such different roster-content IDs only after fresh resolution and full receipt-specific membership validation. Their raw content, categories, scores and per-observation provenance stay separately retained. A roster-content hash alone is never a reuse proof; savings remain unmeasured.

### Atomic write and sealing

1. Follow the current admission, mapping, capture-witness, scope and head checks. Same-attempt exact replay returns its existing history. A fresh unchanged network observation receives fresh attempt/receipt/acceptance records.
2. Pin the actual directory version, resolve using the existing canonical identity owner and ordered native-key locks, and evaluate mapping validity/conflicts at the actual post-wait time. Recheck the existing work fence after any blocking wait. Never shortcut this resolution using a roster hash.
3. Construct the bounded, ordered typed value, including unresolved/conflict evidence. Compare all fields and counts against the current receipt's exact roster content and league/team identities.
4. Look up complete immutable content. If absent, create one header carrying the database's creation-transaction xid8 and its entries inside the acceptance transaction. Reuse the existing creation-transaction guard/deferred-parity pattern in [053 draft metadata](../../apps/site/migrations/053_draft_metadata.sql) and [054 draft selections](../../apps/site/migrations/054_draft_selections.sql). A child INSERT requires the same creation transaction and no referencing link receipt yet. All header/entry UPDATE and DELETE operations remain forbidden; no mutable sealed flag is introduced.
5. Verify complete typed readback, counts and canonical hash before the first reference. The first receipt closes child insertion even within the creator transaction; other transactions cannot append because their xid8 differs, including under repeatable-read snapshots. Deferred transaction-end constraints require complete ordered parity and a valid first acceptance/receipt binding, rejecting orphan or partial content. A bare “no receipt exists” check is insufficient. A unique-insert contender must read its winner in a fresh statement, compare full values and recheck the fence after waiting, or fail cleanly if the snapshot cannot establish a valid winner.
6. Insert the new receipt reference and finish the existing acceptance/head transaction. A failure or expired fence rolls back all newly staged rows. In this document, sealed means creation-transaction-only entries closed by the validated first receipt, with no mutable lifecycle. A complete empty roster uses a valid sealed empty set; partial rosters retain every held membership, including unresolved/conflict evidence. Capacity-exceeded or owner-unqualified results retain their explicit outcome and counts without pretending to have a complete shared set.

Prefer declarative same-league foreign keys, uniqueness and non-null/check constraints for local fields; use constrained writer/lineage validation for cross-row membership and sealing. PostgreSQL [constraints](https://www.postgresql.org/docs/18/ddl-constraints.html) and [isolation semantics](https://www.postgresql.org/docs/18/transaction-iso.html) require testing the actual installed schema under contention; application checks alone do not establish this design. Keep an unconditional content-ID foreign key: a composite foreign key containing nullable directory_version_id can otherwise skip validation for NULL. Validate non-null scope/revision bindings and optional directory equality explicitly (IS NOT DISTINCT FROM); NULLS NOT DISTINCT uniqueness for the sharing key is a separate requirement.

### Reads, retention and rollout

[roster-player-links.ts](../../apps/site/lib/league-administration/neon/roster-player-links.ts) becomes a dual-format stored reader. Select legacy children for legacy receipts or sealed shared children for shared receipts, with an exclusive format discriminator. Reject missing/double/mismatched representations rather than treating them as an empty successful roster. Preserve current bounds, microsecond timestamps, null/empty distinctions, full validation and response ordering. [current-roster.ts](../../apps/site/lib/league-administration/neon/current-roster.ts) keeps its existing caller contract. No current directory head or mutable crosswalk may reinterpret old history.

Carry current immutable-history protections and least privileges into the new tables through [provision-runtime-role.sql](../../apps/site/scripts/provision-runtime-role.sql). Private staging/sealing functions must not gain PUBLIC/runtime EXECUTE except through the existing authorized writer. Every canonical entity referenced by either legacy or shared entries must remain protected from [canonical orphan cleanup](../../apps/site/migrations/054_draft_selections.sql); retain the existing draft references too. Do not replace those exclusions or weaken foreign keys. No ON DELETE CASCADE is proposed for retained history.

Roll out in three forward-compatible phases: (1) expand schema while the old writer still stores legacy rows; (2) install and verify the dual-format reader; (3) switch the existing acceptance trigger to shared writes. After any shared receipt exists, an old-only reader is an invalid rollback target. Safe operational rollback retains the compatible reader and shared history while returning future writes to the legacy representation. No destructive down-migration is part of this plan. Each deployed phase needs the repository's separate release checks and authority. Do not let a generic migration runner apply the writer-switch migration before compatible readers are installed.

The first slice changes only future forward migration(s), the existing roster-link reader and its focused tests, the optional roster-link provisioner block, the existing roster-link integration case and source-bound inventory/qualification metadata. The future identity-owner override must copy the latest active 054 implementation and add the new retained-entry reference; original migration files remain untouched. Keep the current member/team/payload/read bounds and acceptance semantics. Any shared-core extension needs a specific file/purpose and independent scope review before implementation.

## Slice B: factor repeated immutable capture evidence

This is required investigation because the residual rate already exceeds the entire budget. It is broader than the link trigger and must have its own exact consumer inventory before implementation.

Source [public-intake.ts](../../apps/site/lib/league-administration/public-intake.ts) reserves four typed attempts and carries an acquisition witness into the core capture. [runtime.ts](../../apps/site/lib/league-administration/runtime.ts) preserves the original acquisition in document provenance and carries the league population proof into the three roster-derived resources. [migration 048](../../apps/site/migrations/048_official_standings.sql) copies that proof into generic receipts and stores source mapping again on official-standings captures. This establishes duplication, not a measured byte-saving estimate.

| Candidate immutable unit | Required lossless boundary |
| --- | --- |
| Original DB-issued acquisition witness | Store once per actual acquisition/dispatch identity when identical; retain exactly the existing witness's version/work/fence/dispatch nonce/mapping/attempt IDs and nonces. Preserve reservation/admission timestamps on their original attempt/dispatch records; do not add time fields to the witness or change its hash. Never reconstruct from current jobs. |
| Captured document provenance | One per actual document capture, referencing the exact witness; different HTTP documents keep their own timestamps, request/source identity and states. This core fixture has two documents; it is not a universal count. |
| Population/configuration evidence | Reference the exact retained observation, content hash and original captured provenance; same old configuration content does not imply the same capture. |
| Immutable source-mapping token and coverage value | Intern only exact equal payloads in the correct scope/version; preserve mapping revision, field states and reasons. |
| Per-resource event rows | Retain all attempt/receipt/acceptance IDs, ordinals, generation, original evidence hash, outcome, timestamps and immutable relationships. Do not collapse four typed acceptances into one. |

Use explicit versioned evidence references plus an internal reconstruction accessor that produces the exact original logical JSON for old and new rows. Preserve missing versus null, original timestamp strings and all witness fields; no generic `{ref: ...}` placeholder may be placed where an existing consumer expects complete JSON. Do not hash a new storage wrapper instead of the original input. In particular, migration 048's predecessor evidence-hash and legacy-unqualified replay behavior remains unchanged.

Before authoring this slice, enumerate and review every direct SQL/TypeScript consumer of `attempt.source_mapping`, `attempt.write_fence`, `receipt.provenance`, `receipt.population_evidence` and `receipt.coverage`, including active function bodies from migrations 039/048/056, the current lineage implementation, [062 settlement/budget checks](../../apps/site/migrations/062_public_data_settled_request_budget.sql), stored readers, integration inventories and restricted grants. Preserve each family-specific witness/fence/lineage check and all SQL return shapes. A transparent accessor cannot be presumed compatible with existing table INSERTs, %ROWTYPE values, constraints and direct readers; prove their exact changes.

Document capture can partly succeed: settings and roster documents need not commit together. Preserve partial failures and original per-document provenance; never wait for or borrow a later successful document to complete a previous proof. A legacy observation ID may point to earlier unchanged content, so it cannot replace the exact contemporaneous captured population evidence. The mapping revision row alone is not the complete captured source-mapping token.

Keep legacy full JSON unchanged and supported. Expansion, consumer compatibility and writer switch follow the same staged rollout principle as slice A. The metadata schema, precise accessor representation and migration plan require this inventory and local proof; they are not specified as ready-to-apply SQL here. Do not broaden the change into a whole-backend rewrite, change a source contract or duplicate the storage pipeline.

## Required local proof before another hosted measurement

Use the existing isolated integration owners and restricted roles. The first implementation slice is shared roster content; follow it with a local old-versus-new storage comparison and the separately bounded metadata slice. Do not repeat the accepted hosted experiment as-is. Any eventual hosted validation requires a newly reviewed exact candidate and explicit run authority; there is no automatic retry allowance.

| Case | Required invariant/result |
| --- | --- |
| Fresh unchanged observation versus exact retry | Fresh observation adds distinct history and reuses identical sealed content; exact retry adds no new history. Changed-input reuse of an attempt fails. |
| Original → correction → return to original | All three observations remain addressable; only exact equal content may be reused. Removal/reordering and reserve/taxi/native category evidence retain their actual meaning. |
| Same roster, changed identity evidence | Changed directory version, missing/invalid/conflicting entry, valid-from/to boundary, mapping conflict/retirement/remap and resolver revision cannot reuse incompatible results; old readback remains byte/meaning-equivalent. |
| Same membership, changed official score/standing | Separate official content/capture history is retained. Membership reuse requires exact resolved-value and receipt-specific lineage parity. |
| Different leagues/teams | Identical native IDs and payloads cannot cross-bind league/team/acceptance provenance. Tampered content references reject. |
| Empty, partial and bounded failures | Empty accepted content is distinguishable from missing content; all existing capacity, owner-unqualified and partial reasons survive. Oversized data retains current explicit failure behavior. |
| Hash collision or malformed set | Exercise hash-match/unequal-value lookup using a controlled offline candidate double; native tests reject forged digests or malformed sets through real constraints without disabling guards. Do not claim an actual SHA-256 collision was generated. Count/order/kind/proof mismatch, missing child, extra child and late child insertion reject. |
| Writer contention and work expiry | Competing writers, lock waits, expired fences, transaction rollback and stale snapshot/serialization failure produce no partial/shared mutation or head regression. Preserve existing lock order; no provider call inside a transaction. |
| Legacy/new mixed history | Fresh install and an upgrade containing old receipts produce equivalent reads; legacy replay remains legacy; old/new combinations and reader-before-writer deployment order pass. |
| Metadata reconstruction | All old/new complete logical proof values and original evidence hashes match across every affected family, including missing/null/empty, original timestamp spelling and witness validation. |
| Privileges and retention | Actual runtime/account/auth roles cannot mutate/delete/truncate history or call private helpers; late insert/seal tampering rejects; orphan cleanup retains legacy/shared roster and draft identities. |
| Reader cost | Bounded query count/plans and end-to-end reads through the existing reader; no claim that small local samples qualify CP27's full target. |
| Storage comparison | Same source fixture/workload and migrated baseline on local PostgreSQL; first capture, unchanged batches, changed/returned content, mapping/catalog changes, replay and normal controls itemized separately. Verify cleanup and exact source binding. |

For storage comparisons, report allocated heap, indexes, TOAST/auxiliary forks, row counts and tuple diagnostics separately for all affected relations. Count new shared tables/headers and retained old rows. Use enough bounded repeated batches to expose page/index steps and show each batch, without discarding unfavorable ones or treating a small sample as a steady-state slope. Keep the full current four-resource core cadence for comparable measurement. Additional local execution limits and fixture bounds must be concrete before running, not borrowed from the consumed hosted allowance.

## Complete capacity accounting and stop conditions

| Remaining workload | Required capacity treatment |
| --- | --- |
| Starting schema, already-retained data, fresh intake and first contents | Include once with exact legacy/new cutover accounting; no assumed backfill savings. |
| Current core | Distinct observation metadata + actual shared content/entry versions + links + controls; avoid overlapping historical core/proof/link estimates. |
| Current exact-period lineups/matchups/scores and transactions | Include active freshness workload, corrections and all receipt/control/index costs. |
| Earlier periods and transaction correction sweeps | Include complete native 2026 coverage and daily sweep assumptions; no silent reduction to one period. |
| Draft metadata, picks, traded ownership, brackets/reports/results | Include unchanged observations, all correction versions and declared refresh frequencies. |
| Identity/discovery/manager directory and shared player catalog | Shared catalog once at startup, plus separately measured/assumed attempts and changed retained versions; initial catalog load is not a recurrence rate. |
| Failed/retried work, normal intake/refresh controls and maintenance | Measure or bound separately; synthetic controls and percentage reserves are not proof of normal distribution or long-term bloat. |

Stop short of a capacity PASS unless the complete non-overlapping forecast fits 10 GiB with explicit uncertainty and independent acceptance. If the measured solution cannot fit, report that result and request a material contract decision; never delete history, collapse observations, reduce cadence, exclude controls or silently raise the budget.

The existing ordinary-writer retention proof is valid only for its source. New shared storage and metadata references require their own installed-schema proof. CP26 freshness, CP27 full reader qualification and CP29 restore remain separate. A design review, local SQL proof or eventual storage pass does not close those checkpoints.

## Review and delivery

Independent source/retention and attribution reviews accepted the design with no blocking findings. Root reconciled 396 relation-metric/mean comparisons across 18 changed tables against the source-bound extraction, checked all 13 relative source links, and passed the repository scope check and actual-diff review. Existing calculator tests and local PostgreSQL retention results remain historical evidence; they were not rerun or relabeled as new design implementation proof.

Local exact-hash receipts are retained under test-results/cp28-lossless-design/: design-safety-review.json, design-attribution-review.json, residual-storage-analysis.json, metadata-consumer-inventory.json and root-validation.json. The metadata inventory records 164 candidate files, including 19 direct stored readers, active SQL wrapper/lineage/witness/settlement layers, three provisioners and test/qualification dependencies. This is a bounded compatibility census, not a requirement or authorization to edit all 164 files; the exact slice-B change set still needs focused review. The final closeout binds the reviewed content, review-status-only edits and local commit.

No runtime, migration, grants, provider configuration, budgets, cadence or retention policy are changed. No hosted run, new private Neon access, publication, merge or production deployment is performed.
