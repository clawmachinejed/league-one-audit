# All-player statistics foundation

This foundation stores provider-native weekly statistics once and scores the
same immutable content once for each unique scoring profile referenced by the
configured leagues. It does not expose PPG, rankings, or a browser/API payload.

## Data model

Migration `010_all_player_statistics.sql` adds exactly these tables:

1. `all_player_stat_contents` — deduplicated semantic weekly content.
2. `all_player_stat_entries` — raw per-player or team-defense statistics plus
   NFL game, position, team, game phase, eligibility evidence, appearance, and
   stable ordinal.
3. `all_player_stat_observations` — append-only retrieval evidence, including
   source fingerprint/ETag and request times.
4. `all_player_score_sets` — immutable content/profile/scorer results and the
   full publication audit.
5. `all_player_scores` — weekly points, game phase, exact eligible-game count,
   and per-rule breakdown for each canonical scoring entity.
6. `current_all_player_score_sets` — one guarded current pointer per provider,
   period, scoring profile, and scorer version.

Weekly points come from `all_player_scores`. Season points are `sum(fantasy_points)`
over current weekly score sets. Weekly and season position ranks are window
functions over those same rows. PPG remains deliberately unimplemented; its
future denominator is `sum(eligible_game_count)`.

## Publication gates

The all-player route is an undocumented dependency isolated in one adapter. A
retrieval validates every top-level member and every stat value before retaining
content. Its expected inventory is a deterministic fingerprint over the reused
complete player catalog, roster and projection identity checks, all 32 team
defenses, the full NFL week schedule, bye evidence, and reviewed status evidence.
The fingerprint includes the catalog and schedule revisions plus sorted roster,
projection-candidate, and bye identity sets. Each of the six position-filtered
catalog responses must be structurally complete; a malformed catalog row makes
the inventory unavailable. An unexpected response identity is excluded only
when its stat shape proves it is an IDP row; otherwise the batch is partial.
The adapter makes one no-store weekly request, never a player request, keeps an
ETag when available, and otherwise produces a stable SHA-256 response fingerprint.
It never logs the response body.

The current pointer advances only when all of these are true:

- content, observation, and score-set quality are complete;
- the fingerprinted expected-entity count matches physical entries, including
  exactly 32 team defenses, with zero unknown eligibility or eligible entities
  missing an NFL game;
- every scored identity is unambiguous and backed by the existing verified
  canonical provider mapping;
- every eligibility decision is known and every eligible player maps to an NFL
  game in the same season, week, and team context;
- discriminated eligibility evidence independently re-derives the stored
  eligibility and appearance counts in both application and database guards;
- every active scoring rule is in the database-bound allowlist for the exact
  provider and `sleeper-actual-v1` scorer contract;
- one coordinated batch contains exactly the unique scoring profiles used by
  canonical `league1` and `league2` season registrations;
- calculated points match every rostered `players_points` value carried by the
  exact complete league-week observations named by the score set; each
  observation proves its physical player/roster counts, sorted roster IDs, and
  fingerprint, matches `league_period_authorities.expected_roster_ids`, and is
  bound to the same canonical league connection and all-player source revision;
- every peer scoring profile in the coordinated batch independently has all
  physical score rows, valid eligibility totals, supported rules, authoritative
  roster coverage, and physical official-point parity before any profile moves;
- stored entry, score, and eligible-game totals exactly match the immutable
  parent records.

An active entity with `gms_active=1` and no `gp` evidence receives appearance 0,
eligibility 1, and exactly 0.0000 points. Explicit `gms_active=0` evidence receives
eligibility 0. Missing or contradictory evidence remains null and prevents score
publication. A failure leaves every prior current pointer intact.
Official parity observations referenced by an immutable score set are excluded
from retention. Their parents and children cannot be changed or extended; exact
child replays remain idempotent. Provider-ID fingerprints are reconstructed from
the immutable score rows rather than the mutable many-alias identity crosswalk.
Automated parity fixtures retain the exact Sleeper scoring settings shared by
League One and League Two for 2024–2026 and representative official QB, skill,
kicker, defense, inactive, and active-zero totals.

## Controlled rollout

Each stage requires its own bounded authorization after the reviewed PR:

1. Apply migration 010 only. Verify its committed checksum, runtime ACLs, six
   table definitions, and that the old application remains healthy.
2. Deploy the dormant application foundation. Do not schedule ingestion yet.
3. Run one shadow 2026 Week 1 retrieval. Validate structure and coverage, resolve
   identities through the existing catalog/crosswalk and NFL-game tables, build
   every unique league scoring profile, and inspect parity without advancing a
   pointer if any gate fails.
4. With separate backfill authorization, persist that one Week 1 observation and
   its complete score sets atomically. Confirm both profile pointers, active-zero
   rows, eligibility totals, and zero parity mismatches.
5. With separate activation authorization, attach the same operation to the
   existing worker/publication ownership path. Do not add another cron, provider
   feed, scorer, catalog, or browser request path.

The incremental provider cost is one all-player weekly-stat request per batch,
shared by both leagues and all profiles; there is no Tank01 request increment and
no per-player fanout. A completed week is expected to contain roughly 550–750
fantasy entities. The exact 2024–2026 League One/Two scoring settings are one
shared unique profile, so the expected current batch is roughly 550–750 raw rows
and 550–750 score rows; if the leagues diverge to two unique profiles, score rows
double to 1,100–1,500. A conservative planning allowance remains 3–8 MB per week,
or about 55–145 MB for one 18-week season including JSON breakdowns and indexes,
until the shadow run supplies measured `pg_total_relation_size` values.

Monitor request outcome and latency, response fingerprint changes, content and
score row counts, unknown eligibility, ambiguous identity, missing game coverage,
unsupported rules, parity comparison/mismatch totals, pointer outcome, and pointer
age. Metrics and errors contain counts and fixed endpoint families, never full raw
payloads.

Rollback is operational and non-destructive: stop the not-yet-existing ingestion
activation, leave the last verified pointers in place, and deploy the compatible
pre-feature application if needed. Corrections create new content/observations/
score sets and advance the guarded pointer; immutable history is not updated or
deleted. Dropping tables or rewriting production data is not part of rollback.
