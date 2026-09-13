# Independent live roster and hourly collection review

The September 13 review used independent agents for runtime/SQL and browser
changes. Authors did not approve their own source. Final release status belongs
in the release evidence; source review alone does not establish live operation.

| Area | Finding and correction | Evidence |
| --- | --- | --- |
| SQL admission | Returning the database's current timestamp as the next due time could perpetually defer a caller whose clock was sampled before the query. The helper now returns the eligible slot's opening or a real retained-budget boundary. | Actual PG18 read-signature regression and source review. |
| Active versus display period | Default-period timing can be empty or belong to another period when the display week advances. Active Week 1 does not require correction timing; unavailable correction timing retains an explicit diagnostic and permits exact-active-period capture. | Exact-source replay and cadence/composition tests; ingestion still validates requested game context. |
| Finite correction window | Overdue full-final obligations must remain visible without permanently stopping authorized current partial captures. Closed-season results retain all outstanding periods and persist the earliest actionable period. | Cadence tests and independent source review. |
| Durable diagnostics | Merging overdue diagnostics must update the reported count as well as the diagnostic array. | Runtime regression tests and source review. |
| Browser timing | A minute-one invocation can finish after `:02`; the browser now reads at `:03`. | Shared deadline calculation and browser schedule cases. |
| Browser rollover | A successful response can advance the current-week authority while preserving explicit other-week selection. An unavailable old-week score read does not trap the page on the old week. | Browser rollover cases and independent UI review. |
| Active-week browser refresh | The existing roster response now distinguishes an included active scoring week, proved nonactive selection, and temporarily unknown authority through scoped response headers. An advanced display week cannot stop a still-active selected week's refresh. | HTTP/context tests, browser active/display divergence cases and independent UI review. |
| Scope and stale responses | Responses must match league, season and selected week, pass generation/abort checks and preserve newer saved statistics on failure. | HTTP/unit and browser cases. |
| Partial-week carryforward | The prior reader dropped Week 1's valid partial points when Week 2 began and excluded them from historical views. The same reader now selects each permitted week's latest partial capture unless that profile has a published score set for that week. | Reader unit and isolated regression cases, independently reviewed source. |
| Incomplete cumulative coverage | A wholly missing prior week must not yield complete-looking season ranks. Known PPG remains partial and ranks are withheld; an unusable later period cannot erase earlier valid points and appearances. | Missing-period and contradictory-period regressions. |
| Migration/catalog | Only two owner-only helpers and three existing bodies change. Installed migrations, tables, triggers, constraints, runtime grants and history are preserved. | Actual wrapper commit, corrupt-manifest rollback, actual catalog comparison and eight isolated SQL cases. |
| Concurrent exact replay | A batch statement could take its snapshot before waiting for the job lock, then miss the winner's committed replay rows. The existing client now executes the fence lock and unchanged batch statement in one ordered Read Committed transaction. | Deterministic isolated barrier reproduction, production-driver transport probe and independent client/fence review; final regression results below. |

The first full database correctness run passed 224 cases across 16 files, with
four large capacity benchmarks explicitly deferred for available-plan headroom.
That result does not claim the full verification workflow passed. The first
browser run passed 49 cases and exposed three test-fixture problems: a paused
clock blocked cold streamed page rendering, and broad label selectors included
an inert prerendered subtree. After the fixture correction, all 52 Chromium
cases passed locally at `d7073db4f1449d24c922ddc5db5b97dc0be0c6c9`; GitHub
verification and browser checks also passed for that candidate. Its local
verification passed lint, type checking, build and 1,859 tests, with one existing
IPv6 skip. None of the earlier failed runs is counted as a passing gate.

The final isolated database run for that candidate passed 224 cases, failed one
concurrent replay case, and deferred four capacity benchmarks. Two transactions
can begin the existing batch statement before either obtains its job lock. The
waiting statement's old snapshot cannot see the winner's committed replay rows,
even though uniqueness checks see them. The batch fails atomically instead of
recognizing the exact replay. This was treated as a confirmed release blocker,
not a passing or ignored flaky test.

The guarded isolated reproduction at September 13, 13:14 Eastern held both
independent sessions behind the same job-row lock before releasing them. The
winner committed exactly one content, 34 entries, one observation, two profile
score sets, 68 scores and two verifications; both pointers shared that observation.
The other identical replay failed with SQLSTATE `22012`. All physical-count and
pointer assertions passed before the expected replay-success assertion failed.
There was no partial commit or duplicate history.

Independent review confirmed that the installed Neon driver sends the two lazy
queries in one HTTP transaction, in order, with explicit `ReadCommitted` isolation
and the same cancellation signal. The probe used mocked HTTP and no database
or provider access. The existing database fence checks the real clock after
waiting for its row lock; batch and deferred pointer guards remain unchanged.
Client-side cancellation is not presented as server-side cancellation proof.
The fix adds no migration, function or grant, and clients without the required
atomic capability fail closed.

After the repair, all five focused isolated cases passed at September 13,
13:21:22 Eastern (19.94 seconds; 33 other cases filtered out). Exact concurrent
replay returned one advancing and one verifying result for the same physical
batch. Deadline-token changes and owner/generation takeover while a backend was
proved to be waiting rejected both writing and completion with unchanged raw,
score and pointer contents. Existing expired-owner and deadline-during-publication
rollback cases also passed. One hundred focused client/writer/harness tests,
TypeScript and focused lint passed. The full unit suite additionally required
updating the existing partial-batch test to identify the batch after its new lock
statement; independent review confirmed its empty-score assertions were retained.

The final source then passed the complete local `pnpm verify` command: lint,
Next.js type generation, TypeScript, 1,874 tests (one existing IPv6 skip), and
the production build. The full isolated correctness run and exact-candidate
browser/preview evidence are recorded separately in the release report; the four
capacity benchmarks were deferred pending effective plan headroom at that point.

After the user completed the Launch upgrade, three capacity cases passed and
the 27-write synthetic benchmark exceeded its 240-second aggregate test limit.
The same guarded benchmark passed with a larger test-only envelope in 323.61
seconds; each independent batch took 8.916–14.211 seconds. Independent review
approved changing only that test's outer allowance to 480 seconds, below its
550-second fixture deadline. Production retains its existing 50-second deadline.

A separate complete synthetic case used both real 37-rule scoring profiles
(identical, therefore shared), 336 official player occurrences, 24 rosters,
179 distinct comparisons, and 4,385 entries including all 32 defenses. Its first
attempt correctly failed preflight for omitted v4 coverage metadata before any
all-player batch write; isolated identity and parity setup had occurred. After
faithful synthetic metadata was supplied, all first/replay/unchanged/correction
assertions passed in 102.23 seconds. The existing scorer and writer were used,
with zero provider requests and no production writes. Physical measurements and
their scope are recorded in the release runbook and sanitized Launch summary.
The 20 returned reader metrics are explained by the fixture's 20 nonzero scores,
not identity loss; its 169-row query is not a season-wide traffic bound.

The complete standard repository workflow is rerun at the final release head
after this test-only allowance and capacity documentation update. Exact results
and production observations belong in the final release record; these synthetic
cases cannot establish completed production Week 1 parity or backfill.

No source review result replaces capacity proof, complete Week 1 parity, guarded
backfill or actual scheduled production success. The incomplete retained fixture
remains partial. No identity correction, provider request or production write
was performed as part of these reviews.
