# Independent administration capacity review

September 16, 2026. Scope: the existing three Sleeper leagues and an 18-week season. This review read the implementation and the completed isolated report; the reviewer made no database calls, resets, provider requests or production changes.

Evidence: [capacity.synthetic.integration.json](capacity.synthetic.integration.json), observed `2026-09-16T19:22:08.116Z`, PostgreSQL `180006`, SHA-256 `98380d946c21d6bd468cfb2c847ac1b05e493e98169580c5ad5bd5a57432a116`. Production comparisons use the separately captured, dated [read-only preflight](production-preflight.readonly.json).

## What was measured

The actual restricted adapter and SQL writer handled three synthetic leagues with captured 12/12/10-team and 14/14/20-slot configuration shapes. The initial 33 documents included one matchup week per league, transaction Weeks 0/1/2 with 20 records each, one draft per league containing 168/168/200 selections, one transferred pick and one match in each bracket. Managers, lineups, transaction bodies and draft/bracket entities were synthetic; this was not a full real-season import or maximum-size roster/metadata test.

| Completed phase | Allocated bytes across 15 new tables | Change from preceding phase |
| --- | ---: | ---: |
| Seeded, before source documents | 401,408 | — |
| Initial 33 documents | 1,040,384 | 638,976 |
| 330 unchanged fresh-source checks | 1,040,384 | 0 |
| Six branding A–B–A writes | 1,122,304 | 81,920 |
| Nine roster/score/transaction corrections | 1,245,184 | 122,880 |

The final allocation is 1.1875 MiB. It includes heap, indexes, TOAST and relation auxiliary allocations through `pg_total_relation_size`; the separately reported heap/index/TOAST subtotals need not sum to that total. It excludes existing shared tables, database catalogs, WAL, retained restore history, other branches and the existing projection/statistics workload.

All counted rows stayed identical through the 330 unchanged checks. Branding reversions reused prior content while preserving the intervening observation history: the final report has 45 content rows, 48 observations and six configuration versions, with 33 document heads. These results demonstrate finite-workload deduplication and preservation of corrections. They do not establish zero long-run update overhead, a steady-state vacuum/bloat rate or a production storage ceiling.

The 378 adapter write statements serialized 5,235,304 parameter bytes and 69,186 result bytes. These are application JSON measurements, including serialization overhead, not measured network traffic or physical storage. The accumulated 14.2345 seconds is client-observed SQL-call wall time, including waiting and transport; it is not PostgreSQL CPU time or Neon CU-hours. The counter excludes fixture registration, owner measurements and SQL statements executed internally by the writer.

## Actual collection cadence and growth drivers

The current lane calls the existing calendar boundary once per league per minute, and captures two administration documents: league and rosters. For three leagues, one successful scheduled invocation each minute for 126 days produces **1,088,640 adapter write attempts** (`3 × 2 × 60 × 24 × 126`). Missed invocations reduce that count; retries, overlapping preflight work or explicit operations can add attempts. This is an attempt count, not a count of new versions or a compute-cost estimate.

Full current and future league-week loads each add four captured documents: league, rosters, users and the exact matchup week. Current full loads follow the established hourly/live-game/pending-lineup policy; future materialization follows its existing distance-based cadence and pending work. Thin lineup observations do not separately capture administration history. The full-load captures are additional to current preflight capture, even if some source bodies are identical.

At UTC minute 30, the existing current lane has one bounded global maintenance opportunity. Three leagues imply a nominal core revisit about every three hours and metadata about every twelve hours. Ordinary turns retain core plus one transaction/matchup period; every fourth turn substitutes metadata. Failed claims, deadlines, source failures and missed invocations delay coverage. Metadata turns no longer consume a weekly-history ordinal. These are collection opportunities, not a freshness guarantee.

