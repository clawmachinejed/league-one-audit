# All-player period inventory and eligibility

The shared adapter uses `sleeper-weekly-stats-v3`. Current player catalog status,
activity and team membership are dated catalog observations, not historical
game-day eligibility. They cannot exclude an identity or override a
requested-week appearance. `gms_active=1` without `gp` or positive individual
snaps has unknown eligibility and appearance counts.

The selected production approach uses the existing Sleeper inputs and stored
Tank01 projection/game-state evidence. It adds no connection or provider feed.
Reviewed gamebooks remain archival audit and regression evidence; production
does not automatically consume them or replace provider unknowns with their
reviewed decisions. Current status labels are stored as context with an actual
observation time, not fabricated effective dates for earlier games.

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
| Requested-week `gp=1`, with absent or `gms_active=1` and no malformed participation value | 1 | 1 |
| Positive individual `off_snp`, `def_snp`, or `st_snp`, with no contradictory or malformed participation value | 1 | 1 |
| Requested-week `gms_active=1,gp=0`, with no positive individual snaps | 1 | 0 |
| Reviewed gamebook dressed-but-unused (archival reviewed-input contract) | 1 | 0 |
| Requested-week `gms_active=0`, absent or `gp=0`, with no positive individual snaps | 0 | 0 |
| Reviewed exact-period ineligibility or canonical bye | 0 | 0 |
| `gms_active=1`, missing `gp`, with zero or missing individual snaps | Unknown | Unknown |
| Positive individual snaps with `gp=0` or `gms_active=0` | Unknown | Unknown |
| Missing row, `gp=0` alone, malformed flags/snaps, `gms_active=0,gp=1` | Unknown | Unknown |
| Ambiguous review or contradictory reviewed/weekly counts | Unknown | Unknown |

Individual snap counts must be nonnegative safe integers. Zero snaps alone do
not prove absence, and team snap totals (`tm_off_snp`, `tm_def_snp`, `tm_st_snp`)
never prove an individual appearance. Rank-only rows and fantasy points are not
substitutes for participation evidence. Positive snap evidence remains explicit;
the adapter does not invent a missing provider `gp=1` field.

An Inactive or injury label observed today cannot establish what applied in an
earlier game. A generic inactive label also cannot distinguish injury from a
healthy scratch. Dressed but unused is a separate state from inactive. Explicit
game-specific inactivity and a non-injury reason would be needed to call a
player a healthy scratch; the currently retained Tank01 integration does not
provide those individual game-day reasons. Projection entries and whole-game
phase/clock/finality do not establish player participation.

Reviewed `period-participation` evidence names an `appearance`, `dressed-unused`,
`ineligible`, or `ambiguous` decision, its gamebook/official-period-roster/manual
review source, source revision, UTC observation timestamp, effective period and
reason. Evidence for another week, missing temporal provenance, unsupported
shape, or future observation time is invalid. A current Inactive label is never
generated as this evidence. An adapter observation and the shared domain/writer
preflight use the same count derivation. Migrations 011 and 012 mirror it in SQL
and check the effective period against the immutable parent. The v3 writer
additionally validates that raw individual snap values and normalized evidence
match. The same contradiction rule applies inside reviewed and combined
evidence, so an override cannot hide contradictory provider snaps. Existing v2
observations retain their original contract and exact replay compatibility.

The original reviewed fixture retains Jones 7527 and DeVito 11292 (gamebook DNP,
eligible zero), Willis 10224 (rank-only activity with contradictory waiver/gamebook
context, unknown), Brown 5859 (appearance, 4.1 official points despite current
Inactive metadata), and Henderson 12529 (absent weekly row, unknown).

The separate provider-only replay leaves the original files unchanged and omits
review overrides. Jones and DeVito have team snap totals but no individual snaps
or `gp`; both therefore remain unknown. Willis's rank-only activity and
Henderson's absent row remain unknown. Brown retains his appearance and 31
offensive snaps. Across all 301 retained response rows, 187 have positive
individual snaps and every one already has `gp=1`; the new rule establishes no
additional appearances in that actual capture. Its 4,385 inventory entries
retain 63 known appearances and 4,322 unknowns. These cases are offline evidence
for September 12's incomplete Week 1, not current production counts, a
completed-period fixture, or a successful backfill.

Malformed eligibility flags and individual snap values are retained verbatim in
`weekly.rawFlags`; valid numeric raw statistics remain sparse numeric records.
Nonnumeric non-participation statistics remain invalid. Missing player rows have explicit
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

## Remaining completeness limits

An additional gamebook/period-roster connection was not selected. The production
policy remains within the existing Sleeper and Tank01 inputs. The reviewed-input
contract remains available for historical tests; its presence is not approval
to attach another live source or manually fill unknown participation values.

The current retained inputs do not establish a complete historical inventory or
resolve every unused/inactive player. Provider-only capture may safely retain
valid partial observations, but it cannot create complete score sets or advance
score pointers while those gaps remain. A later exact-period provider record can
supply new evidence; it must pass the same identity, contradiction, inventory,
finality, and full official parity checks. No missing denominator is guessed,
and there is no claim that this rule change by itself completes Week 1 or makes
recurring ingestion operational. Capacity and activation remain separate gates.
