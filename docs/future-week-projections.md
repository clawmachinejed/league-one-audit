# Future-week projection operations

The independent future lane prepares periods owned by future materialization, including the preseason default display week. It uses the existing scoring engine, `clock-v1`, snapshot payload, and publication path. The [lineup freshness runbook](lineup-freshness.md) describes the full three-lane architecture, browser protocol, and operational recovery. The [implementation ledger](lineup-freshness-plan.md) records release evidence and approved clarifications.

## Authority and ownership

The current lane refreshes operational NFL and league authority approximately every minute. The future and observation lanes read that persisted authority in a batch; they do not fetch the calendar independently. Authority older than ten minutes, contradictory identity, or invalid state prevents work for the affected league. Another healthy league can continue.

The default display period and active scoring period are distinct. The highest stored snapshot never defines the current week. During preseason, the default display period is observed every minute but is materialized by the future lane. Later configured periods receive three-minute observation. During the active season, the active scoring period belongs to the current lane and later periods belong to the future lane. Earlier periods, or all periods of a completed league, receive no automatic observation. An NFL game becoming final does not by itself advance the fantasy week.

Runtime supplies each league's matchup range; the current configuration covers Weeks 1–18. Scheduling uses that supplied range rather than a second hardcoded horizon. Ownership changes invalidate incompatible in-flight work.

## Two separate preparation actions

Each future invocation selects at most one provider-period action. Healthy leagues in that period share the action's provider data.

### Projection ingestion

The worker requests the selected weekly Tank01 projection slate, validates its provider envelope, normalizes it once, and stores immutable content plus an observation in Neon. A current pointer advances only to a valid observation. Equal normalized content may create a new observation for freshness while reusing the content identity. Schedule-aware completeness is also required before materialization can use the slate.

The stored slate is league-independent. Ingestion does not load fantasy lineups or calculate team totals. Current and future runtime compositions use the same cached projection-feed implementation and existing cache policy.

### League materialization

The worker reads the stored slate, reserves full-source observation, loads fresh Sleeper lineup and scoring data, and requests one fresh Tank01 game-state slate shared by ready leagues. It validates lineup shape, completeness, schedule coverage, identities, and the selected period. Then the shared pipeline:

1. Resolves player, defense, and NFL-game identities.
2. Stores shared game-state and provider observations.
3. Normalizes and scores each distinct raw scoring profile once for the action.
4. Preserves eligible kickoff baselines and the existing live calculation.
5. Records the complete official league observation with its actual lineup revision.
6. Builds and publishes the existing `MatchupsData` snapshot with an ownership fence.
7. Atomically completes future materialization and acknowledges the lineup revision proved by that official observation.

Materialization makes no Tank01 projection-feed request. It does request game states. An absent individual projection becomes zero only after slate-level validation succeeds. Incomplete fantasy matchups, contradictory schedules, and unresolved pairings cannot publish fabricated snapshots.

## Dirty-lineup priority

The thin observer records a changed lineup as durable pending work. Pending is the difference between the latest accepted lineup revision and the last successfully materialized lineup revision; it is not a browser request or an in-memory flag.

Eligible pending groups with a usable stored slate are selected before groups requiring ingestion, then before routine work. Within the same priority class, the oldest pending change wins, with deterministic period and league tie-breakers. Leased and backed-off work is skipped so it cannot starve another eligible group.

An eligible stored slate is reused for a pending lineup even when its routine refresh is due. If the slate is missing or has been rejected, projection ingestion and materialization are awakened together. Ingestion consumes one invocation; materialization remains due for a later invocation. Pending changes may bypass the routine Week+1 canary and initial staggering, but never validation or failure backoff.

## Routine reconciliation

Routine preparation continues even when no lineup changed. For ordinary later weeks:

| Distance from authoritative active/default period | Projection-slate interval | Broad materialization interval |
| --- | --- | --- |
| Week + 1 | 6 hours | 1 hour |
| Weeks + 2 through + 4 | 24 hours | 24 hours |
| Week + 5 and farther | 7 days | 7 days |

