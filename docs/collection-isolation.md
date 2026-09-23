# Collection isolation

This is a backend capability. It does not define the final account or league user experience, enroll more leagues, add a collector, or change scoring arithmetic.

## Registration

The administration store exposes intended enrollment membership separately from registration readiness. Missing season registration, scoring profile, or source connection is an explicit failure for that member. Healthy members remain eligible. An ambiguous or unidentifiable inventory and a database outage still fail closed.

Current, future and observation workers retain the complete intended league-key inventory when synchronizing watches. A temporarily unavailable registration never implies removal: its old watch rows remain retained and are excluded from execution. Worker results include unavailable members in failure reporting.

Public and targeted operator lookups resolve the requested league instead of requiring the complete fleet to be healthy. Database-enabled reads never substitute bootstrap Sleeper IDs. Bootstrap remains limited to database-disabled development and Preview. Existing public route names, league selection and preference identities are preserved.

## Shared statistics and independent acceptance

The existing all-player operation loads the canonical exact-week NFL schedule, catalog, stored projections and game context independently of fantasy league rosters. It requests one shared Sleeper statistics response under the existing ownership, receipt and request-budget rules. Valid immutable raw evidence is saved before league-specific validation.

Each league then validates its own exact source identity, period, schedule, starters, roster population, stored scoring rules and official points. League source waits are bounded and processing uses a fixed pool of at most eight tasks. Errors are recorded per league; a rejected league cannot roll back a successfully accepted peer.

The same `sleeper-actual-v1` calculator builds each distinct scoring profile once per operation. `all-player-score-content-v2` identifies shared score material without including league membership or official-point evidence in its hash. It is a material contract version, not a second scoring formula. Legacy content and hashes remain unchanged.

Neon stores immutable league acceptance records and league-scoped current pointers. Acceptance proves the target registration, profile, exact week, physical official point rows, strict parity and live worker fence. Leagues with identical rules share score rows but advance separate pointers. A failing league retains its last accepted result. Reads may use legacy publication only when its retained parity evidence explicitly includes that league; a scoped pointer takes precedence.

Raw capture completion and league acceptance are separate facts. The job records the capture plus accepted and failed work. A complete final NFL capture can satisfy the shared capture obligation without claiming that every league has accepted its scores. Failed corrections preserve earlier final-capture evidence. Existing provisional raw-stat readers retain their provisional semantics.

A successful empty response before kickoff uses shared NFL schedule and game-state proof. It neither stores a fabricated zero-stat capture nor publishes a league result. Unavailable league registration cannot block this no-statistics-yet outcome; kickoff, response timestamps, ownership and request-budget checks still apply.

## Integrity and limits

Shared provider, canonical inventory, or shared persistence failure can still affect every consumer of that source. League isolation cannot make unavailable provider data current. Invalid or partial evidence does not replace a complete accepted result.

Existing global provider ownership, request budgets, exact-week behavior, immutable history, frozen projection baselines and the single projection pipeline remain. Acceptance rechecks ownership and deadline at the database boundary; old workers cannot publish after takeover. Accepted official evidence and score children remain sealed and retained.

This change does not establish a maximum league capacity or fixed refresh promise. The existing request envelope, invocation duration and maintenance cadence still apply. The [measured capacity report](collection-capacity-validation.md) records scheduler limits and isolated database results. Durable per-league retry scheduling, continuation across bounded invocations, maintenance fairness and live-provider/Vercel capacity remain follow-up work. New league enrollment remains a separate decision.

## Qualification and rollout

Migrations `023_all_player_league_acceptance.sql` and `024_all_player_scoped_completion.sql` are additive. Apply them before deploying the new callers, using the reviewed migration workflow. Existing functions and legacy pointers remain available for application rollback; do not delete new acceptance history or rewrite old hashes.

Required checks include mixed healthy/unavailable registration, retained watch state, independent source/profile/parity failures, same-profile league separation, raw capture before league validation, shared calculation reuse, stale/equal-time publication rejection, exact replay, lease expiry, role restrictions, evidence sealing, reader fallback, and completion after partial success. Provider-free tests do not replace isolated Neon tests or measured capacity evidence.

Implementation, preview, migration application and production release must be reported separately. This document alone is not deployment evidence.