Migration 016 returns identical unknown-age cached evidence before the head timestamp update (`record_league_administration_observation`, lines 384–389). Normal unchanged cached minute captures therefore do not append immutable history or advance freshness. Fresh network checks update verification timestamps without appending immutable content. The synthetic unchanged phase exercised the latter path. Normalization, serialization, SQL lookup/locking and transport still occur for an unchanged attempt. Changed cached evidence can require another official source check and write; these conditional attempts are outside the simple minute total.

There are **132 possible season/family heads** for the present scope: `3 × (7 season-wide families + 18 matchup weeks + 19 transaction weeks)`. The planned Weeks 0–2 bootstrap has 36 heads, whereas this measured fixture had 33. Neither figure bounds retained versions. Each changing roster or matchup response retains another whole document and its typed entries; a changing transaction-week document also retains that week's complete transaction list. Live score changes, manager changes, increasing transaction volume, failed/stale evidence and repeated source corrections can therefore dominate growth. A stable document count is not a stable byte count.

Pages retain their existing 60-second source freshness budget. A stale stored read can add a database read before the official fallback. With unchanged cached evidence and only three-hour network maintenance verification, most elapsed time is outside that verified freshness window. No elimination of provider reads or page-read cost is established by this capacity test.

## Bounded planning scenarios and reserve

The measurements support scenario arithmetic, not a statistical forecast or hard upper bound. A deliberately simple base repeats the **entire final measured three-league bundle 18 times**: 22,413,312 bytes (21.375 MiB). This overcounts some fixed/season-wide data but includes only the fixture's sparse corrections, so it still does not represent minute-by-minute live history.

The measured nine-correction batch allocated 122,880 additional bytes. Applying that observed increment to explicitly assumed additional fixture-shaped batches gives:

| Assumed additional nine-correction batches per week | Eighteen-week modeled bytes including the base | Twice modeled allocation, as a planning margin |
| --- | ---: | ---: |
| 100 | 243,597,312 (0.244 decimal GB) | 487,194,624 (0.487 GB) |
| 1,000 | 2,234,253,312 (2.234 decimal GB) | 4,468,506,624 (4.469 GB) |

These batch rates are chosen scenarios, not observed production rates. Later relation allocation is not necessarily linear: payload size, compression, index growth, rejected observations, page reuse and transaction-list length can change the increment. The measured 120 KiB batch delta is not a universal maximum per nine writes.

For the three-league rollout, **5 decimal GB of incremental administration relation storage is a proposed review reserve** around the second scenario, not an enforced limit or assurance that a season will stay below it. Record a post-bootstrap baseline and the first full live game week's family/version counts and allocated bytes, then re-estimate from the observed changed-version mix. Investigate when the season projection exceeds that reserve or measured allocations approach it; retain a separate allowance for the existing application, shared tables, restore history and other branches. No automatic deletion, provisioning or retention change is proposed by this review. A stricter budget needs a workload-specific decision before making a fit claim.

## Production comparison and conclusion

The dated preflight measured the production database at 429,006,848 bytes (0.429 decimal GB), with schema 001–015. The Launch dashboard showed approximately 0.5 GB project storage, 0.11 GB history and 0.42 GB snapshots; those scopes differ and must not be summed as database-table usage. Launch billing had removed the former Free-plan limits. Thus 0.5 GB is not the current storage ceiling.

At the captured $0.35/GB-month storage rate, a full additional 5 GB would correspond arithmetically to $1.75/month of that storage category alone. This excludes compute, restore-history charges, ordinary application growth and any billing-meter scope differences. The displayed 36.64 CU-hours and 2.79 GB transfer were existing project usage before deployment of this work, not administration usage. No cost or transfer projection is derived from the JSON counters or SQL-call count.

The measured initial footprint is small, and the unchanged-write behavior supports retaining source history without appending an immutable row every minute. The evidence supports a monitored three-league rollout with an explicit reserve and fresh release authority. It does **not** establish complete-season production fit, multi-year cost, maximum league capacity or readiness for 6,000 leagues. Release approval, actual production collection and post-deployment measurements remain separate evidence.
