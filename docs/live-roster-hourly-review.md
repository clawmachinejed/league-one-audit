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

The first full database correctness run passed 224 cases across 16 files, with
four large capacity benchmarks explicitly deferred for available-plan headroom.
That result does not claim the full verification workflow passed. The first
browser run passed 49 cases and exposed three test-fixture problems: a paused
clock blocked cold streamed page rendering, and broad label selectors included
an inert prerendered subtree. The corrected browser fixture must pass before
release; none of those failed runs is counted as a passing browser gate.

No source review result replaces capacity proof, complete Week 1 parity, guarded
backfill or actual scheduled production success. The incomplete retained fixture
remains partial. No identity correction, provider request or production write
was performed as part of these reviews.
