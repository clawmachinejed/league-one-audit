# CP13 selected 2025 source evidence

[source.json](source.json) retains true-2025 public observations under the narrowly approved [testing exception](../../../../../docs/aggregator-backend/data-backend-readiness-contract.md). The source season is preserved as `2025`; this is offline source-semantics evidence. Production intake and typed bracket persistence/composed-reader season guards remain 2026; the existing generic source normalizer already accepts the true 2025 observations. No prior qualification profile or accepted run is replaced.

## Acquisition and integrity

The unchanged `capturePublicSleeperCore` adapter at source `46d7145260ac83ddc667957d92808c8b3a9840b4` captured ten documents between `2026-10-13T01:40:49.830Z` and `2026-10-13T01:41:21.873Z`. The three candidate league IDs came directly from the existing `manager-history-2025-2026.json` fixture. No annual link was followed. The acquisition made three metadata GETs, followed by Dynasty's two brackets and weeks 15-17, then the two other winners brackets. All ten responses returned HTTP 200. No retry, redirect, authentication, cookie, credential loading, database access or production action occurred.

The final ignored local manifest is `apps/site/test-results/data-backend/cp13/test-source-2025/2026-10-13T01-40-49-828Z/manifest-resources-10.json`, SHA-256 `df34002441c82c7ba4bfaa7be5a2f980882b3c0725a6f82b10bbdc8c555b99f7`. The earlier three-request metadata manifest has SHA-256 `c379db744f75d9cf9be95c1db3273e5956e447bc8385bc96543abd5f1e7df1c7`. Original artifacts total 30,751 bytes. These digests and byte counts describe the adapter-serialized documents, including a trailing newline, not original HTTP response bytes. Local raw artifacts are not required to run the offline tests.

The request ceiling was 18 with at most three candidate metadata requests; acquisition stopped after ten. Each capture retained the existing 20-second work bound, 12-second adapter timeout, 8-MiB response limit, 250,000-value limit and depth-64 limit. The longest observed capture took 374.2031 ms. These are acquisition measurements, not SQL persistence or aggregate intake deadline qualification. The fixture preserves each request, response URL/status/content type, original envelope, independent request/source clocks, original artifact hash and byte count, and elapsed time. Fetch-start time is recorded separately from the enclosing capture-start time.

## Minimized native payloads

`samples[].resources[]` contains `family`, `nativeWeek`, `source`, `document` and `sliceSha256`. Payload minimization uses own-property selection, preserves native values and array order, and never adds defaults:

- League documents retain `league_id`, `sport`, `season`, `season_type`, `status`, `total_rosters`, `settings`, and `scoring_settings`, in that order. Both full native settings objects contain only numeric values in these captures. If originally present, `metadata.latest_league_winner_roster_id` is retained as an opaque native marker. Names, avatars, chat/display metadata, personal identities, annual links and unrelated object IDs are omitted.
- Matchup documents retain every row with `roster_id`, `matchup_id`, `points` and `custom_points`, in that order. Player and lineup fields are omitted; absent fields remain absent and explicit null remains null.
- Winners/losers bracket payloads are unchanged, including every row property, advancement reference, order and null payload.

`originalPayloadKeys` and `originalMetadataKeys` list the original league field names without their omitted values. `originalRowKeyInventory` groups identical original ordered row keys and lists their zero-based source row ordinals. These inventories distinguish minimization from provider absence. The original matchup rows contain player/lineup fields but no additional explicit result, finality, series or aggregate field.

`sliceSha256` hashes UTF-8 `JSON.stringify(document)` without a trailing newline. The original envelope member order, selected payload order, nested native order and array order are retained. Before saving, all ten original hashes and byte counts were checked against the manifest, retained fields were compared with the source under this policy, and all ten saved slice hashes were recalculated. The fixture's file SHA-256 is `8b684ac0a3639b2d8009fb1c7c8618e2baf466451eb85f924a89486d44039463`; its parsed JSON SHA-256 is `ea7ef812da8eb99ed0e2a079fc6362f52ec28917dc1a0adad0a5fe163a1615d8`.

## Observed results and period context

| Sample | Native league ID | Native season/status | Retained results |
| --- | --- | --- | --- |
| league1 | 1188632688331706368 | 2025 / complete | Winners bracket explicitly null |
| league2 | 1188632897157021696 | 2025 / complete | Winners bracket explicitly null |
| dynasty | 1187615589508243456 | 2025 / complete | Four winners rows, four losers rows, ten matchup rows in each of weeks 15, 16 and 17 |

All eight Dynasty bracket rows supply distinct resolved `t1`/`t2` entrants and a valid `w`/`l` pair naming those entrants. The first winners round supplies winners 5 over 1 and 4 over 7. Winners round 2, native bracket match `m: 3`, supplies `w: 5`, `l: 4`, `t1: 5`, `t2: 4`, and advancement references to the first two winners. The second round also retains the native loser-path progression. The losers bracket independently supplies four resolved outcomes and its advancement references. This is positive native played-result evidence for the existing four-ID interpretation, not an outcome inferred from scores, league status or the opaque `p` field.

Dynasty metadata reports `playoff_week_start: 15`, `playoff_teams: 4`, `playoff_round_type: 1`, `leg: 17` and `last_scored_leg: 17`. Week 15 pairs 1/5 and 4/7, matching the first-round entrants. Weeks 16 and 17 both pair 4/5 under native weekly `matchup_id: 1`, providing the observed multiweek playoff context alongside the round-type setting. Weekly matchup IDs and bracket match IDs are different namespaces; the captures contain no explicit API series/leg link or provider-supplied aggregate object.

For the retained 4/5 pairing:

| Native roster | Week 16 points | Week 17 points | Derived two-week sum |
| --- | ---: | ---: | ---: |
| 5 | 159.38 | 136.42 | 295.80 |
| 4 | 136.20 | 158.20 | 294.40 |

Week 17 alone favors roster 4, while the bracket explicitly names roster 5 as winner. The sums are explanatory arithmetic corroborating the observed multiweek context; they are not provider-supplied aggregates and are never used to manufacture an official result. All 30 `custom_points` values are explicitly null. Rosters 2 and 10 have null pairing IDs in each captured week; this does not establish a bye.

## Limits of this evidence

The fixture establishes actual 2025 played outcomes and observed single-period/multiweek playoff context for pure interpretation tests. It does not enable a 2025 production ingest, qualify true-2025 SQL identities or receipts, or demonstrate hosted operational behavior. Archived-league settings are observations at retrieval time, not a ledger proving when each setting took effect. Retrieval clocks remain distinct for every resource.

No actual before/after correction was observed. Existing correction/recovery tests remain simulated and keep their original evidence bindings. The captures do not establish an irreversible finality guarantee, explicit native series aggregation/linkage, general round-to-week indexing, seed semantics, or a positive bye. Null brackets in the two other complete leagues remain null observations, not successful played samples. These limits describe the retained source rather than create new collection or approval obligations.
