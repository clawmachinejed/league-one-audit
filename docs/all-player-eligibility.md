# All-player period inventory and eligibility

The shared adapter uses `sleeper-weekly-stats-v4` with the user-selected
`missing-participation-as-zero-v1` product policy. This explicitly replaces the
earlier policy that left both counts unknown when clean individual participation
data was missing. For a player without positive participation evidence, clean
zero or missing participation values now yield an assumed appearance count of
zero. The original source evidence remains unchanged and the assumption is
recorded separately; it is not a new provider assertion.

Eligibility remains a separate question. A clean weekly `gms_active=1` row with
missing `gp` and no positive individual snaps yields eligible 1 / appearance 0.
An entirely missing player row yields eligible unknown / appearance 0. Absence
does not establish injury, inactivity, a healthy scratch, or historical roster
membership. Current catalog labels cannot exclude an identity or override a
requested-week appearance.

The selected production approach uses the existing Sleeper inputs and stored
Tank01 projection/game-state evidence. It adds no connection or provider feed.
Reviewed gamebooks remain archival audit and regression evidence; production
does not automatically consume them. Current status labels remain context with
an actual observation time, not fabricated effective dates for earlier games.
The new product assumption needs no extra connection, player-specific exception,
injury lookup, worker, cron schedule, or change to the scorer.

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
| Clean `gms_active=1`, missing `gp`, with zero or missing individual snaps | 1 | 0, assumed |
| Entirely missing player row, without separate exact-period evidence | Unknown | 0, assumed |
| Clean player row with missing `gms_active` and no positive `gp`/individual snaps | Unknown | 0, assumed |
| Positive individual snaps with `gp=0` or `gms_active=0` | Unknown | Unknown |
| Malformed flags/snaps or `gms_active=0,gp=1` | Unknown | Unknown |
| Ambiguous review or contradictory reviewed/weekly counts | Unknown | Unknown |

The assumption applies only to individual players. Canonical defenses retain
their existing evidence and missing-row rules. A clean `gp=1` or positive
individual snap value remains appearance 1 even if other snap keys are zero or
absent. Individual snap counts must be nonnegative safe integers; team totals
(`tm_off_snp`, `tm_def_snp`, `tm_st_snp`) never establish an individual appearance.
The adapter does not invent a provider `gp=0` or replace the observed statistics.

Assumptions use `kind: assumed-nonparticipation`,
`policy: missing-participation-as-zero-v1`, `source: product-policy`, and the
requested effective period. The `basis` is either the untouched weekly-stat
evidence or the original missing-provider-row inventory fingerprint. Coverage
reports `assumedNonParticipationCount` separately from
`unknownEligibilityCount` and `unknownAppearanceCount`, and records
`participationAssumptionPolicy`. A zero set by this policy must remain
distinguishable from a provider-confirmed zero or an independently reviewed DNP.

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
preflight use the same count derivation. The additive policy migration checks
the assumption's effective period against its immutable parent and preserves
the installed 011/012 guards. The v4 writer validates the unchanged raw flags and
snaps against the nested basis. The same contradiction rule applies inside
reviewed and combined evidence; neither a review nor an assumption may hide
contradictory provider snaps. Existing v2 and v3 observations retain their
original contracts and exact replay compatibility.

The archived audit's v3 interpretation recorded Jones 7527 and DeVito 11292
(gamebook DNP, eligible zero), Willis 10224 (rank-only activity with contradictory
waiver/gamebook context, unknown), Brown 5859 (appearance, 4.1 official points
despite current Inactive metadata), and Henderson 12529 (absent weekly row, both
counts unknown under that earlier policy). The source fixture files remain
unchanged; v4 changes the explicitly recorded interpretation below.

The provider-only policy replay leaves the original files unchanged and omits
review overrides. Jones and DeVito have team snap totals but no individual snaps
or `gp`; their clean weekly `gms_active=1` now gives 1 / 0 with an assumption
wrapper. Willis's clean rank-only activity row receives the same product
assumption. Henderson's entirely absent row gives unknown / 0, with its original
missing-row fingerprint retained. His injury or dress status is not invented
from that absence. Separately supplied, valid exact-period inactive/injury
evidence could establish 0 / 0; there is no hardcoded Henderson exception.

Brown retains his appearance, 31 offensive snaps and unchanged 4.1 points. Across
all 301 retained response rows, 187 have positive individual snaps and every one
already has `gp=1`. No additional positive appearance is claimed. Under v4, the
4,385-entry provider-only fixture has 96 known eligible entries, 63 appearances,
4,294 assumed nonappearances, 4,289 unknown eligibility counts, and 28 unknown
appearance counts belonging to missing canonical defenses. These are offline
fixture totals for September 12's incomplete Week 1, not current production
counts, completed-period proof, or a successful backfill.

Malformed eligibility flags and individual snap values are retained verbatim in
`weekly.rawFlags`; valid numeric raw statistics remain sparse numeric records.
Nonnumeric non-participation statistics remain invalid. Missing player rows keep
empty raw statistics and explicit `missing-provider-row` evidence inside their
assumption basis; the policy adds no zero-valued source row. Nonzero calculated
points for a confirmed nonappearance fail scoring validation. When calculated
or official points contradict an assumed nonappearance, the runtime withdraws
the assumption, restores the untouched original basis and unknown counts, and
retains the observation as partial evidence with a scoped conflict diagnostic.
Missing source rows are not scored or replaced with invented statistics. No
observed or official point value is erased to make an assumption pass parity.

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
not bypass inventory, eligibility, identity or parity completeness. A policy
zero can be observed before a future game; it is not a final DNP verdict. A later
positive `gp` or snap observation creates the normal immutable correction. The
policy does not declare an unplayed game final or suppress later appearances.

## Retrieval provenance and unchanged material

The inventory fingerprint omits only its assembly timestamp. Raw observations
retain their request and observation times, while reviewed inventory,
participation and schedule source timestamps remain part of immutable evidence.
The product assumption records its policy version and effective period, without
inventing a new source timestamp. Rebuilding unchanged v4 input can therefore
reuse its material hash; changing observed statistics or policy evidence changes
that hash. The version transition to v4 has distinct immutable content and does
not rewrite an older v2/v3 observation. This is a semantic contract, not a
physical storage or season-fit claim.

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
to attach another live source. The user expressly selected assumed zero
appearances for missing participation. That product decision does not authorize
invented injuries, historical membership, or an assumed eligible denominator
for an entirely missing player row.

The current retained inputs do not establish a complete historical inventory or
resolve every unused/inactive player's eligibility. Provider-only capture may
retain valid partial observations with assumed appearance zero and faithful
unknown eligibility. It cannot create complete score sets or advance score
pointers while the remaining gaps persist. Later source evidence must pass the
same identity, contradiction, inventory, finality and full official parity checks.
The participation policy alone does not complete Week 1 or make recurring
ingestion operational. Capacity and activation remain separate gates.
