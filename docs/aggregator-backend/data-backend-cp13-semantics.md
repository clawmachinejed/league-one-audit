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
