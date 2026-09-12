# Independent review of the all-player foundation repair

## Runtime and shared boundary review

Reviewer: `/root/audit_persistence_runtime`, independent of the runtime,
composition, cadence, shared identity and eligibility sources below. Reviewed
at **2026-09-12 16:54 UTC** against the complete repair contract. This reviewer
implemented the database/writer changes, so this section does not independently
approve those changes. Their separate review is linked below.

**Conditional source approval for this bounded review.** No additional blocker
was found in the inspected paths. This is a working-tree review, not a claim
about an uncreated final commit or operational readiness. File hashes below bind
the inspected bytes; substantive later changes require renewed review.

| Reviewed behavior | Evidence and assessment |
| --- | --- |
| Required versus optional identity | Inventory provenance reaches mapping planning and projection coverage. Required unusable aliases fail before the weekly request; unresolved optional references remain scoped diagnostics. Distinct official identities sharing one canonical target fail before proposals or writes. Future valid-to intervals remain usable; expired, retired, future-start and wrong-kind mappings do not. |
| Shared catalog boundary | Official fantasy membership classifies identity; numeric stat keys do not. FB membership remains represented through official RB/TE fantasy roles. Optional projection aliases cannot create the official inventory. The reviewed 4429835/8063 pairing is quarantined without a guessed replacement. Explicit provider crosswalks preserve legitimate team/position changes; current metadata is not used to invent a relationship. |
| Deterministic preflight ordering | Exact period, shared schedule, required inventory, stored profiles, active supported rules and complete official roster points precede the shared weekly request. Loaded observations must match inventory and retained provenance. Complete score/parity construction and both serializers run before canonical identity and official-observation side effects. Partial evidence takes the existing raw-only writer path. |
| Shadow and write agreement | Replay shadow uses the same substantive pure preflight and returns before all persistence. Live shadow fails closed at `shadow-source-policy-required`, before retrieval. Write mode uses the global claim/request marker and checks its fence before each ancillary write stage. Database publication races are separate isolated evidence, not inferred from these checks. |
| Deadline and truthful outcomes | One 50-second ingestion deadline shares the invocation budget and cancellation signal. Cleanup is separately bounded. Confirmed publication is retained when completion fails, and superseded observations report rejection. Busy/not-due races and preclaim failures use the bounded diagnostic helper without changing the original outcome; shadow does not use that helper. |
| Recurring selection | Disabled mode returns before dependency construction. Nonpoll minutes do no all-player database work. Polling reads the global budget/cooldown before authority selection. Current and previous periods alternate within a finite correction window; older missing final capture remains an explicit overdue gate. SQL remains the concurrent request-budget authority. |
| Reviewed eligibility contradictions | The small adapter correction rejects contradictory reviewed participation/ineligibility inputs before weekly retrieval, with required/optional provenance in diagnostics. Contradictory provider flags still follow valid partial evidence handling. This does not turn ambiguous source evidence into a denominator. |

The reviewed runtime preserves the existing scorer, provider catalog boundary,
projection reader, store and cron attachment. Its context reads stored projection
and game evidence; no diagnostic Tank01 call was introduced in these paths.
Ancillary identity/parity writes remain separately idempotent operations before
the atomic all-player batch. The entire operation is not represented as atomic.

The reviewer ran supported-Node-24 targeted tests at 16:53:45 UTC:
**6 files, 126 tests passed, zero failed or skipped**: runtime operation,
composition, cadence, shared worker identity, roster context and Sleeper
all-player adapter. These are local regression results, not live source,
production backfill or database release evidence.

At 17:05 UTC the reviewer additionally approved null primary/membership handling
at the raw catalog boundary. Null fields mean absent metadata; valid primary or
fantasy membership still establishes the existing role, while malformed non-null
values reject. This aligns the shared boundary with existing production catalog
normalization; it is not evidence of a reproduced live pipeline failure. Actual
C identity 10979 remains out of scope. Actual null/null identity 2901 cannot
silently exclude a response row: a separately labelled inserted response stays
unknown/partial, and making that identity required fails strict inventory. The
retained 301-row weekly schema supplement classifies all 201 added known-role
identities without changing fantasy inventory membership. The reviewer reran the
catalog and actual foundation suites: **2 files, 12 tests passed**, zero failures
or skips. The classifier hash below includes this final adjustment.

| File under `apps/site/lib/projections/` | SHA-256 of reviewed file bytes |
| --- | --- |
| `runtime/all-player-operation.ts` | `dd1ee0d2bbf5db408fc76e62d556051c544e205b6c3c17e91578c4c144852d02` |
| `runtime/all-player-composition.ts` | `9d8bd00a876688083bffc726be874fc8199c1b2b614176f504bc046c23e880da` |
| `runtime/all-player-cadence.ts` | `45d80e98d27d1ccab836bc354d1780f73d4ca3739bcd691264b523098a6867cd` |
| `shared/official-catalog-identity.ts` | `2e1db53882da81edd1b43015911ff60a0be12c4d53a096c0ce549d4fb18958c2` |
| `shared/reviewed-projection-identities.ts` | `c501ad4c1782c2deb3a6d7db43418ee59c371ea94485a361101005acbff055f1` |
| `worker/roster-context.ts` | `589551e1191ffb3e4efcbdc8b7f71eae2c53b15ec68e270fdc0c987d9376d6c9` |
| `adapters/sleeper/all-player-stats.ts` | `863f4c777f7fe759175f979520cb137398cb2738765c6e22448ea02df92459c5` |

The same reviewer checked the alias suite's revised pinned-session helper and
transaction boundaries. A checked-out client preserves savepoints through
expected SQL errors; every fixture rolls back and closes; permission testing
uses the configured runtime connection. No source issue was found in that
bounded correction. Its earlier nine execution failures are not relabelled as
passing: the coordinating task must rerun the corrected isolated suite.

