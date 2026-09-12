# All-player period inventory and eligibility

The shared adapter uses `sleeper-weekly-stats-v2`. Current player catalog status,
activity and team membership are catalog observations, not historical gameday
eligibility. They cannot exclude an identity or override a requested-week
appearance. `gms_active=1` without `gp` has unknown eligibility and appearance
counts unless reviewed requested-game evidence establishes them.

## Requested-period authority

Inventory input records the requested `{season, seasonType: reg, week}`, the
catalog/schedule revisions and observation time. A complete period inventory
also requires `periodInventoryEvidence`: source, source revision, observation
time, effective period, an exact-period team for every included fantasy player,
and an individual reproducible reason for every excluded fantasy identity.
Required roster and starter identities cannot be excluded. All 32 canonical
team defenses remain required and are constructed from the league registry.

Without that evidence, the adapter retains the conservative fantasy catalog
inventory, including currently teamless players. It reports
`periodInventoryComplete: false` and `period-inventory-unproven`; this valid
partial observation cannot create complete score sets or advance pointers. This
is deliberately an unresolved authority gate, not a claim every old catalog
identity belongs in the requested season.

The retained September 12 audit catalog has 4,385 distinct identities: 4,353
fantasy players and 32 defenses. Among those players, 3,494 are currently
teamless and 859 have a current team. These historical counts explain why
current metadata cannot silently define a manageable season inventory. They
are not a production capacity estimate or a current player-count assertion.

## Evidence and counts

| Evidence | Eligible | Appearances |
| --- | ---: | ---: |
| Requested-week `gp=1`, with absent or `gms_active=1` | 1 | 1 |
| Requested-week `gms_active=1,gp=0` | 1 | 0 |
| Reviewed gamebook dressed-but-unused | 1 | 0 |
| Requested-week `gms_active=0`, absent or `gp=0` | 0 | 0 |
| Reviewed exact-period ineligibility or canonical bye | 0 | 0 |
| `gms_active=1`, missing `gp` | Unknown | Unknown |
| Missing row, `gp=0` alone, malformed flags, `gms_active=0,gp=1` | Unknown | Unknown |
| Ambiguous review or contradictory reviewed/weekly counts | Unknown | Unknown |

Reviewed `period-participation` evidence names an `appearance`, `dressed-unused`,
`ineligible`, or `ambiguous` decision, its gamebook/official-period-roster/manual
review source, source revision, UTC observation timestamp, effective period and
reason. Evidence for another week, missing temporal provenance, unsupported
shape, or future observation time is invalid. A current Inactive label is never
generated as this evidence. An adapter observation and the shared domain/writer
preflight use the same count derivation. Migration 011 mirrors it in SQL and
checks the effective period against the immutable parent.

The actual retained cases are Jones 7527 and DeVito 11292 (gamebook DNP, eligible
zero), Willis 10224 (rank-only activity with contradictory waiver/gamebook
context, unknown), Brown 5859 (appearance, 4.1 official points despite current
Inactive metadata), and Henderson 12529 (absent weekly row, unknown). Those
cases are regression evidence for September 12's incomplete 2026 Week 1, not a
completed-period fixture or a successful backfill.

Malformed eligibility flags are retained verbatim in `weekly.rawFlags`; valid
numeric raw statistics remain sparse numeric records. Nonnumeric non-eligibility
statistics remain invalid. Missing player rows have explicit
`missing-provider-row` evidence and empty raw statistics, never fabricated zero
eligibility. Nonzero calculated points for a proven nonappearance are rejected.

Contradictory reviewed inputs are invalid source configuration: an exact-period
ineligibility assertion cannot coexist with reviewed appearance or dressed-unused
evidence for the same identity. The inventory builder rejects that combination
before weekly retrieval, reporting the official ID, required/optional scope,
ineligibility reason and participation decision. Both original reviewed inputs
remain in their source manifests for correction. This differs from contradictory
provider flags, which remain valid partial raw observations with null counts.

## Response scope and finality

Response identities are classified through the shared official catalog. A
recognized `TEAM_` aggregate is excluded by canonical team identity. Known
nonfantasy identities are excluded by catalog classification even if a lineman
catches a pass or a punter has offensive statistics. Unknown identities retain
IDs and response evidence in coverage and make the observation partial; stat
key patterns never establish identity. The six fantasy position catalogs do
not themselves classify the audit's 201 other nonaggregate response IDs.

Completed shadow/backfill additionally requires every distinct canonical game
in the requested schedule to be final. The gate is independent of which
players have rows or eligibility flags and does not hardcode a game count.
Recurring current-week mode explicitly permits a nonfinal schedule, but does
not bypass inventory, eligibility, identity or parity completeness.

## Retrieval provenance and unchanged material

The inventory fingerprint omits only its assembly timestamp. Raw observations
retain their request and observation times, while reviewed inventory,
participation and schedule source timestamps remain part of immutable evidence.
Rebuilding the retained 4,385-entry Week 1 fixture twelve hours later therefore
reuses the same raw-content semantic hash; changing observed statistics changes
that hash. This is an adapter-to-writer regression, not a physical storage claim.

Generated bye evidence uses `scheduleObservedAt` when the caller supplies retained
exact-period schedule evidence with the matching revision. Otherwise it honestly
uses the current inventory observation time and preserves canonical bye 0/0
behavior. That fallback produces new raw content on later retrieval, even when
statistics are unchanged. Capacity estimates must include that cost unless
stable, authoritative schedule observation evidence has been supplied. No source
timestamp is invented or dropped to claim deduplication.

## Remaining source decision

The smallest proposed additional input is a reviewed, exact-period manifest at
the existing catalog/inventory boundary, with official period scope, team
associations, exclusions and gamebook participation where weekly flags are
ambiguous. No replacement feed, per-player statistical request, additional cron
or scoring implementation is required. The present implementation accepts and
validates this evidence but does not invent it, automatically retrieve it, or
claim sustainable live completion before an approved authoritative source and
its maintenance cost are established. A legitimately completed period must be
measured separately to determine the unresolved classes and source workload.
