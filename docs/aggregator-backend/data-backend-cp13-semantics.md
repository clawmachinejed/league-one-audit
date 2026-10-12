# CP13 provider meaning and remaining acceptance

This October 12, 2026 supplement records the next CP13 increment after the
accepted eight-case run at `29be8bc`. Read it with the unchanged
[completion contract](data-backend-readiness-contract.md),
[CP13 acceptance plan](data-backend-cp13-plan.md) and
[current evidence ledger](data-backend-evidence.md#current-checkpoint-summary).
It adds public source evidence and deterministic reader tests. It does not
change runtime interpretation or declare CP13 complete.

## Resource, existing path and persisted evidence

- **Resource:** native current-2026 standings, score field presence, bracket
  structure and the authority required to interpret official results.
- **Existing path:** `capturePublicSleeperCore` in `lib/sleeper.ts` retains public
  network responses; the maintained administration normalizer, official standings
  projector, bracket projector and existing stored composition readers remain
  the owners. No second acquisition, scorer, writer or publication pipeline.
- **Persisted result:** a minimized [source fixture](../../apps/site/test-support/fixtures/cp13-live-source-2026/source.json)
  with [provenance and minimization rules](../../apps/site/test-support/fixtures/cp13-live-source-2026/README.md),
  a field-level inventory and additional tests of existing readers. No database
  persistence is performed by this increment.
- **Evidence:** one bounded public inventory, original capture clocks/digests,
  offline native-to-projection parity and deterministic reader tests. The earlier
  hosted 8/8 run remains bound to `29be8bc`; no new SQL run is implied.

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
| Bracket results | [API bracket contract](https://docs.sleeper.com/#getting-the-playoff-bracket) | Preserve supplied `w/l` within the bracket's match namespace. The documented contract does not supply a generic weekly join or explicit contest-finality evidence. Native `p` stays uninterpreted. |
| Correction and finality | [Stat corrections](https://support.sleeper.com/en/articles/2441282-stat-corrections), [commissioner score changes](https://support.sleeper.com/en/articles/9786258-adjusting-weekly-lineups-scores) | Scores and records may change or synchronize at different times. Separate receipt clocks are necessary; league status, elapsed time and weekly reports alone do not establish finality. |
| Multiweek | [Official playoff guide](https://sleeper.com/blog/how-do-fantasy-playoffs-work/) | The product offers a two-week championship and reseeding. This does not define the API enum, included-period mapping, aggregate authority or correction propagation for a particular league. |
| Other competition behavior | [Median games](https://support.sleeper.com/en/articles/3971690-extra-game-each-week-against-league-median), [consolation versus Toilet Bowl](https://support.sleeper.com/en/articles/2203534-consolation-bracket-vs-toilet-bowl) | A roster's record need not encode only head-to-head outcomes; advancement can mean winning or losing depending on bracket rules. Preserve native facts independently. |

Finality means provider-evidenced completion **as observed**, with later corrections retained; it does not require a result that can never change. Correction capability alone does not invalidate suitable finality evidence. The open issue is the authority and scope of a particular completion signal.

These primary pages support product behavior. They do not replace an observed
2026 source chain or permit us to invent official outcomes. No new winner
calculator, seed reconstruction, bye classifier or series join is justified by
this inventory. No runtime or public payload change is made merely to turn an
unknown into a completed checkbox.

## Acceptance map after this increment

The eleven CP13 acceptance obligations are not interchangeable with the eight
hosted test cases. The following names the proof owner and remaining work; local
tests never silently promote a database or live obligation to qualified.

| Obligation | Existing accepted proof and this increment | Remaining boundary |
| --- | --- | --- |
| CP13-01/02: standings and field states | Hosted synthetic type/field/identity/capacity cases; fresh positive PF/PA and season tie-count witnesses; retained-source offline parity | Positive supplied rank/seed not observed. Fresh source captures have not undergone a new hosted native-to-typed-to-reader run. |
| CP13-03: unusual score groups | Hosted custom-zero/equal/unpaired negatives; additional deterministic keeper composition with three entrants and an unpaired team | Added keeper/group combination is unit composition proof, not a new hosted case or positive weekly tie/bye. |
| CP13-04: bracket evidence | Hosted synthetic outcomes/null/empty/corrections; retained current bracket entrants/edges and offline parity | No positive current-2026 `w/l` capture. Contradictory-reference component tests retain their separate source scope. |
| CP13-05: multiweek and applicability | Hosted independent weeks 15/16 with unknown series; additional changed/contradictory applicability tests | Supported series identity, actual included legs/rules, positive completion and correction remain open through the complete chain. |
| CP13-06: clocks and state | Hosted recapture/replay/correction history; deterministic completed-league observation and exact receipt-context pairing | League status does not finalize a contest. New transition combinations have no new hosted qualification. |
| CP13-07/10: integrity and fences | Accepted restricted LOGIN, remap/forgery/permission checks, observed blocking and changed/equal deferred-COMMIT rollback | Preserve exact source/run binding. No runtime or database change in this increment. |
| CP13-08: ordinary composition | Accepted populated roster/manager/selected-score/standings/bracket recovery and one corrected refresh | Bounded synthetic case is passed; full-history/live operation is not implied. |
| CP13-09: current failure versus history | Accepted fresh failed-core recovery; new mocked-store current pending pair versus explicit old pair, and later core rejection alongside retained membership | Actual SQL preservation after previously accepted membership followed by a malformed core is still not established by these reader stubs. |
| CP13-11: scope and compatibility | Existing hosted team/capacity/default-off cases; explicit 18-period/two-family and invalid-period composition boundaries | Selection of 18 stored stubs is not acquisition of 18 periods or measured maximum-reader capacity. |

## Next complete proof unit

Before another paid run, assemble the source-backed interpretation and exact
remaining SQL cases, then freeze a bounded profile with the original harness
limits. The missing later-core/pending-pair database scenarios can use existing
intake, receipt and bracket owners. Positive multiweek proof additionally needs
2026 evidence for participants, included legs, applicable configuration, bracket
identity, outcome authority and a corrected observation with old history intact.
A synthetic completed fixture cannot establish that Sleeper exposes this chain.

The five inspected leagues have no reported playoff results yet. That limits
these samples; it does not establish that no suitable 2026 source can exist.
Do not traverse prior seasons, accelerate the calendar, redefine finality or
move the representative obligation to CP20. CP13 retains supported semantics
and representative completion/correction; CP20 retains full-current-season
application. Earlier paid-run authorizations remain consumed.
