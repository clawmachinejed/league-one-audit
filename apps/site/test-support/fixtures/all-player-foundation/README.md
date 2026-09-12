# Retained all-player foundation fixture

This is one shared sanitized package from the September12,2026 audit at
`5d84582475780164853104fab75ddc9e9d0e64f2`. It is the incomplete 2026 regular-season
Week1 response:301 weekly rows, two completed NFL games and14 unplayed games at
the captured time. It must never be used to claim complete shadow or backfill.

`provenance.json` records original source-file hashes and the sanitized file
hashes. Catalog files retain official identity names, IDs, fantasy memberships,
team/status/activity classifications; injury metadata was removed. Roster and
matchup files contain required game evidence with no user/owner profiles. The
stored game, projection and mapping evidence was decoded from the audit export;
job records were removed. No secrets or connection strings are included.

`reviewed-participation.json` transcribes the audit's cited gamebook and waiver
findings for Jones, DeVito, Willis and Brown. Its timestamp is the fixture
transcription time, not a claim of a new gamebook or statistics request. The
helper's replay timestamp permits testing reviewed evidence against the
unchanged earlier weekly response. Henderson's row remains absent.

The original full unfiltered player catalog was not retained. Its selected
identity sample proves the actual 8063 wrong-person classification but cannot
classify 201 other response identities. The original captured-observation tests
preserve that result: 4,385 inventory entries, 201 unclassified response IDs and
4,320 unknown eligibility counts with reviewed participation evidence.

`weekly-identity-supplement.json` is a separate current official catalog capture
observed at `2026-09-12T16:36:36.000Z`. From 12,227 raw catalog identities, it
retains 298 relevant identities: the 297 non-TEAM weekly response IDs and the
reviewed 8063/12048 anchors, deduplicated. Its 97 overlapping identities have
no metadata differences from the original fixture. Runtime replay adds only the
201 absent identities and never overwrites an original field. Brown's retained
Inactive metadata and all five named eligibility cases remain unchanged.

Those 201 additions are out of fantasy scope based on official primary positions
and fantasy memberships through the shared classifier: C 3, CB 13, DB 41, DE 17,
DL 14, DT 20, LB 34, LS 4, OG 3, OL 34, OT 9, P 6 and T 3. A separate adapter test
classifies the unchanged 301-row weekly response, retaining 205 excluded source
rows (these 201 identities and four TEAM aggregates), with zero unclassified
response IDs and no larger fantasy inventory. No statistic-key allowlist is
used to infer identity. Current classification does not establish requested-week
eligibility, so the replay remains partial with unknown denominators and
fourteen nonfinal scheduled games.

Provenance records both the original raw catalog checksum and the sanitized
supplement byte checksum. The shared replay loader verifies the canonical JSON
checksum, exact capture scope and recorded overlap differences; canonical JSON
allows harmless checkout line-ending conversion. No weekly-statistics or Tank01
request was made for this supplement. The original six catalog files, weekly
response and captured-observation helper remain unchanged.

`null-role-identity.json` retains actual official identity 2901 from that same
raw catalog with null primary position and fantasy memberships. Its separate
regression uses a clearly synthetic weekly row to verify that absent role
metadata remains unclassified response evidence and fails when required. Null
role fields already pass through `projectPlayerCatalog` as absent fields; the
shared classifier now agrees for direct raw inputs. This is a boundary
consistency repair, not a demonstrated live production failure. Non-null
malformed role fields continue to reject. Provenance distinguishes the captured
identity from the constructed response and records its checksum.

The fixture exercises actual source shapes and49 observed roster-player scoring
comparisons. Those comparisons cover25 distinct players and are a subset of
both full rosters. Synthetic complete inventory/period/lease variants belong in
the separate unit and isolated database tests and must be labeled synthetic.

`runtime-source-supplement.json` records a later official Sleeper observation
at 2026-09-12 15:50 UTC, packaged at 15:51:49.783 UTC. Six reads supplied only
fields the audit omitted but the real operator loader requires: league name
and roster count, roster standings settings, and matchup pairing IDs. Every
retained roster and matchup field matched exactly, including player/starter
array order and all point values. League identity, season, status, scoring
settings and roster positions also matched. The unrelated daily waiver hour
changed from 5 to 7 in both leagues; the replay preserves the original value.

The runtime fixture merges only absent fields and rejects overwrites or changed
roster identities. `provenance.json` records the supplement's byte hash and a
canonical JSON hash used by the replay, so line-ending conversion cannot hide
a content change or cause a false mismatch. The original audit files remain
unchanged. No weekly-statistics or Tank01 request was made for this supplement;
the weekly response and incomplete-period outcome remain the original evidence.

Offline verification of the entire retained raw catalog completed at
`2026-09-12T18:33:54.622Z` with Node 24.19.0. All 12,227 raw rows passed through
the shared classifier, `projectPlayerCatalog` and the official identity inventory
with zero malformed or invalid rows. Raw and normalized classification agree:
4,356 fantasy identities and 7,871 coarse nonfantasy classifications. The latter
includes absent-role records: 240 primary positions and 325 fantasy memberships
are null in the raw source. Those null-role records do not positively establish
an out-of-scope weekly identity; the response-classification guard keeps absent
role evidence unknown. Required official identities remain strict.

The full current catalog has a net three more fantasy players than the original
retained catalog's 4,353 player identities (4,385 including constructed defenses).
This later membership count does not establish requested-week inclusion or
eligibility. The supplement still adds only the 201 absent weekly identities;
the original captured observation and its counts remain unchanged. The offline
verification made zero provider requests and zero database writes. Provenance
records the raw source checksum, verification time, methods, complete counts,
external result checksum and these limits; the 12,227-row raw source is not
included in the sanitized fixture package.
