# All-player retained-history capacity validation

**Activation capacity is not established.** The isolated measurements below
prove physical growth and unchanged-run reuse for explicitly identified inputs.
They do not establish legitimate completed Week 1 evidence, the eventual
authoritative period inventory, complete real-roster parity overhead or ordinary
application headroom. No retention deletion, paid upgrade or cadence change was
performed.

## Exact measured artifacts

The supported Node 24 isolated run produced these artifacts on September 12,
2026, through the existing guarded harness and real persistence implementation:

| Artifact | Observation time UTC | SHA-256 |
| --- | --- | --- |
| [Retained partial](../apps/site/release/011-capacity.partial.integration.json) | 18:37:01.789 | `1063fd7649fbd31c6c0d47bbf23d74d5ae780851a6df25b0f330fc376a314da2` |
| [Synthetic complete](../apps/site/release/011-capacity.synthetic.integration.json) | 18:38:15.382 | `31a7fd4b5efc552100500afe39ee9aa14310c7815a5a8c0bfa154a2b099e404b` |

Each artifact contains before/after table heap, index, TOAST heap/index and total
relation bytes, physical row counts and measured runtime statement traffic. The
measured table set includes all seven all-player tables, canonical identities and
aliases, game/profile/league context, retained official parity parents/children
and the existing jobs table. Owner measurement queries are outside runtime
transfer counters. Relation totals also include PostgreSQL auxiliary forks;
they need not equal the sum of the four visible allocation columns. Existing
free pages and allocation granularity explain differences between similarly
shaped writes. Zero page growth in one run does not establish zero marginal cost.

## Actual retained partial Week 1

The retained 2026 Week 1 response passed through the actual shared inventory,
adapter and writer with all **4,385 entries** and remained partial. The separately
labelled correction adds one receiving yard to Brown only to measure a changed
immutable observation; it is not a correction to authoritative production data.

| Scenario | Added raw entries | Added observations | Allocated physical growth | Writer statement wall time |
| --- | ---: | ---: | ---: | ---: |
| Actual retained partial first write | 4,385 | 1 | 1,949,696 bytes | 2,915 ms |
| Exact replay | 0 | 0 | 0 bytes | 2,810 ms |
| Actual adapter rebuilt 12 hours later, unchanged | 0 | 1 | 0 bytes | 2,824 ms |
| Synthetic numeric correction of retained partial | 4,385 | 1 | 1,884,160 bytes | 2,907 ms |

Every scenario preserved score rows and current pointers. The first partial
write allocated 1,114,112 heap bytes and 770,048 index bytes for raw entries,
plus 65,536 content/TOAST/auxiliary bytes. Each statement sent about 1,937,158
parameter-JSON bytes plus 12,234 SQL-text bytes and returned 246–249 decoded JSON
bytes. The two local source replays each used a 63,989-byte serialized body.
There were **zero live provider requests**; the original HTTP compression,
headers and wire size were not measured.

## Explicitly synthetic complete capacity

The synthetic shape is 34 existing invariant-fixture entries plus 4,351 zero-point
NE WRs, then one additional identity. It uses the existing scorer, registered
identities, official observation writer, batch preflight and guarded publication.
The original period is synthetic season 2199; the shared-profile comparison uses
separately registered season 2198 to preserve immutable league-season profile
identity. Neither synthetic period proves actual 2026 completion.

Only **two synthetic official player rows per league, four total per retrieval**,
are represented in parity evidence. That population is smaller than the real
league roster populations. Zero-point extra players also do not represent the
full actual distribution of sparse statistic and scoring-breakdown widths.

| Scenario | Added raw entries | Added score rows | Added verifications | Allocated physical growth | Prepare/parity/write wall time |
| --- | ---: | ---: | ---: | ---: | ---: |
| First complete, two distinct profiles | 4,385 | 8,770 | 2 | 7,045,120 bytes | 5,788 ms |
| Exact replay | 0 | 0 | 0 | 0 bytes | 4,061 ms |
| Later unchanged | 0 | 0 | 2 | 49,152 bytes | 4,125 ms |
| Twenty later unchanged retrievals | 0 | 0 | 40 | 1,122,304 bytes | 1,691–4,267 ms each |
| Numeric statistic correction | 4,385 | 8,770 | 2 | 6,823,936 bytes | 3,315 ms |
| Eligibility correction | 4,385 | 8,770 | 2 | 6,610,944 bytes | 3,347 ms |
| One shared profile, separate period | 4,385 | 4,385 | 1 | 4,702,208 bytes | 1,992 ms |
| One added identity, shared profile | 4,386 | 4,386 | 1 | 4,489,216 bytes | 2,027 ms |

Registering the initial 4,351 extra identities and aliases separately allocated
**1,916,928 bytes**: 950,272 heap, 917,504 index and 49,152 auxiliary bytes. It
sent 3,078,298 parameter-JSON bytes and returned 735,349 decoded JSON bytes. The
single later identity/alias addition fit existing pages; that is not evidence
that identity storage is free. Its subsequent changed inventory correctly created
a full new immutable raw/score set.

The 34 base identities and their original league/profile/game context already
existed in the invariant fixture. Their initial creation is not included in the
extra-identity setup coefficient; production additions must be counted from the
fresh actual mapping and context inventory.

The first divergent batch allocated 3,571,712 heap bytes, 3,284,992 index bytes,
122,880 TOAST heap bytes, 16,384 TOAST index bytes and 49,152 auxiliary bytes.
Of its total, raw entries used 2,293,760 bytes and score rows 4,562,944 bytes.
Twenty unchanged retrievals added exactly **20 raw observations, 40 compact
verifications, 40 official observations, 80 official player rows and 40 official
roster rows**, with no raw-content, entry, score-set or score-row copies. The
measured amortized growth was **56,115.2 bytes per retrieval**, largely retained
verification TOAST. Original score-set lineage remains immutable; each new
verification retains the latest actual parity lineage. Retention guards pin that
official evidence. Corrections change content instead of suppressing history.