## Open source and operational gates

The retained Week 1 evidence is partial. Authoritative complete exact-period
inventory, eligibility, finality and full parity still need proof. A reviewed
live-shadow request/budget policy remains an explicit product/source decision;
the current production path fails closed. Synthetic capacity evidence cannot
satisfy either gate. Stable authoritative bye observation timestamps are needed
to avoid fallback timestamp churn; the adapter deliberately retains evidence
instead of hiding that limitation.

The final coordinated repository workflow, exact final revision, preview, PR,
merge and production deployment remain separate evidence. Production migration,
alias retirement, backfill, pointers, actual scheduled success/not-due behavior
and demonstrated ordinary-workload headroom are not established by this review.
Do not enable recurrence from local test success alone.

The migration, publication fences, immutable append boundaries, global job
protection and PostgreSQL 18 catalog have a separate
[independent database/catalog review](../apps/site/release/011-catalog-independent-review.md).
The [release runbook](../apps/site/release/011-all-player-repair-runbook.md) and
[capacity record](all-player-capacity-validation.md) identify their actual
evidence and remaining gates.

## Database, immutable publication and release source review

Reviewer: `/root/audit_identity_eligibility`, independent of the migration,
database writer, job SQL and wrapper implementer. This section records the
earlier source review and its final artifact check at **2026-09-12 17:06 UTC**.
It does not independently approve the identity, fixture, publication-coverage
validator or alias integration code authored by this reviewer.

**Conditional approval of the inspected database and release sources.** The
concrete findings from this review were corrected: null-safe claim/completion
validation; live mapping kind and effective-interval checks on new verification;
takeover interruption evidence; protection of the global budget row from generic
job DML and pruning; same-transaction publication evidence and physical pointer
proof at completion; deferred deadline/ownership protection; wrapper job locking;
and exact catalog object-scope counts. No remaining source blocker was found in
these inspected paths. This approval does not establish complete source data,
capacity headroom, production release authority or operational completion.

| Reviewed behavior | Assessment |
| --- | --- |
| Publication ownership and races | Publication checks the live job token, generation, expiry and deadline inside SQL while locking the global job row. The deferred pointer constraint repeats the fence at transaction completion, closing expiry between application preflight and commit. Completion rejects lost or expired ownership and requires physical publication evidence for a published result. |
| Atomic profile publication | Physical raw/score counts, full coordinated profile group and parity lineage are checked before pointer updates. Older observations are superseded; equal-time different observation or score identifiers conflict. Exact replay remains valid. Pointer atomicity does not imply that preceding identity/parity writes are part of the same transaction. |
| Immutable child boundaries | New child insert guards reject additions to sealed raw observations and score parents while preserving initial creation in the writer transaction and exact replay. Immutable history remains protected against UPDATE/DELETE. |
| Semantic reuse and lineage | New retrieval observations may refer to unchanged score material through immutable verification lineage. New verification still validates canonical mapping kind and effective interval. Corrections change semantic material and create the appropriate new immutable records; storage savings require separate physical measurement. |
| Global request budget and diagnostics | Dedicated helpers serialize the one global request history and selected period. Generic DML cannot reset the protected row. Preclaim diagnostics use bounded fields, unchanged-context deduplication and a 15-minute changed-context throttle while preserving active ownership, request timestamps and final capture history. |
| Release installation and least privilege | The wrapper binds database/role identity and reviewed PostgreSQL-major catalog expectations, obtains a job-table lock before checking live ownership, validates original 010 and exact final object sets, and verifies runtime privileges. It rolls back a failed assertion. Installed 010 is unchanged. Old application publication fails closed without a transaction fence; recurrence must remain disabled through the compatible release sequence. |

| File under `apps/site/` | SHA-256 of inspected file bytes |
| --- | --- |
| `migrations/011_all_player_foundation_guards.sql` | `9cfafe04f7a58a6e15c24b4659ae0cf0676d117c1c636df53d3ae1af14e81943` |
| `lib/projections/adapters/neon/all-player-statistics.ts` | `a8ec2c1d4bb28bb05890b2e12ff48d47247794b3258beb79922bb21c13d162fb` |
| `lib/projections/adapters/neon/jobs.ts` | `460fe16a1d6ed001636e77844f3a750c5b896c8473c592a75b70a0c329268392` |
| `scripts/all-player-migration-release-wrapper.mjs` | `a44e9b916af7a4a54dc5067fbeb4bb92bba5186ef25379779ba690925e00690e` |
| `scripts/all-player-repair-catalog.mjs` | `b61c0912fa40ca5d0d7b21018392b7c1aa15903c462d599fc5fb975f1a71bea2` |
| `scripts/verify-all-player-repair-release-wrapper.ts` | `46fefc3c133e96c6629325941214e3348bd6f36aebedbe84dc575072bf7363aa` |

The release-normalized LF migration checksum is
`0eaa96bcc0b65053ac8dab48657eb7bfe22fadbfd41b4f4c78c3472ca8a512b6`.
The separately reviewed PostgreSQL 18 manifest and its exact table, constraint,
function, trigger and permission comparison are recorded in the
[catalog review](../apps/site/release/011-catalog-independent-review.md).
The coordinator reported actual guarded PostgreSQL 18 wrapper execution with
corrupt-manifest rollback, successful installation and exact sentinel checks,
and 31 passing all-player SQL cases in the third coordinated run. Those are
isolated database results, not production evidence. The earlier alias-suite
transaction failures required a pinned-session harness correction and remain
pending a coordinated rerun at this review timestamp. The final full workflow,
capacity measurements and final commit binding belong to the coordinating task.
