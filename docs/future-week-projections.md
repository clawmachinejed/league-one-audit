# Future-week projection operations

The independent future lane prepares periods owned by future materialization, including the preseason default display week. It uses the existing scoring engine, `clock-v1`, snapshot payload, and publication path. The [lineup freshness runbook](lineup-freshness.md) describes the full three-lane architecture, browser protocol, and operational recovery. The [implementation ledger](lineup-freshness-plan.md) records release evidence and approved clarifications.

## Authority and ownership

The current lane refreshes operational NFL and league authority approximately every minute. The future and observation lanes read that persisted authority in a batch; they do not fetch the calendar independently. Authority older than ten minutes, contradictory identity, or invalid state prevents work for the affected league. Another healthy league can continue.

The default display period and active scoring period are distinct. The highest stored snapshot never defines the current week. During preseason, the default display period is observed every minute but is materialized by the future lane. Later configured periods use the accepted distance tiers: next week every 15 minutes, two through four weeks ahead every 60 minutes, and five or more weeks ahead every 360 minutes. During the active season, the active scoring period remains on one-minute observation in the current lane; later periods belong to the future lane with the same distance tiers. Earlier periods, or all periods of a completed league, receive no automatic observation. An NFL game becoming final does not by itself advance the fantasy week.

The [efficient lineup-check release note](efficient-lineup-checks.md) describes the cadence change and rollout status. Stable per-target offsets spread thin checks across absolute minute buckets without reshuffling other leagues. Policy changes fence incompatible claims; initial legacy adoption staggers healthy checks, later v2 tier promotion retains the earlier due time, and failure backoff/pending lineage remain intact. This changes how soon a future lineup edit is discovered, not the projection-feed or routine materialization schedules below.