The eleven-scenario experiment took 72.7 seconds in an explicitly extended
isolated lease. It represents many requests, not one Vercel invocation. Every
individual measured prepare/parity/write operation was below 5.8 seconds, but
these measurements exclude live source/catalog retrieval, ordinary work sharing
the invocation and the full production roster/scoring distribution. They do not
prove the complete production operation meets its 50-second work deadline and
55-second cleanup/lease envelope. SQL expiry/takeover tests prove the separate
publication safety boundary.

## Transfer and polling scope

A divergent complete or unchanged retrieval sent about **7.385 MB of parameter
JSON** plus 23,136 SQL-text bytes across three measured statements; their decoded
responses totalled 989–992 bytes. Twenty unchanged runs still sent 147,696,577
parameter bytes and returned 19,780 decoded bytes. Deduplicated storage does not
eliminate client-to-database input serialization or transmission. The shared
profile sample sent about 4.760 MB and returned 852 decoded bytes per retrieval.

These are application byte counters, not Neon-billed network transfer. Database
connection startup, PostgreSQL/WebSocket/TLS framing, owner measurement queries,
the ordinary application, and complete operation context reads are excluded.
Provider inbound, database writes and Neon outbound must not be added together
as one egress figure. Statement wall time includes network waits; neither query
counts nor wall time establishes Neon compute usage.

The existing lane's 15-minute opportunity gate reduces possible all-player
database polling opportunities over 126 days from 181,440 per-minute opportunities
to 12,096. Disabled mode has none. At a not-due opportunity, compact state reads
and the bounded diagnostic helper can still query the database; unchanged
diagnostics avoid repeated physical outcome writes. These are scheduling counts,
not measured compute or billed egress. No extra cron was added.

## Bounded eighteen-week scenarios

For the requested calculation, **18 weeks = 126 days**, with at most **252 actual
weekly requests** under the global 12-hour/two-per-rolling-day budget. Recurring
and explicit operator attempts share that budget across periods. A request count
is not a success guarantee; finite correction selection and overdue final-capture
gates still apply.

Use measured synthetic coefficients: initial extra identity setup `I = 1,916,928`
bytes; first complete divergent capture `C = 7,045,120`; one changed capture
`K = 6,610,944–6,823,936`; unchanged retrieval `U = 56,115.2`. For `F` first
period captures, `D` subsequent changed captures and `R` unchanged retrievals,
the illustrative allocated-growth calculation is `I + F*C + D*K + R*U`.
This fixes the synthetic 4,385-entry, four-parity-player shape. It is not a
prediction or a strict physical upper/lower bound for another inventory.

| Eighteen-week distribution | Requests | Calculated growth, decimal MB | MiB |
| --- | ---: | ---: | ---: |
| One complete capture each week; no later requests | 18 | 128.73 | 122.77 |
| 18 first captures + 234 unchanged | 252 | 141.86 | 135.29 |
| 18 first captures + 18 changed corrections + 216 unchanged | 252 | 259.85–263.68 | 247.81–251.47 |
| 18 first captures + 234 changed captures | 252 | 1,675.69–1,725.53 | 1,598.06–1,645.59 |

For the separately measured shared-profile shape, 18 first captures plus the same
identity setup yield **86.56 MB / 82.55 MiB**. This is a comparison, not authority
to change either league's scoring rules or promise a shared-profile correction
distribution. For partial evidence alone, 18 measured first writes plus 234
numeric-correction-shaped writes yield **475.99 MB / 453.94 MiB**; partial history
can therefore be material even when it never creates scores.

The cheapest displayed cadence still needs a legitimate final capture for every
week and does not provide the required recurring correction policy by itself.
Reducing cadence cannot silently replace the existing retained-history and
correction contract. Likewise, a smaller authoritative period inventory must be
proved through source evidence, not created by excluding unknown players.

The four-row parity population is a lower workload than real league parity,
and the scenario omits ordinary-workload reserve and unmeasured source/metadata
distribution. If the confirmed usable headroom is below a scenario total, that
scenario fails even before those additions. No scenario is currently approved
for activation merely because its arithmetic falls below a rounded console
figure.

## Current allowance evidence and remaining capacity gate

The coordinating task rechecked the authenticated Vercel-managed Neon Free
account at **2026-09-12 16:35 UTC**. The organization display showed 0.42 GB
storage, 0.10 GB history, 4.51 GB outbound transfer and 60.44 CU-hours for the
September 2–October 1 billing window; the project tile showed 241.56 MB. Those
rounded account/project metrics can lag an hour and include ordinary application
and other branch activity.

The subsequent read-only production SQL check at **16:46:52.885820 UTC** found
217,563,136 physical database bytes and zero rows in all six existing all-player
tables. Exact identity and counts are recorded in
[the production preconditions](../apps/site/release/011-production-preconditions.2026-09-12.json).
Do not subtract organization storage from a per-project allowance, or substitute
database bytes for branch/history billing scope. Final headroom requires a fresh
same-scope check after isolated-test cleanup, effective allowance units/window,
ordinary-workload growth reserve and the agreed source inventory/distribution.

**Capacity approval remains blocked** on that evidence, a legitimate complete
requested-period sample with full real-roster parity, actual operation response
transfer and deadline headroom. The samples demonstrate semantic reuse and expose
correction cost; they do not establish a sustainable production season. If those
measurements exceed the confirmed headroom, present a bounded cadence/capacity
decision for approval. Do not delete immutable history or enable recurrence to
force the result.
