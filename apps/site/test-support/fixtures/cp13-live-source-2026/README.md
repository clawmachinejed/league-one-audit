# CP13 retained public 2026 source slices

[source.json](source.json) contains minimized copies of the five-league public capture made with the existing `capturePublicSleeperCore` adapter against executable source `14c6d7b1f1b053abb26f2c8f2c17b57b24b3af32`. These are real provider observations replayed offline, not authored positive outcomes or a database qualification fixture.

## Acquisition and provenance

The completed inventory is `apps/site/test-results/data-backend/cp13/live-source-inventory/2026-10-12T15-38-04-356Z/manifest.json`, SHA-256 `85ab60e5e4e5e785342122d6147520d14aac21859d1b6b5bea3391988818155a`. Raw artifacts remain local evidence and are not required to run the offline tests. The fixture retains the original source revision, manifest digests, request/source observation timestamps, endpoint and response URL, HTTP status, content type, original serialized-document byte count and digest, plus the reuse marker for each document. Digests describe adapter-serialized captured documents, not original HTTP response bytes.

The first attempt, `2026-10-12T15-36-48-946Z`, stopped with `AssertionError: Current native leg unproved` after one successful league1 metadata GET. The disposable inventory script had inspected top-level `leg` instead of `settings.leg`. The resumed attempt reused that response unchanged, including its original `2026-10-12T15:36:56.262Z` observation time, and made 24 further GETs. The completed manifest's 25 request entries already include the earlier request: there were **25 total GETs**, not 26. All returned HTTP 200. The prior stopped result remains stopped; it is not rewritten as a successful run. No retry, redirect, credentials, SQL access or production action occurred.

All five selected matchup requests used native `settings.leg: 5`. That field is a current observation and request-selection input only; it does not establish historical settings applicability, a completed period, an official result or finality. Per-endpoint timing and configured 20-second capture / 12-second adapter bounds do not qualify aggregate intake or persistence deadline fit.

## Retained slice policy

`samples[].resources[family].document` preserves the captured document envelope and its exact timestamp strings. Only its payload is minimized, using own-property selection without adding defaults or changing native values:

- League payload: `league_id`, `sport`, `season`, `season_type`, `status`, `total_rosters`, `settings`, in that selected order. The entire native settings object remains intact.
- Roster rows: `league_id`, `roster_id`, `settings`, in that selected order. The entire native settings object remains intact. Player lists, owners, co-owners and display metadata are omitted, so these slices do not qualify roster membership or ownership.
- Matchup rows: `roster_id`, `matchup_id`, `points`, `custom_points`, in that selected order. Omitted fields stay omitted; explicit null stays null. Player and lineup arrays are omitted.
- Winners/losers bracket payloads: unchanged, including null payloads, all row properties and array order.

`sliceSha256` hashes UTF-8 `JSON.stringify(resource.document)` with no trailing newline. Original envelope member order, the payload selection order above, nested native object order and array order are retained. Pretty-print whitespace in `source.json` is excluded. This digest is distinct from `serializedDocumentSha256`, which hashes the original unminimized serialized document file. At creation, all 25 original digests and byte counts were checked against the manifest, every retained value and field presence was compared with the original payload under this selection policy, and all 25 saved slice hashes were recalculated. Tests recheck slice integrity without requiring uncommitted raw artifacts or network access.

## Observed coverage and limits

| Sample | Native league ID | Rosters | Winners / losers bracket rows |
| --- | --- | ---: | --- |
| league1 | 1378850182409490432 | 12 | null / null |
| league2 | 1378850360529014784 | 12 | null / null |
| dynasty | 1312138224994385920 | 10 | 4 / 4 |
| keeper-sample | 1395875117568913408 | 12 | 7 / 7 |
| redraft-sample | 1398809418962898944 | 12 | 7 / 7 |

All 58 roster observations supply W/L/T and positive PF/PA with their native hundredths components. The keeper sample supplies `ties: 1` for roster IDs 10 and 12; these are season record facts and do not identify a particular tied matchup. `settings.rank` and `settings.seed` are absent in all 58 observations. This is absence in these captures, not a claim that the provider never supplies either field.

The two null bracket pairs are unpublished observations. The other three pairs supply 36 total match rows with real entrant IDs and 40 advancement edges. Every `w` and `l` is explicitly null. Published structure does not establish playoff completion, a weekly/bracket join, a bye, a seed, a series aggregate, champion or finality. In particular, dynasty `playoff_round_type: 1` and bracket round IDs remain retained native facts without an asserted round-to-week interpretation.

The source slices and tests establish native-field-to-pure-projector parity only. They do not qualify canonical identities, committed typed PostgreSQL rows, restricted-role reads, ordinary intake persistence, hosted correction/recovery, actual positive bracket outcomes, or representative multiweek completion/correction. Standings and bracket components retain their separate observation times. The broader CP13 obligations remain open as recorded in the checkpoint evidence.
