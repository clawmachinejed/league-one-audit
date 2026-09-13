# Actual position-rank regression evidence

`production.json` is a sanitized, read-only extraction of stored production raw
history, checked at `2026-09-13T19:21:28.10051Z`. It refers to the September 13
`19:00:28.921Z` partial observation `c477ce57-92b5-5f12-aa84-cdb2e77ca45f`,
content `612210bc-ff64-5c7b-a2bb-638ac65d8f89`, for 2026 regular-season Week 1.
The extraction was supplied by the release owner; fixture preparation performed
no provider request or production write.

The file is copied byte-for-byte from the supplied extraction. SHA-256:
`976439eb3e77c8e534cd3d40706cd0e08c40274cfe57f0f1987d34af65b7200c`.
It retains 321 extracted SQL candidate rows plus two zero-participation controls
(Mac Jones `7527` and TreVeyon Henderson `12529`), 323 rows total, full sparse statistics, official
IDs, entity kinds, positions, eligibility evidence/counts and observed mapping
presence. It contains no credentials, connection strings or player names.

- 302 usable mapped identities: 282 players and 20 defenses.
- 21 absent player mappings: 2 QB, 5 RB, 7 TE and 7 WR.
- Nonzero unmapped actual scores under the real shared rules: official IDs
  `11280` (3 points), `12048` (2.9 points), and `12732` (1.6 points).
- ID `12732` has unknown eligibility and appearances. Its actual total can be
  ranked while its PPG remains unavailable; no appearance is invented.
- The retained projection-coverage diagnostic is `RB`. It describes projection
  identity coverage and must not determine the actual-stat comparison population.

The real reader selects 321 fixture rows plus one metadata row, 322 SQL rows.
The two zero controls do not satisfy its appearance/nonzero-stat predicate.
These 323 retained rows are not the full 4,388-entry
foundation inventory and not a complete Week 1 fixture. Other inventory rows,
unplayed games, complete official parity and publication are outside its proof.

Pure reader tests use this same fixture. Isolated PostgreSQL tests insert the
actual stats, evidence and mapping presence into a rollback-only synthetic
season. They rebase effective-period fields and observation time and use a
synthetic game/team solely to satisfy unrelated database context constraints and
exercise current mapping validity independently of when the test runs. The source file is unchanged.
The second scoring profile changes only the reception weight to prove isolation;
both production leagues actually share the original profile.

Expired, future-dated, retired, unverified, wrong-kind and conflicting mappings
are explicitly synthetic variants. Later registration after the raw observation
is also synthetic. Those cases prove read-time enrichment and fail-closed guards;
they do not assert that those bad states were observed in production.

Database tests run only through the existing guarded isolated Neon harness.
Fixture semantics are checked in the rollback-only owner transaction so no
synthetic history must be committed or deleted. Every reader invocation issues
one SELECT-based statement and leaves raw history, canonical mappings, score
history and pointers unchanged. A separate actual runtime-credential session
executes the identical query to prove permissions; the uncommitted fixture is
not visible to that session, so it returns no metrics. The owner cannot assume
the runtime role, and the tests do not grant that capability. The normal harness
applies existing migrations to its freshly reset isolated database; no test adds
a migration, changes production data, adds a provider feed or relaxes writer rules.
