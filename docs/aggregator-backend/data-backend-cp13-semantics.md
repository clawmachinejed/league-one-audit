# CP13 provider meaning and remaining acceptance

This October 12, 2026 supplement records public source evidence and the accepted
two-case retained-source/recovery run at `e7977776`, following the separately
accepted eight-case run at `29be8bc`. Read it with the unchanged
[completion contract](data-backend-readiness-contract.md),
[CP13 acceptance plan](data-backend-cp13-plan.md) and
[current evidence ledger](data-backend-evidence.md#current-checkpoint-summary).
The runs retain their separate source and proof boundaries. The later
[documented bracket interpretation](#documented-bracket-played-interpretation--october-12-2026)
is a new source candidate, outside those hosted proof bindings. CP13 remains open.

## Resource, existing path and persisted evidence

- **Resource:** native current-2026 standings, score field presence, bracket
  structure and the authority required to interpret official results.
- **Existing path:** `capturePublicSleeperCore` in `lib/sleeper.ts` retains public
  network responses; the maintained administration normalizer, official standings
  projector, bracket projector and existing stored composition readers remain
  the owners. No second acquisition, scorer, writer or publication pipeline.
- **Persisted result:** a minimized [source fixture](../../apps/site/test-support/fixtures/cp13-live-source-2026/source.json)
  with [provenance and minimization rules](../../apps/site/test-support/fixtures/cp13-live-source-2026/README.md),
  a field-level inventory and additional tests of existing readers. The later
  two-case hosted run qualifies retained standings persistence/readback and
  synthetic ordinary later-failure recovery through those same owners.
- **Evidence:** one bounded public inventory, original capture clocks/digests,
  offline native-to-projection parity and deterministic reader tests, followed by
  the separately accepted [hosted 2/2 result](data-backend-evidence.md#cp13-retained-source-and-ordinary-recovery-hosted-qualification--october-12-2026)
  at `e7977776`. The earlier hosted 8/8 run remains bound to `29be8bc`.

## Fresh public observations

The inventory made 25 GET attempts: league metadata, rosters, native week 5 and
both brackets for five already evidenced current-2026 league IDs. The first
metadata response was successfully retained at 15:36:56.262 UTC. The disposable
inventory script then stopped because it looked for top-level `leg` instead of
`settings.leg`. After correcting only that script, it reused the original
response and clocks and made the other 24 requests; it did not repeat the first
request. Every response was HTTP 200, with redirects and automatic retries
disabled. Current league identity/season were verified before dependent requests.

| Sample | Native ID | Teams | Native type | Winner / loser bracket responses |
| --- | --- | ---: | ---: | --- |
| League One | `1378850182409490432` | 12 | 1 | Both JSON null |
| League Two | `1378850360529014784` | 12 | 1 | Both JSON null |
| Dynasty | `1312138224994385920` | 10 | 2 | Four matches each; reported winners/losers null |
| Additional keeper sample | `1395875117568913408` | 12 | 1 | Seven matches each; reported winners/losers null |
| Additional redraft sample | `1398809418962898944` | 12 | 0 | Seven matches each; reported winners/losers null |

All 58 rosters supplied W/L/T, PF/PA and decimal components. PF and PA were
positive; two roster records in the additional keeper sample had nonzero ties.
Those are **season record counts**, not an identified completed weekly tie.
`settings.rank` and `settings.seed` were absent from all 58 records. This is
absence in these captures, not proof of provider-wide unavailability.

All samples reported `in_season`, `settings.leg: 5` and
`settings.last_scored_leg: 4`. Their week-five responses contained score and
pairing fields, with null custom overrides. The current leg selects this
inspection period; it does not establish historical applicability or finality.
The three populated bracket pairs supplied native entrants and advancement
references. Future bracket contents during an ongoing regular season do not
establish locked playoff seeding, a completed series or an official bye.

The inventory retained 92,529 bytes of serialized capture documents; these are
parsed JSON documents, not original HTTP wire bytes. The successful manifest
SHA256 is `85ab60e5e4e5e785342122d6147520d14aac21859d1b6b5bea3391988818155a`.
Original documents and the stopped attempt remain ignored under
`apps/site/test-results/data-backend/cp13/live-source-inventory/`.
The fixture preserves each endpoint's separate observation time; it does not
invent one atomic snapshot or claim fresh public data was stored in Neon.

## Documented meaning and interpretation boundary

| Fact | Primary evidence | Safe interpretation |
| --- | --- | --- |
| PF/PA | [Sleeper PF/PA scope](https://support.sleeper.com/en/articles/4121810-do-pf-and-pa-track-the-whole-season) | These roster totals cover regular-season play, excluding playoffs and consolation. `temporalContext: season-to-date` identifies a current observed provider summary; it is not a promise to sum every season phase. Earlier-period applicability remains unverified. |
| Official seeding | [Qualification rules](https://support.sleeper.com/en/articles/2203518-how-do-playoff-teams-get-determined), [commissioner seeding](https://support.sleeper.com/en/articles/2528718-can-i-customize-my-league-s-playoff-seeding) | Provider placement may include division and commissioner decisions. Preserve supplied rank/seed only; neither score sorting nor bracket source order supplies them. |
| Ties | [Tiebreak rules](https://support.sleeper.com/en/articles/4238872-can-i-set-tiebreakers), [record recalculation](https://support.sleeper.com/en/articles/12076832-recalculate-matchup-records) | Regular-season ties and playoff seed-based tiebreaking are distinct. Score equality alone cannot establish completed outcome, applicable seed or record synchronization. |
| Byes | [Odd-team leagues](https://support.sleeper.com/en/articles/4044507-can-we-do-a-league-with-an-odd-of-teams) | The product permits first-round playoff byes, not regular-season byes. A missing row or unresolved bracket entrant is insufficient proof of a particular bye. |
| Bracket results | [API bracket contract](https://docs.sleeper.com/#getting-the-playoff-bracket) | Preserve supplied `w/l` within the bracket's match namespace. The API defines these as winner/loser roster IDs for a played match, supporting reported played-result meaning when valid populated values are observed. This does not establish a generic weekly join, included periods or an irreversible result. Native `p` stays uninterpreted; the current 2026 captures have no positive `w/l` witness. |
| Correction and finality | [Stat corrections](https://support.sleeper.com/en/articles/2441282-stat-corrections), [commissioner score changes](https://support.sleeper.com/en/articles/3410666-adjusting-weekly-lineups-scores) | Scores and records may change or synchronize at different times. Separate receipt clocks are necessary; league status, elapsed time and weekly reports alone do not establish finality. |
| Multiweek | [Official playoff guide](https://sleeper.com/blog/how-do-fantasy-playoffs-work/) | The product offers a two-week championship and reseeding. This does not define the API enum, included-period mapping, aggregate authority or correction propagation for a particular league. |
| Other competition behavior | [Median games](https://support.sleeper.com/en/articles/3971690-extra-game-each-week-against-league-median), [consolation versus Toilet Bowl](https://support.sleeper.com/en/articles/2203534-consolation-bracket-vs-toilet-bowl) | A roster's record need not encode only head-to-head outcomes; advancement can mean winning or losing depending on bracket rules. Preserve native facts independently. |

Finality means provider-evidenced completion **as observed**, with later corrections retained; it does not require a result that can never change. Correction capability alone does not invalidate suitable finality evidence. The open issue is the authority and scope of a particular completion signal.

These primary pages support product behavior. They do not replace an observed
2026 source chain or permit us to invent official outcomes. No new winner
calculator, seed reconstruction, bye classifier or series join is justified by
this inventory. No runtime or public payload change is made merely to turn an
unknown into a completed checkbox.

## Acceptance map after this increment

The eleven CP13 acceptance obligations are not interchangeable with the separate
eight-case and two-case hosted profiles. The following names the proof owner and
remaining work; local tests never silently promote a database or live obligation
to qualified, and retained-source replay is not fresh live acquisition.

| Obligation | Existing accepted proof and this increment | Remaining boundary |
| --- | --- | --- |
| CP13-01/02: standings and field states | Hosted synthetic type/field/identity/capacity cases at `29be8bc`; positive PF/PA and season tie-count witnesses; hosted retained-native-to-typed-to-reader parity for all 58 rows at `e7977776` | Positive supplied rank/seed not observed. Replay preserves original source clocks, unproved population and no membership/acquisition witness; it is not live ordinary ingestion. |
| CP13-03: unusual score groups | Hosted custom-zero/equal/unpaired negatives; additional deterministic keeper composition with three entrants and an unpaired team | Added keeper/group combination is unit composition proof, not a new hosted case or positive weekly tie/bye. |
| CP13-04: bracket evidence | Hosted synthetic outcomes/null/empty/corrections; retained current bracket entrants/edges and offline parity | No positive current-2026 `w/l` capture. Contradictory-reference component tests retain their separate source scope. |
| CP13-05: multiweek and applicability | Hosted independent weeks 15/16 with unknown series; additional changed/contradictory applicability tests | Supported series identity, actual included legs/rules, positive completion and correction remain open through the complete chain. |
| CP13-06: clocks and state | Hosted recapture/replay/correction history; deterministic completed-league observation and exact receipt-context pairing | League status does not finalize a contest. New transition combinations have no new hosted qualification. |
| CP13-07/10: integrity and fences | Accepted restricted LOGIN, remap/forgery/permission checks, observed blocking and changed/equal deferred-COMMIT rollback | Preserve exact source/run binding. No runtime or database change in this increment. |
| CP13-08: ordinary composition | Accepted populated roster/manager/selected-score/standings/bracket recovery and one corrected refresh at `29be8bc` | The `e7977776` recovery case selects neither exact periods nor a catalog and does not rerun the earlier combined proof. Full-history/live operation is not implied. |
| CP13-09: current failure versus history | Fresh failed-core recovery at `29be8bc`; actual SQL preservation at `e7977776` after accepted membership, a pending bracket sibling and later malformed core, with request-bound standings, explicit old pairs and complete recovery | This bounded synthetic ordinary journey closes the later-core/pending-pair SQL gap. It does not establish live recurrence, other failure combinations or sustained operation. |
| CP13-11: scope and compatibility | Existing hosted team/capacity/default-off cases; explicit 18-period/two-family and invalid-period composition boundaries | Selection of 18 stored stubs is not acquisition of 18 periods or measured maximum-reader capacity. |

## Next complete proof unit

The later-core/pending-pair SQL scenarios are now qualified within their bounded
synthetic scope. The subsequent bounded inventory below collected native weeks 1–4 from the
already verified current-2026 league identities. It closes that collection task,
while official weekly outcome, tie/bye and completion meaning remains unresolved.
The next evidence needed is an authoritative result/completion signal for a
specific contest, with documented meaning and retained source scope. Repeating
the same score-only captures does not establish that signal. Scores,
`last_scored_leg`, league status and season tie counts are not automatically
contest-finality proof.

For a representative supported multiweek series, establish actual participants,
included legs, applicable configuration, bracket identity, outcome authority and
a corrected observation with old history intact. Distinguish absent, uncollected
and uninterpreted evidence; a synthetic completed fixture cannot establish that
Sleeper exposes this chain. Implement and qualify only supported semantics
through existing owners, with a separately reviewed bounded SQL candidate if
needed. This closeout does not authorize new acquisition or another paid run.

The five inspected leagues have no reported playoff results yet. That limits
these samples; it does not establish that no suitable 2026 source can exist.
Do not traverse prior seasons, accelerate the calendar, redefine finality or
move the representative obligation to CP20. CP13 retains supported semantics
and representative completion/correction; CP20 retains full-current-season
application. All paid-run authorizations recorded here remain consumed.

## Accepted retained-source and recovery proof

The separate two-case `data-official-results-evidence-v1` profile passed at
`e7977776` in [run 38281416550](https://github.com/clawmachinejed/league-one-audit/actions/runs/38281416550),
with independently accepted report and automatic cleanup. Its first case proved
58 native rows through committed typed storage and restricted readers while
preserving original observation clocks and unproved population. Its second case
proved ordinary accepted-membership/history preservation through partial current
bracket failure, later malformed core with valid standings, and recovery. The
earlier eight-case module and its exact source pin remain unchanged.

The run contains no new live provider acquisition or runtime interpretation.
It does not change the remaining rank/seed, weekly outcome/tie/bye/finality or
representative multiweek obligations in the acceptance map. The selected
23-minute authored allowance remained fixed; measured case durations were
3.259333 seconds and 858.555202 seconds, with a 947.032-second lifecycle. Full
default discovery grows from 57 to 58 modules without a full-suite fit claim.
The single-run authorization is consumed; CP13 remains open.

## Earlier native-period source investigation — October 12, 2026

The approved continuation captured five fresh league metadata documents and
20 weekly matchup documents (native weeks 1–4 for each existing sample), using
`capturePublicSleeperCore` at `0525bff09a29124e01b92eb69969082eae6997a2`.
All 25 GETs returned HTTP 200, with redirects and retries disabled. Metadata
confirmed NFL/2026 identity before each league's weekly requests. The existing
12-second adapter timeout and 20-second per-capture bound were preserved; the
longest capture took 605.439 ms. This is a source-capture measurement, not a
whole-worker or database deadline qualification.

The inventory ran from `2026-10-12T17:52:00.817Z` through
`2026-10-12T17:52:05.759Z`, retaining 143,817 serialized-document bytes. Its
manifest SHA-256 is
`ad6b99a4dd63355715d2193080a476f1534e96922e4b9ef99a4e19832e073c02`.
Original captures remain ignored under
`apps/site/test-results/data-backend/cp13/completed-period-inventory/2026-10-12T17-52-00-815Z/`.
The minimized [prior-period fixture](../../apps/site/test-support/fixtures/cp13-live-source-2026/prior-periods.json)
retains exact native values, field presence, original clocks, source hashes and
original row-key inventories under its [documented minimization policy](../../apps/site/test-support/fixtures/cp13-live-source-2026/README.md).
The first inventory and its source fixture remain unchanged.

All 232 team rows form 116 two-team groups. Each raw row has only
`custom_points`, `matchup_id`, `players`, `players_points`, `points`, `roster_id`,
`starters`, and `starters_points`; every custom override is null. No explicit
weekly winner, tie, bye or completion field was present in these responses.
All five metadata observations have `settings.leg: 5` and
`settings.last_scored_leg: 4`. Earlier native-period selection does not establish
historical settings applicability or define that latter field.

The keeper sample supplies equal `110.2` scores for rosters 10 and 12 in week 1,
matchup ID 1, observed at `2026-10-12T17:52:04.547Z`. This is consistent with
the separately captured season tie counts for those teams. It remains a
candidate tied contest, not a directly reported weekly outcome. The source
responses have independent clocks, and season records cannot be silently
reassigned to a particular week. An attempted public Sleeper matchup-page
inspection redirected to another league and rendered no usable content; it
provided no additional identity or result evidence.

Primary-source review corrects two earlier documentation statements. The
[bracket API](https://docs.sleeper.com/#getting-the-playoff-bracket) does give
populated valid `w/l` played-match meaning; no current-2026 positive witness
was acquired in this increment, so runtime finality remains unknown. The
correction-policy link above now points to the
[NFL article](https://support.sleeper.com/en/articles/3410666-adjusting-weekly-lineups-scores),
replacing the same-titled Fantasy FC article. This fixes source attribution,
not the contract. The NFL [record-recalculation guidance](https://support.sleeper.com/en/articles/12076832-recalculate-matchup-records)
also describes late-drafted weeks initially receiving ties, another reason
score comparison cannot substitute for official records. Targeted official
documentation searches did not establish `last_scored_leg` semantics or the
`playoff_round_type` numeric mapping; this is an unresolved evidence gap, not
proof of provider-wide unavailability.

The added regressions exercise retained native scores and pairing through the
existing pure projector and composed reader. Their canonical identities and
receipts are test fixtures, not live SQL acceptance. They preserve unknown
weekly outcome/finality/series and independent source times. No runtime,
migration, paid profile, scoring, contract, production or prior-season change
is included. The accepted eight-case and two-case SQL proofs retain their
original sources. CP13 remains open for supported weekly result interpretation
and representative multiweek completion/correction; CP20 retains full-season
application. The new source inventory does not justify another paid run by
itself.


## Documented bracket played interpretation — October 12, 2026

**Resource and path.** This increment reads the existing accepted playoff-bracket
resource through `composeOfficialResults`. The acquisition adapter, raw capture,
normalizer, typed storage and receipt-bound readers remain the same. No new
persisted field, query, feed, scorer or result calculator is introduced.

The [official bracket API documentation](https://docs.sleeper.com/#getting-the-playoff-bracket)
defines supplied winner/loser IDs as results of a played match. The composed
bracket result now reports `provider-reported-played` with reason
`bracket_outcomes_match_resolved_entrants` only when two distinct supplied
results match exactly two distinct native roster entrants in slots 1 and 2.
This means played as observed at that bracket receipt, with its resource's
original source clock. A correction can reverse the result; removal of an
outcome returns the interpretation to unknown at the newer receipt. Neither
operation rewrites the original receipt.

Partial/null/missing outcomes and unresolved or unsupported entrants remain
unknown. Weekly result/finality, ties, byes, series membership, rank/seed and
aggregate authority do not become known from this interpretation. No bracket
match ID is joined to a weekly matchup ID. Positive tests are explicitly
synthetic examples of documented semantics; no positive 2026 source capture
or representative multiweek completion/correction chain has been acquired.

**Compatibility and qualification.** Independent impact review found the reader
is an unshipped opt-in backend composition, with no website/HTTP consumer or
persisted result version. The current v1 selector and composer stay in place;
no compatibility router is added. Four existing positive-bracket SQL expectations
and the two module digests are updated under an explicit reviewed scope
extension. Profile names, case counts/order, hooks, all unrelated pins, workflow,
guards and deadlines stay unchanged. The eight-case proof at `29be8bc` and
two-case proof at `e7977776` remain historical source-bound evidence; they do not
qualify these changed finality assertions. New hosted qualification has not run.

**New primary-source finding.** Sleeper's publicly linked
[current web-client asset](https://sleepercdn.com/js/bundle-289984cc906c222f030c5be6f7eab819.js?vsn=d),
observed October 12, exposes NFL playoff starts at weeks 11–17 or disabled.
Under those options, the earliest two-week round spans weeks 11–12, so the
week-5 sample inventory cannot supply that completed example yet. This is a
client-menu observation, not proof of a universal server restriction. The same
client maps `playoff_round_type` 0 to one-week rounds, 1 to a two-week
championship and 2 to two-week rounds throughout. Its adjacent-week selector
supports that reading, but does not prove historical applicability or a
particular league's aggregate result. No new runtime series rule is added.

The client also contains a weekly-report metadata query keyed by league and
week. Its anonymous availability and payload meaning remain unverified; it was
not invoked. The client's week-comparison completion display is UI behavior,
not sufficient evidence to promote weekly finality in this backend.

The retained ignored observation is
`apps/site/test-results/data-backend/cp13/provider-client-source/observation-2026-10-12.json`
(SHA256 `eca5f02318220bac6013aa6dbfecb7e2ca58191e196bb82aef3e2db8aa55cf69`),
including source-page linkage, eight bounded excerpts, offsets and fetch clocks.
The asset has 11,944,711 UTF-8 bytes and SHA256
`c0c23993abe7425340031b943260c084326007152566154c654e3040a7837253`.
This static-document research made no league API request, prior-season
collection, credential access or paid SQL run. Frozen acceptance obligations
remain in place; further score-only recaptures would not resolve them.

Local validation for this increment passed 276 tests across six targeted files
(133 composition/bracket/exact-score cases, 78 offline profile controls and 65
stored-intake/standings reader regressions), with zero skips. Changed-file ESLint,
generated route types, TypeScript and the scope/diff checks passed. These checks
supply local source evidence; two independent final reviews accepted the implementation and qualification/documentation
diff with no material findings. Normal CI/preview are reported separately. No hosted SQL run has tested the new interpretation.

## Anonymous weekly-report source evidence — October 12, 2026

**New evidence, unchanged acceptance.** The documented client query was resolved
through its shared web transport to an anonymous read-only GraphQL POST at
https://sleeper.com/graphql. Two bounded probes at source
`700d7fa730eba3060471ac619854edba87a6acda` each refreshed the keeper sample's
2026 NFL identity through the existing `capturePublicSleeperCore` adapter,
then requested one report key: `1395875117568913408_1` and
`1395875117568913408_4`. All four HTTP attempts returned 200. The second key
was a deliberate semantic follow-up, not a retry. No cookies, authorization,
device identity, prior-season traversal, database access or paid run was used.
A local path typo stopped preparation of the second script before any request;
correcting that path did not repeat either probe.

Each probe declared a 20-second total work limit, a 12-second per-request timeout,
no redirects or retries, and a report-body limit of 1 MiB, 25,000 parsed values
and depth 32. The probes completed in 713.365 ms and 560.348 ms. These are measured
diagnostic acquisitions, not ordinary worker, maximum-capacity or SQL deadline
qualification. Anonymous success for two keys does not establish universal
report availability or a supported public API contract.

The [minimized retained fixture](../../apps/site/test-support/fixtures/cp13-live-source-2026/weekly-reports.json)
and its [slice policy](../../apps/site/test-support/fixtures/cp13-live-source-2026/README.md#separate-anonymous-weekly-report-capture)
preserve both identity observations, all 24 native standings rows, the report
keys/weeks, native timestamps, field inventories, request clocks and source hashes.

| Native report fact | Week 1 | Week 4 | Supported meaning |
| --- | --- | --- | --- |
| Supplied ranks | 1–12 | 1–12 | Rank within each retained report; not current rank or playoff seed. |
| Record strings for rosters 10 and 12 | `T` | `TWLW` | Explicit provider report record evidence; no score comparison required. |
| W/L/T counts for those rosters | 0/0/1 | 2/1/1 | Supplied report counts. Week-four rows carry cumulative records, not one weekly outcome. |
| Native `round` / report `week` | 1 / 1 | 4 / 4 | Observed report fields; no universal record-character-to-week mapping is claimed. |
| `created` and `last_updated` | 2026-09-15T15:20:13.995Z | 2026-10-06T15:21:09.369Z | Provider metadata, distinct from the October 12 acquisition clocks. |

The week-one report supplies five `W`, five `L` and two `T` records.
This is positive provider-supplied report evidence for the previously observed
equal-score candidate, not merely equality plus a later season tie count.
In week four, all record strings have four characters and all supplied W/L/T
counts total four. Their first characters match the earlier report, but this
sample consistency does not establish general sequence ordering, a contest
identity join or treatment of median games, byes and multiweek rounds. Preserve
record and streak strings without introducing a result parser.

Reports expose information absent from the retained roster source: actual
`rank` fields are now observed. This does not change the absence of
`settings.rank`/`settings.seed` in the earlier roster captures. Optional
rank absence still does not invalidate otherwise useful standings.

**Precision and time.** The report supplies `110.19999694824219` where the
separately observed matchup supplies `110.2`. Preserve each native value and
source; do not round report points into roster whole-plus-hundredths components
or overwrite matchup scores. A fresh report retrieval does not make its
September/October metadata time current. Equal created/updated timestamps do
not prove immutable content, correction synchronization or a final contest.
Sleeper also explicitly warns that posting a weekly report does not finalize a
matchup ([NFL stat-correction policy](https://support.sleeper.com/en/articles/2441282-stat-corrections)).

**Next implementation boundary.** This is an obtainable native source within
CP13, not an unavailable-provider exception. It is not yet integrated:

1. Add an explicit optional exact-week report selection through the existing
   intake/refresh job and witnessed dispatch owners. Omitted selection must keep
   its current request count. Extend the existing Sleeper adapter with bounded
   GraphQL response/error/null handling; do not add another feed or worker.
2. Give reports their own family, key/week, receipt and typed rows through the
   existing administration normalization, fenced acceptance and storage owners.
   Current TypeScript families and SQL family/week constraints exclude reports.
   R048 standings require a roster receipt and native `settings.*` parity;
   report rows must not be reshaped into fake rosters or attached to old receipts.
3. Expose stored report-scoped facts through the existing stored composition
   owners, with native report timestamps separate from capture clocks. Leave
   generic weekly outcome, finality and series interpretation unknown until the
   necessary source meaning is established. Report rank is not current rank.
4. Prove native-to-typed-to-reader parity, identity/family/week rejection, partial
   GraphQL errors, null/removal, corrections, equal-time changed content,
   replay/out-of-order observations, failed-refresh preservation and the original
   fence before qualifying the new path. Reuse the current exact-value policy
   without manufacturing roster decimal components. A reviewed additive migration
   and new source-bound SQL qualification are required; neither is done here.

The exact existing owners include `lib/sleeper.ts`,
`lib/league-administration/{contracts,normalize,runtime,public-capture-witness}.ts`,
`lib/league-administration/public-{intake,refresh}*`,
`lib/league-administration/neon/administration.ts` and the stored
`lib/aggregator/official-results.ts` composer. This is an architectural next
subincrement, not a new approval requirement or a change to the frozen plan.

**Proof boundary.** Original-to-slice verification checked both manifest hashes,
all four original artifact hashes/byte counts, all 24 rows and all four saved
slice hashes. Two independent source/architecture reviewers confirmed the
report/roster separation. No application code, schema, test profile or test
assertion changes occur in this evidence increment. No new unit tests merely
mirror the static fixture. The 700d7fa normal CI and preview remain evidence for
that executable source, not report integration. Prior eight-case and two-case
hosted runs retain their original bindings; even the later played-bracket
interpretation still needs changed-source qualification. Positive 2026 played
bracket and representative multiweek completion/correction evidence remain open.

Final independent fixture/provenance and architecture reviews accepted this
evidence-only diff after correcting a one-millisecond documentation typo and
one integration-owner path. All 36 checked local document links, the required
scope guard and diff checks passed. Runtime, migrations, qualification profiles,
frozen CP1/2/13 requirements and earlier source fixtures are unchanged from
700d7fa. No application test suite or paid verification was rerun for this
static evidence increment; publication and automatic checks are reported separately.

## Weekly report integration candidate — October 12, 2026

This continuation implements the previously identified report path. It does not
change the frozen CP13 acceptance requirements. Selected current-2026 weeks 1–18
use the existing intake/refresh owner and bounded Sleeper adapter, with one
anonymous GraphQL POST per report work. Omitted or empty selectors add no report
work, capability query or report reader query. The existing 20-second work and
60-second admission limits remain unchanged.

The new native weekly_report family retains the complete response and exact
league/week key. Additive R049 stores two typed tables (report header and team
facts) through the existing generic reservation, receipt and acceptance lifecycle;
R050 extends existing durable tasks, witnesses, recovery and checkpoints. Reports
cannot borrow roster, bracket or other-resource acceptance. Canonical team links
use source roster IDs without a sample-league allowlist. No migration has been
applied to a retained or hosted database by this continuation.

Every optional fact retains known/absent/null/invalid state. Native rank, round,
record, streak, W/L/T and points retain their supplied values and source paths;
record strings remain uninterpreted. Provider created/last_updated values are
separate from retrieval clocks. Report facts do not replace current roster
standings, identify weekly contests, or establish completion/series semantics.

Current reads select the latest attempt before qualification. A failed latest
capture returns unavailable; earlier accepted receipts remain explicitly readable.
A successful metadata:null observation records unpublished state with no team
rows, independently of a published empty report. Corrections retain new immutable
receipts even when provider metadata timestamps are unchanged. PostgreSQL compares
reservation/capture timestamps at database precision and stores decimals as NUMERIC.

Resource bounds are 20 teams, 8 MiB raw response and 1 MiB typed value per report.
JavaScript checks compact JSON bytes; PostgreSQL checks its jsonb text serialization,
which can conservatively reject a near-limit value. These are admission ceilings,
not proof of maximum capacity, all-league availability or a freshness guarantee.

Initial local evidence:140 focused parser/composer/normalizer tests passed. A
network-blocked PGlite diagnostic applied all 50 maintained migrations to an empty
in-memory database and passed 43 assertions using the actual restricted SET ROLE
writer and reader. It covered 24 retained rows, independent source/replay clocks,
exact decimals, equal-provider-clock correction, replay, failed-current/history,
null removal, optional field parity, direct-mutation/private-helper denials and
forged-value rejection. Zero network attempts were made. This is local PostgreSQL
source validation, not hosted LOGIN/concurrency qualification or live acquisition.
The source-bound eight-case `data-weekly-reports-v1` candidate is authored and
independently reviewed. Its 29-minute authored allowance has not been measured by
a hosted run. The fixture LF SHA256 is
`298dfeec2fa275eea7993c19822541360b5041356c4fc406a924251a9b8d09a2`.

Positive current-2026 played-bracket evidence, generic weekly outcome/finality
semantics and representative multiweek completion/correction remain open. Earlier
paid results retain their original source bindings; no paid run, merge, production
installation or activation is authorized by this implementation record.

### Final review findings and local verification

Review reproduced a raw-size bypass: rejected report payloads could still be
stored through the generic writer, including submissions without typed acceptance.
The new report-only outer R049 guard now rejects a PostgreSQL-serialized raw body
over 8 MiB before either delegation path. The repaired local diagnostic requires
no durable writer changes for either rejection. Bounded malformed evidence remains
storable. Original failure evidence is retained; the passing result does not erase it.

The complete unit suite also exposed a prohibited runtime import cycle. The sole
parser, constants and DTOs now live in a pure dependency leaf; the public report
facade keeps the same exports and source-verifying projector. The architecture
rule was preserved. A native test fixture collision was independently reproduced
and repaired within the new fixture: it reuses an existing native mapping unchanged,
or remaps only the connection it created after its exact native assertions. Both
module orders were exercised locally without changing the older source fixture.

Local PostgreSQL records under ignored repo-root test-results/cp13/local-sql are
separate from hosted qualification:

| Diagnostic | Passed assertions | Boundary |
| --- | ---: | --- |
| Native report/limits/original fence expiry | 61 | Includes the earlier 43 native round-trip assertions plus capacity rejection and changed/equal-content commit rollback after expiry. Single-session SET ROLE, not blocked multi-connection LOGIN proof. |
| Repaired raw admission | 61 | Includes shared native setup plus hard raw rejection through both writer paths and bounded rejected-evidence controls. Counts overlap the preceding diagnostic and are not additive. |
| Ordinary witnessed intake/refresh | 37 | Actual adapter, writer, scheduler, checkpoint and readers; 13 dispatches, 15 synthetic requests and three report POSTs. Owner-only scheduler-clock acceleration was explicit; original source/receipt/reservation clocks and 20-second fences were unchanged. This does not prove real 60-second cadence. |
| Native fixture module ordering | 18 | Both report-first and prior-evidence-first identity arrangements pass with exact native report keys and rows. |

All used an empty in-memory database with all 50 maintained migrations, the
restricted runtime role and zero real network attempts. Original hosted LOGIN,
blocked-relation contention and real admission timing remain in the prepared
hosted profile. The prior eight-case/two-case hosted proofs retain their original
sources; this new profile does not requalify the changed played-bracket assertions.

The local full lint command initially included an ignored downloaded Sleeper
client bundle and exhausted its default heap. Application lint passes when that
local test-results evidence directory is excluded; no lint configuration or rule
was relaxed. An existing diagnostic test hit its unchanged five-second timeout
under full parallel local load, then passed focused execution. Final full local
verification uses four workers; production work and qualification deadlines are
unchanged. Profile-digest failures during concurrent fixture authoring are retained
as working-source checks and are superseded only by checks of the frozen pin.

Frozen-candidate local units passed: 7,298 tests in 318 files, with one explicit
scoped-IPv6 listener test skipped because this host has no matching interface.
The acyclic architecture check passes. All 259 closed profile/runner checks passed
independently, and final TypeScript, application lint, dependency, scope and diff
checks passed. The final parser-leaf source also repeated the 43-assertion actual
writer/reader PostgreSQL diagnostic successfully with zero network attempts.
Branch publication, source CI, preview readiness and any future hosted result
remain separately reported; none of these local checks is a release.

### Weekly report hosted attempt — October 12, 2026

The user authorized one disposable `data-weekly-reports-v1` run at
`7da4e4805f9f775bb02bb51b824757bcf78d14f5`, fixed 0.25 CU, a $1 authorization
limit, existing deadlines, automatic cleanup and no automatic retry.
[Run 38308226714](https://github.com/clawmachinejed/league-one-audit/actions/runs/38308226714)
executed attempt 1 at that exact source and failed before tests. This consumed
that one-run authorization; no second dispatch or rerun occurred. The $1 limit
was authorization, not a provider-enforced billing cap; actual billing was not
verified, and no disposable compute was created.

- **Resource and path:** the selected eight-case weekly-report profile used the
  existing protected integration-test workflow and disposable supervisor. The
  exact fixture digest remained
  `298dfeec2fa275eea7993c19822541360b5041356c4fc406a924251a9b8d09a2`.
- **Persisted result:** seven immutable supervisor receipts and one empty journal
  reservation were retained. Provisioning stopped at `api-target-validation`;
  no branch-creation intent, child identity, SQL connection, migrations, database
  credentials or test process were created. No qualification report exists.
- **Actual proof:** zero collected, executed, passed, failed or skipped test cases;
  all eight selected cases remain unexecuted. The independent offline audit passed
  10 evidence-integrity checks with zero network attempts. It verified the source,
  profile context, journal chain, archive members and acknowledged terminal
  failure. It did not accept qualification. The supervisor elapsed time was
  385 ms; the authored 29-minute SQL allowance remains unmeasured.
- **Remaining gap:** hosted weekly-report LOGIN, contention, real admission cadence,
  capacity and end-to-end parity remain unqualified. Earlier successful profiles
  keep their original source bindings. CP13 remains open, with no merge, retained
  installation, production release or activation.

The terminal receipt records `tests:not-run` and failures `provision` and
`branch-deletion`. Schema cleanup, credential revocation and branch deletion
remain explicitly unverified, not falsely marked successful. Source inspection
explains the second failure: no branch had been created, so the generic deletion
step had no owned branch identity to verify. Fresh post-acknowledgment Neon
inspection independently showed one branch, only `integration-test-base`
(`br-plain-bread-b7sgfdl8`), in `steep-glitter-44680287`. No manual deletion,
SQL query, local credential retrieval or provider configuration change was performed.

The console showed that baseline archived after inactivity at the displayed
local time `2026-10-12 13:24:42`. The pre-dispatch inventory already displayed
its archived indicator; coordinator preflight missed its incompatibility with
`validateTarget`'s strict `current_state === 'ready'` requirement. A nine-assertion
local diagnostic with injected responses reproduced rejection of the otherwise
identical archived parent, acceptance of ready, and the actual supervisor's
failure stage/flags. It attempted no network, database connection or SQL.
The archived state is an evidenced blocker, but the original receipt retained
no specific plain-error reason or response fields, so the exact failed predicate
cannot be reconstructed conclusively from the hosted artifact.

[Neon's branch-archiving documentation](https://neon.com/docs/guides/branch-archiving)
identifies archived as a normal state and documents automatic unarchiving when a
child is created. A future narrowly reviewed harness repair should handle that
state without weakening exact identity, expiration, denylist, empty-child,
restricted-login or compute checks, and preserve a sanitized diagnostic reason.
No such repair or new run is included in this evidence record.

Ignored evidence is retained under
`apps/site/test-results/data-backend/cp13/sql-38308226714` and its `-metadata`
sibling. The immutable artifact ZIP SHA256 is
`4502739c26de82c22725ad340588d5cb7ad9117a54ed2eab8c132d0faf423b30`;
acknowledged terminal receipt `run-1791839077292-22c5bc5f-be6e-4e5e-b3cd-a6fabd8c4dda-0007.json`
SHA256 is `696310b5d222fdce58dce5c3d7950c233a2c242064ce1cc14925a7b986750b17`.

### Archived-parent harness repair — October 12, 2026

The following user-approved repair changes only the existing disposable test API
client and local regressions. Exact permanent test parents may be `ready` or
`archived`; the existing single child-creation POST handles normal unarchiving.
The child must still reach `ready`. Compute limits, creation expiry, identity,
TLS, empty-database, restricted-role, ownership, cancellation, cleanup and
30/40/50-minute limits remain unchanged. No parent warm-up query, additional
provider mutation or retry is introduced.

Fixed literal diagnostic codes distinguish invalid API configuration, project
identity, parent identity, parent expiration and parent state. Successful API
response shapes are checked safely before field access. Errors retain only fixed
messages/codes, so the existing lifecycle receipt serializer can explain a future
failure without including provider values, bodies, secrets or connection strings.
The supervisor implementation and receipt schema are unchanged; initial environment
validation remains a separate pre-receipt boundary.

Independent reviewers approved the exact three implementation/test paths before
edits. Regression coverage uses injected responses and the actual API/lifecycle
owners; it includes one archived-parent child creation, preserved rejection of
unsafe identities/states/expiry, strict child readiness, and journal redaction.
The weekly-report fixture and every existing profile pin remain unchanged.

Run `38308226714` remains failed at `7da4e48`, with zero tests executed. The new
source has not been qualified on hosted Neon. A new paid run, merge, production
installation or activation is not authorized by this repair record. CP13 remains
open and its product/data contract is unchanged.

Local validation of the repair passed 517 focused tests across 11 files, with
zero failures or skips, including the unchanged closed-profile and runner gates.
The implementation agent's 99 API tests are included in that total, not additive.
All 19 architecture tests, type checking, changed-file lint and dependency checks passed. The first local
typecheck launcher selected the host's old Node 20 through a nested Corepack call;
the same typecheck passed using the existing Node 24/pnpm 11 wrappers on PATH.
No project configuration or check was relaxed. Independent final review found no
blocking safety, privacy or scope findings.