Raw Sleeper display and scoring weeks can lead or lag one another. The current site policy derives both regular-season periods from the complete NFL schedule and the following-day noon Eastern boundary; it preserves the raw provider fields as evidence. Both periods still pass source, lifecycle, freshness and regression validation. See the [site week calendar](site-week-calendar.md), the historical [Week 2 rollover repair](week-two-rollover-repair.md), and the current [team-local missing-lineup policy](lineup-freshness.md#missing-team-starter-lists).

All site defaults and metric boundaries use that shared calendar. The existing current worker persists its resolved periods for all other lanes and readers. Explicit selections stay exact, including historical weeks. Open Current views refresh at the known boundary; stored-authority lag uses the exact official fallback until the normal worker adopts the new period. Calendar advancement never substitutes for lineup or score-publication readiness.

Matchups also re-resolves Current when an exact-week read observes newer authority. After at most two extra stored reads, continued movement uses the latest observed week in the official fallback; a usable snapshot for an older week cannot satisfy that default page request. Explicit week requests do not follow rollover.

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

Materialization makes no Tank01 projection-feed request. It does request game states. An absent individual projection becomes zero only after slate-level validation succeeds. A missing whole team starter list remains explicitly unavailable while healthy teams publish; it never becomes a zero-point lineup. Missing roster identities, contradictory schedules, and unresolved pairings still block publication.

## Dirty-lineup priority

The thin observer records a changed lineup as durable pending work. Pending is the difference between the latest accepted lineup revision and the last successfully materialized lineup revision; it is not a browser request or an in-memory flag.

Eligible pending groups with a usable stored slate are selected before groups requiring ingestion, then before routine work. Within the same priority class, the oldest pending change wins, with deterministic period and league tie-breakers. Leased and backed-off work is skipped so it cannot starve another eligible group.

An eligible stored slate is reused for a pending lineup even when its routine refresh is due. If the slate is missing or has been rejected, projection ingestion and materialization are awakened together. Ingestion consumes one invocation; materialization remains due for a later invocation. Pending changes may bypass the routine Week+1 canary and initial staggering, but never validation or failure backoff.

## Routine reconciliation

### Probability-model updates

A future snapshot that predates the current win-probability model is eligible for
rebuilding even when its lineup has not changed and its normal refresh date is
still in the future. The existing plan query checks the current snapshot for the
same league, season, week and projection model; a missing probability field or
different probability model on any matchup marks that snapshot for rebuilding.
A current-model `unavailable` result is already processed and does not trigger a
retry loop. Missing or empty snapshots keep the existing initial preparation path.

Real pending lineup changes retain first priority. Eligible probability upgrades
come next, before routine work, using the existing stored projection slate and
the existing one-period action per invocation. Canary, source readiness, cooldown,
lease, deadline and publication checks still apply. No projection-feed refresh is
forced just to add probabilities; the existing materialization still loads current
Sleeper lineups and one shared game-state response for its selected period.

The database repeats the model check when claiming work. Bypassing the routine
due time requires no outstanding materialization failures and a live future-job
lease owned by that attempt. A failed upgrade follows the existing retry schedule;
a publication that becomes current between planning and claiming cancels the
early claim. New snapshots go through the existing immutable publication path.
There is no migration, new cron, fake lineup revision, or change to `clock-v1`.
The version check adds server-side snapshot inspection to the existing plan/claim
queries and returns only a boolean; it does not download full snapshot payloads
into the worker. This is bounded catch-up work, not an instant all-weeks refresh.

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
| Invalid/unavailable lineup observation | First retry after 60 seconds for current-class watches or 180 seconds for future-class watches, then 5 minutes, 15 minutes, and 60 minutes; independent of the healthy distance tier |
| Future ingestion/materialization action | 5 minutes, 15 minutes, 1 hour, then 6 hours |

A complete or healthy not-ready lineup response clears its observation-failure count. Not-ready matchups retain accepted data and retry at their normal observation cadence. Failed actions preserve the prior snapshot and pending lineage.

Each future run has a 120-second global job lease. Individual future attempts use 55-second leases. No new future stage begins after 45 seconds of total execution; the operation aborts at 50 seconds, with a separate cleanup attempt bounded to four seconds. Scoped Neon work shares cancellation, and provider waits are bounded by the operation deadline. The Vercel function limit is 60 seconds. Database ownership and publication fences remain necessary even when cancellation is requested.

One league's loading, scoring, or publication failure does not block a healthy peer. A failed shared provider slate, identity resolution, or shared persistence stage affects the leagues relying on that group. Missing authority is reported as a failure, not successful idle. No failed or incomplete refresh replaces a valid snapshot.

## Capacity and validation

Healthy future lineup edits can wait for the next 15-, 60- or 360-minute observation bucket. A routine full materialization may discover a change earlier. Once detected, changes still wait for the selected action, any projection prerequisite, and the browser's next visible 60-second revision check. Backlog, failure backoff and busy ownership add delay. The original contract's three-minute checks and four-to-six/seven-to-eight-minute future timing objectives are historical; they are not promises under the accepted slower policy. Sleeper does not expose the manager's lineup-mutation timestamp.

The nominal lineup-observation allocation remains 20 checks per minute, shared by both lanes. Future targets reserve one slot, leaving up to 19 nominal current-class slots. If preseason/default current-class watches also need the observer, active-current admission is capped at 18 so both a default watch and future work can progress; otherwise the active-current cap is 19. Without future targets, the current-class allowance is 20. The observer uses the remaining allocation, with at most 18 future-class checks per invocation. SQL reserves a due future slot even amid a default backlog; default watches can use the spare slot when no future row is due. This does not promise every current league a one-minute check. Excess demand is diagnostic and due work proceeds oldest first within these bounds, instead of rejecting the whole fleet. No larger-fleet latency or throughput claim is established by this change.

At Week 2, three leagues' healthy nominal average falls from 19 lineup checks per minute to `3 + 3 × (1/15 + 3/60 + 12/360) = 3.45`. This is an accounting estimate, not measured cost or total HTTP traffic. Offset collisions, retries and catch-up affect individual minutes; full future-materialization loads and other Sleeper endpoints are outside that nominal allocation. Routine projection ingestion/materialization intervals above, provider sharing, leases, concurrency and deadlines remain unchanged. Synthetic policy/race tests must be complemented by natural post-deployment observation before claiming actual operational savings.

Obsolete watch rows are retired when provider/version, league identity, season, range, or ownership changes. That watch lifecycle is not a complete retention policy for every older provider-slate pointer or future-refresh record. A broader multi-season retention policy remains separate work.

The isolated Neon suite covers source ordering, atomic acknowledgment, identity and lifecycle fences, immutable content, claims, retries, snapshot verification, permissions, and safe reads. Real-game verification remains open until live 2026 transitions can be observed: kickoff, clocks, halftime, final convergence, future lineup changes during current games, missing projections, empty slots, byes, D/ST, team sums, both leagues, request counts, duration, skew, and browser adoption.