Initial later-week work is staggered by 15 minutes per distance step. Routine work beyond Week+1 uses the existing canary eligibility; each eligible league must have its Week+1 materialization. It is not a global block on a different healthy league's pending change.

The preseason default is a special case: its routine eligibility uses the existing hourly/live-window preparation policy from persisted cadence facts, rather than treating it as an ordinary distant week. Its pending lineup work remains immediately eligible under the normal safety rules. The one-action-per-invocation split still applies.

When leagues share a provider period but have different distances, shared projection refresh uses the closest eligible distance. Each league retains its own materialization distance and cadence.

## Freshness and acknowledgment

Future snapshots remain last-known-good data. A valid older snapshot can be usable with `refreshDue: true`; snapshot age alone does not discard it.

Freshness checks use active provider/normalizer/model identity, projection content and observation, the complete official observation, the published snapshot revision, and durable attempt/due state. If identical public content is revalidated, publication returns `unchanged` and advances `verifiedAt`. Future completion must prove that the matching snapshot was published or verified after the complete official observation.

The requested pending revision and the actual full-source revision may differ. If revision B is selected but the full load sees C, acknowledgment records C. If a newer thin C arrives after a valid B full load, B may finish while C remains pending and due. A stale lane, retired row, expired claim, or incompatible ownership generation cannot publish or acknowledge. A failure for old work cannot delay a newer pending change.

## Failure and execution limits

Observation failures and future-action failures have different retry policies:

| Failure type | Retry schedule |
| --- | --- |
| Invalid/unavailable lineup observation | Normal 60/180-second interval, then 5 minutes, 15 minutes, and 60 minutes |
| Future ingestion/materialization action | 5 minutes, 15 minutes, 1 hour, then 6 hours |

A complete or healthy not-ready lineup response clears its observation-failure count. Not-ready matchups retain accepted data and retry at their normal observation cadence. Failed actions preserve the prior snapshot and pending lineage.

Each future run has a 120-second global job lease. Individual future attempts use 55-second leases. No new future stage begins after 45 seconds of total execution; the operation aborts at 50 seconds, with a separate cleanup attempt bounded to four seconds. Scoped Neon work shares cancellation, and provider waits are bounded by the operation deadline. The Vercel function limit is 60 seconds. Database ownership and publication fences remain necessary even when cancellation is requested.

One league's loading, scoring, or publication failure does not block a healthy peer. A failed shared provider slate, identity resolution, or shared persistence stage affects the leagues relying on that group. Missing authority is reported as a failure, not successful idle. No failed or incomplete refresh replaces a valid snapshot.

## Capacity and validation

Three-minute observation is a source-check target, not a promise of publication every three minutes. Future changes also wait for the selected action, any projection prerequisite, and the browser's next visible 60-second revision check. With no backlog and healthy sources, the contract targets approximately four to six minutes end to end, with a more conservative seven-to-eight-minute operating envelope. These are objectives to validate, not guaranteed latency measurements; Sleeper does not expose the manager's lineup-mutation timestamp.

The two-league configuration is within the observation budget. Week 1 demand for 50 or 300 leagues is explicitly unsupported by the production gate; synthetic tests prove bounded behavior, sharing, and rejection, not those fleets' three-minute cadence. Distributed tasks, a database-backed registry, rate-limit and remote-load testing, and renewable distributed claims remain deferred. Existing publication fences are already implemented.

Obsolete watch rows are retired when provider/version, league identity, season, range, or ownership changes. That watch lifecycle is not a complete retention policy for every older provider-slate pointer or future-refresh record. A broader multi-season retention policy remains separate work.

The isolated Neon suite covers source ordering, atomic acknowledgment, identity and lifecycle fences, immutable content, claims, retries, snapshot verification, permissions, and safe reads. Real-game verification remains open until live 2026 transitions can be observed: kickoff, clocks, halftime, final convergence, future lineup changes during current games, missing projections, empty slots, byes, D/ST, team sums, both leagues, request counts, duration, skew, and browser adoption.
