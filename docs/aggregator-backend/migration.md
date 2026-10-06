# Backend identity and migration design

Date: 2026-09-28. Scope: design only; no runtime, schema, credential, or database changes. Application evidence was inspected at `962d870`; current main and production at `92b8b0b` have the same application code and a documentation-only mission update. See the [verified baseline](README.md#baseline-and-scope). Names introduced below are proposed relations or contracts, not claims that they already exist. The [backend contracts](contracts.md) define the shared semantics, including immutable coverage specifications and captured mapping/normalizer versions.

## Decisions

1. Preserve permanent League One UUIDs and existing source evidence. Make shared services use those UUIDs and provider-qualified references; do not reinterpret a Sleeper ID as a canonical ID.
2. A league season has one selected official source for the initial multi-provider release. Supporting two providers does not mean merging two provider leagues automatically. Cross-provider season continuity or a provider transfer requires independently evidenced linking; defer concurrent multi-authority merging.
3. Account login, a manager identity reported by a provider, a user's assertion that the manager is theirs, permission to fetch private data, and a preferred team are separate facts.
4. An official league may exist without a calculable projection profile. Do not create fake empty/zero scoring rules to satisfy today's registration requirement.
5. Use immutable observations and small accepted-current pointers already present. Add scoped canonical read records and source metadata; do not introduce full event sourcing, a second collection pipeline, or a universal competition/scoring engine.
6. Completeness is assessed for a named resource and requested scope. One incomplete resource does not replace its last complete inventory head or block unrelated official resources. Resource policies may separately accept partial read evidence for existing box scores and provisional metrics, preserving its limitations. Features declare dependencies before a combined view is advertised as available.

## Evidence and concrete constraints

Paths below are repository-relative; one-based lines locate the relevant definition.

| Existing evidence | What it establishes | Design consequence |
| --- | --- | --- |
| `apps/site/migrations/001_projection_foundation.sql:32` | `leagues.id` is a UUID and `league_key` is unique. `league_seasons` already separates annual identity. | Reuse both; preserve existing route keys and season UUIDs. |
| `apps/site/migrations/001_projection_foundation.sql:44` and `apps/site/lib/league-administration/neon/enrollment.ts:25` | `league_seasons.scoring_profile_id` is required; missing profiles make registrations unavailable. | Official-only registration requires an explicit schema/reader change, not merely changing the UI capability flag. |
| `apps/site/migrations/001_projection_foundation.sql:50` | Source connections use `(league_season_id, provider)` and unique `(provider, external_league_id)`. | Keep scoped mapping; opaque complete provider keys must carry any provider season/game namespace. |
| `apps/site/migrations/016_portable_league_administration.sql:3` | Enrollment and intended season membership check `provider='sleeper'`; configuration dialect and other tables also enforce Sleeper. | Generalization includes constraints, functions, role grants and readers, not just TypeScript unions. |
| `apps/site/migrations/016_portable_league_administration.sql:168` | Team UUIDs are season-scoped; manager UUIDs are provider-scoped; memberships refer to immutable roster content. | Reuse the identities; retain current membership evidence instead of assembling participation from all retained history. |
| `apps/site/migrations/016_portable_league_administration.sql:107` | Administration heads use `(league_season_id, family, week)`. | Existing global heads cannot silently host different authenticated audiences or arbitrary period scopes. |
| `apps/site/migrations/016_portable_league_administration.sql:228` | Source/typed history is immutable and one restricted writer validates a versioned envelope. | Introduce additive metadata/aliases and a reviewed writer version; never bulk-rewrite immutable history. |
| `apps/site/migrations/025_account_league_enrollment.sql:3` | Onboarding requires `sleeper-<external ID>` routes, numeric IDs, a 16-row admission limit and fresh complete core documents. | Replace hardcoded identity assumptions, preserve explicit admission control until new capacity is qualified. |
| `apps/site/migrations/020_account_foundation.sql:15` | Login mapping uses exact `(issuer, subject)`; provider links are nonexclusive and `user_asserted`. | Neither names nor user assertions may confer private-provider access. |
| `apps/site/lib/projections/shared/provider-identity.ts:1` | External references distinguish provider, resource, player versus defense, and league-scoped rosters. | Extend the existing convention; do not replace it with loosely typed strings or a separate identity framework. |
| `apps/site/migrations/003_league_period_authority.sql:7`, `007_lineup_freshness.sql:16` | Current periods are explicit, week-based, generation-guarded; highest stored snapshot does not determine the week. | Preserve exact-week behavior; model provider competition periods separately from NFL weeks. |
| `apps/site/migrations/001_projection_foundation.sql:417`, `007_lineup_freshness.sql:47` | Jobs, attempts, leases, watch generations, and published snapshot pointers already exist. | Extend these mechanisms for resumable official resource jobs instead of creating competing collectors. |
| `apps/site/lib/accounts/neon/source-sql.ts:14` | Account read path filters Sleeper/routes and a Sleeper normalizer version. | Identity migration is incomplete until account readers and their security scope are migrated. |
| `docs/account-foundation-database.md` | Account RLS depends on server-resolved actor context in the same transaction; current source pages are public. | Private source authorization must reach page loaders, snapshot APIs, cache keys and raw-data access; existing account RLS alone is insufficient. |

## Internal identity contract

All IDs shown as UUIDs are allocated by League One. External IDs remain exact opaque strings; do not parse to numbers, lowercase, derive from names, or discard a provider's sport/game/season namespace. Reject malformed IDs rather than silently changing their meaning. Provider codes come from a controlled adapter registry; future providers need not be hardcoded across domain modules.

| Identity | Existing anchor | Required scope and behavior |
| --- | --- | --- |
| App user | `app_users.id` | Independent of every provider; existing login issuer/subject remains unchanged. |
| Permanent league | `leagues.id` | Durable across evidenced annual renewals. Keep `league1`, `league2`, `dynasty`, existing imported route keys, links and preferences unchanged. New route keys are opaque application keys, not a parsing contract for provider identity. |
| League season | `league_seasons.id` | `(league_id, NFL season year)` remains unique for this football product. `sourceSeasonKey` and native game namespace are separate strings in mapping metadata. Do not pretend the product is multi-sport to justify extra abstraction. |
| Official source connection | `league_source_connections` plus `league_source_connection_history` | Add stable connection UUID and current mapping revision/generation through a reviewed additive migration. Bind new observations to the exact immutable history/revision, not a later mutable mapping. Scope is provider + full source league key + source season namespace when needed. |
| Season team | `league_season_teams.id` | Team identity is local to a league season. Add source aliases with exact connection revision/namespace and external team key. Preserve existing provider/external columns as legacy origin fields during migration; do not repurpose them or rewrite team UUIDs. |
| Source manager account | `league_source_manager_accounts.id` | `(provider, full provider account ID)` only where the API establishes global stability. If a provider exposes only league-scoped manager IDs, include that namespace. Preserve distinct records until equivalence is proved; a display name is never a cross-provider key. |
| Team membership | `league_administration_memberships` | Observed owner/co-owner relationship attached to exact accepted roster evidence, with provider roles preserved. It proves provider membership, not website authority. Unknown provider roles remain explicit and do not become owner by default. |
| NFL player / defense | `scoring_entities` + `external_scoring_entity_ids` | Separate player and team-defense kinds. Resolve required projection IDs only on sufficiently trusted aliases. Official provider-local player rows can remain visible with unresolved canonical NFL identity; mark related enrichment unavailable. Do not weaken the projection worker's existing fail-closed rule. |
| NFL game | `nfl_games` + `external_game_ids` | Existing canonical game and aliases; preserve schedule correction and provider-game mapping evidence. Do not identify a game by week alone. |
| Fantasy scoring period | Proposed `league_scoring_periods` + source period mapping | Season-scoped internal ID, provider-native period key/label, explicit status and NFL-period coverage. A fantasy competition matchup may span multiple NFL scoring weeks. Current one-to-one NFL-week projections remain unchanged; unmapped/multiweek formats have separately qualified analytics. |
| Fantasy matchup | Canonical UUID plus season/period-scoped native key when supplied; otherwise versioned source-derived discriminator | A native matchup ID may be reused in another week. When absent, use evidenced season, stage, period set and participant relationships; never array position. Ambiguous duplicates remain unresolved, and tuple changes require explicit correction/linking evidence. Participants are a list with provider relation semantics, not an assumed pair in every league. UI support can be limited separately. |
| Transaction | Existing transaction content entries + proposed persistent source reference | Provider + full source connection scope + exact external transaction ID. Retain observed versions/corrections. Collection page/time/window is part of coverage, not transaction identity. |

Season-team continuity across years is a separate optional relationship with evidence. Roster number `1` in another league/year is not the same team. Retired mappings remain available to interpret historical snapshots. Cross-provider manager linking is an explicit user action; it does not merge two provider accounts or their credentials.

## Permission and connection model

The existing `app_provider_account_links` stores nonexclusive public Sleeper associations. That is baseline behavior, not the current target. The [October 5 reconciliation](reconciliation.md) supersedes this section's old retention proposal: adapt the existing owner to exclusive active associations in both directions, retaining user-asserted assurance and historical links. Qualify conflicts and constraints before activation, and resolve D03 before public exclusive-claim launch. Future private integration records remain separate acquisition authority, conceptually:

- `provider_authorizations`: UUID, app user, provider, authenticated provider subject (when supplied), secret reference, granted scopes, access state, expiry, token/authorization generation, connected/checked/revoked timestamps. Secrets are encrypted by a dedicated server mechanism and never embedded in canonical payloads, URLs, logs or browser state. Physical secret storage and key management must be chosen before an OAuth pilot.
- `provider_resource_grants`: authorization, league/season/source scope, allowed resource families and visibility audience, source evidence and validation time. A known provider identity or a followed league cannot substitute for a grant. A grant is evidence of access checked by the server, not a promise that remote permission persists forever.
- Read models carry a visibility scope. Reuse source work across users only after proving equivalent access and equivalent source content. Provider-personal endpoints remain connection-specific. An authenticated response with reduced visibility cannot overwrite a more complete shared league document.

For an account request, resolve the server session and actor; compute the permitted leagues/resources; load only the permitted normalized records; scope caches by authorization/audience revision; then serialize the response. Public Sleeper routes retain public handling explicitly. Apply equivalent checks to revision/full snapshot endpoints and any old route that can reach private data. Source manager display data obtained privately is not automatically a public manager directory.

Revoking a provider authorization increments its generation, cancels/deauthorizes pending work, removes the user's access immediately, and invalidates private caches/read models. A worker claimed before revocation must fail the grant-generation check before publication. Another user's valid independent authorization may keep authorized shared collection running; it does not restore access for the revoked user. Token refresh uses compare-and-swap on the authorization generation to prevent stale refreshes replacing a newer credential or revocation.

Disconnecting a provider is not deleting a shared league. Deleting a user removes or disables the user's links/grants/preferences according to an approved retention policy; it must not delete records still legitimately used by others. Raw private payload retention/deletion and removal from backups need provider-specific terms and privacy decisions before activation. Historical immutability is an operational default, not an excuse to retain personal data forever.

## Observation, completeness and publication contract

Extend the existing envelope rather than replacing all legacy content. A v2 observation identifies:

```text
schemaVersion, adapterVersion, nativeDialect, canonicalNormalizerVersion
leagueId, leagueSeasonId, sourceConnectionId, sourceMappingRevisionId
resourceFamily, resourceScope { periodId?; teamId?; coverageSpecId }
visibilityScopeId, authorizationGeneration? (internal only)
requestStartedAt, requestCompletedAt
sourceUpdatedAt? / nativeRevision? (only if provider supplies them)
sourceObservedAt? (time actual source retrieval was observed, not a fabricated provider edit time)
checkedAt, normalizedAt, verifiedAt?, acceptedAt?
origin { network | cache | retained-replay | bootstrap }, rawContentHash, canonicalSemanticHash
completeness { complete | partial | unknown }, coverage, diagnostics
validationOutcome { accepted | rejected | quarantined }
idempotencyKey, predecessor/cursor metadata when applicable
```

The existing `source_observed_at` means observation evidence; it must never be relabeled as the provider's last modification time. `checkedAt` can advance on a valid cache check without claiming fresh network verification. A newly normalized historical payload retains its old observation time plus a new transformation time. When native revision ordering is absent, use documented observation/attempt ordering and fence rules; timestamps alone do not establish the source's edit sequence.

An immutable coverage specification identifies requested periods/window boundaries, fields, entity selection and filters. It participates in fetch, accepted-head and job identity; scan cursors refer to that specification. Observed coverage describes exactly what was returned. Record expected count only when independently available. Reaching the last page can establish requested-window completion; collecting one page cannot establish season completeness. Empty complete results and missing/unavailable results are distinct. Missing scores/lineups/members are not zero or empty arrays by default. Delete/tombstone an absent item only from a complete authoritative inventory for an equivalent coverage specification; a partial page or permission failure cannot delete teams or memberships.

Maintain last accepted complete-inventory pointers per source revision, resource scope, visibility audience and canonical normalizer version. Resource-policy-approved partial read evidence has a separate acceptance purpose/pointer and retains its coverage limits; current box scores and provisional PPG must retain their documented accepted complete/partial observation behavior. Partial captures never delete absent members or claim full inventory coverage. Preserve other partial/rejected attempts for diagnostics where retention permits. An explicitly complete roster can publish even when manager avatars fail; a lineup/score pair used together must pass its documented same-period and temporal-consistency checks. The composed read model includes a dependency manifest listing the source head generations used. It may expose a partially available page with field-level reasons, but cannot imply that independently fetched resources were an atomic provider transaction.

A feature support assessment is keyed by configuration revision, provider capability version and engine version, and is separate from current availability/freshness. Examples: official standings supported but stale; projections unsupported because of an event we cannot rate; transaction history limited to an available window. Failed fetches do not permanently change capability. Unknown scoring settings can be retained with a native label while related calculations are unavailable.

Publication transaction: validate current mapping + allowed audience + grant generation if private; validate job owner/attempt generation/lease/deadline; validate exact resource scope and normalizer; insert deduplicated evidence/derived records; compare expected head generation; advance accepted pointer and record dependency manifest; acknowledge work only after successful publication. Retried identical evidence is idempotent. Lost leases cannot authorize publication. No new source head can retroactively change a frozen pregame baseline or a historical published snapshot.

## Proposed schema evolution map

This is design intent, not executable SQL. Final names/indexes must be derived from actual query plans and the installed catalog in the implementation task.

| Existing area | Additive or controlled change | Preserve |
| --- | --- | --- |
| `leagues`, `league_seasons` | Keep UUID/key uniqueness. Prepare readers for nullable legacy scoring binding, then permit official-only seasons without a scoring profile; add independent calculation eligibility. | All existing UUIDs, keys, profile references, season numbers. No fake rules profile. |
| `league_source_connections`, `league_source_connection_history` | Add stable connection identity, exact source namespace metadata, mapping generation/current immutable revision linkage. Generalize remap/renewal functions with provider evidence validation. | Existing mappings/history and explicit expected-previous-mapping checks. Never infer a mapping from a name. |
| `league_administration_enrollments`, `league_administration_enrollment_seasons` | Replace Sleeper-only constraints through reviewed provider registry validation; distinguish official-resource enrollment from analytics jobs. Preserve one selected authority per season and capacity admission. | Intended membership, isolation and current inactive/prepared lifecycle. Do not silently drop an unavailable member. |
| `league_configuration_versions`, activations, heads | Permit registered dialects/normalizers; add source revision metadata and bounded feature assessment. Keep scoring/roster/competition/display components independent. | Immutable versions, explicit evidenced applicability and legacy hashes. A current check is not historical effective-rule evidence. |
| `league_season_teams`, `league_source_manager_accounts` | Allow approved providers/namespaces; add alias/mapping relations where needed. Keep legacy origin columns until old readers are retired. | Existing team and manager UUIDs and memberships. No automatic franchises/people merging. |
| Administration contents/observations/entries | Retain evidence; add v2 envelope metadata in an adjacent metadata relation or versioned additive columns. Generate normalized v2 projections from retained raw data only with explicit new version and observation lineage. | Old payloads, hashes, validation outcomes, observations and immutable typed children. |
| Administration heads | Add scope/audience/version-aware pointer relation where current week-only/global key cannot express the scope; use the same writer and capture jobs to populate it. | Existing v1 heads for compatibility, with no private data written into public legacy paths. This is a new pointer/index, not a second provider ingestion pipeline. |
| Scoring tables / baselines / snapshots | Keep existing scoring/profile identity and calculation pipeline. Future profiles use explicit dialect/rules-encoding/semantic-version metadata and namespaced identity; never equate unrelated provider rules merely because raw JSON hashes match. | Current legacy hash algorithm, frozen baselines, scored historical outputs and `clock-v1`. Do not rescore history as a migration step. |
| `scoring_entities`, external scoring/game ID maps | Extend existing references with needed provider namespaces and evidence. Quarantine conflicts. | Verified current aliases and corrected NFL game mappings. No name-only automatic identity decisions. |
| `league_period_authorities`, lineup watches, materialization state | Add an explicit fantasy-period mapping used by official readers. Existing projection jobs accept only verified compatible NFL week mappings. | Exact-week selection, current/future authority generations and current site calendar behavior. No broadening NFL-week behavior during a foundation migration. |
| `projection_jobs` and existing worker states | Reuse leasing/job infrastructure for bounded source-resource work; add durable continuation/cursor, next-attempt/backoff and authority/grant generation metadata as required. | Current lane policies, shared Tank01 work, existing job fences. No new page-triggered collection or projection jobs; preserve the existing bounded official server fallback through the adapter/access boundary. |
| `app_*` account and `website_auth` tables | Keep login/library schema; add separate authorization and resource grants; adapt library queries to generic source identity and permitted audiences. | Existing sessions, RLS actor transaction contract, preferences and public association assurance. |

## Migration sequence and acceptance gates

### 0. Baseline and compatibility matrix

Inventory every reader/writer/function/grant touched by provider checks, period representation and scoring-profile requirements. Record old route/public payload compatibility, migration checksums, retained source-to-snapshot lineage, and current source API request counts. Select a narrow pilot cohort and explicit old/new read switch per resource. Do not increase enrollment limits yet.

Gate: old application's safe compatibility range is documented, including which new data it cannot understand. Future rollback is blocked from exposing private-provider records through old public readers.

### 1. Expand

Add v2 contracts and adapter registry; additive mapping/authorization/scope metadata; new canonical read projections/pointers where needed; versioned restricted writer entry points and role grants. Keep old writers/readers operational for existing Sleeper records. Deploy nullable-profile-aware readers before allowing an official-only registration; revalidate existing profile-bound workers explicitly filter to calculation-eligible seasons.

Gate: applying the new schema to an isolated copy passes catalog/ACL checks; old data and historical hashes/snapshots remain unchanged; no private provider is admitted and no fresh source credential is required for deterministic tests.

### 2. Backfill retained evidence

Backfill canonical v2 projections, aliases and source lineage in bounded resumable batches from accepted retained data. Capture source content/observation IDs and normalization version. Do not invent historical timestamps, credentials, memberships, deleted records or unavailable periods. Mark records not recoverable from retained evidence as unverified/missing and collect only through the regular adapter later. Retain a backfill manifest and restart cursor; dedup makes a second run a no-op.

Gate: every pilot legacy entity maps to the same UUID; alias uniqueness and season scope hold; unavailable historical evidence is enumerated; all original snapshots and scoring references remain byte/ID compatible. Backfill performs no provider requests.

### 3. Compare using one acquisition path

Feed the same captured Sleeper response into legacy normalization and the new projection, without doubling provider HTTP requests. New normalized read records remain shadow-only. Compare required screen values and provenance over normal, empty, partial, stale, correction, rollover and retry cases. Differences need an explicit explained expectation; do not declare statistical parity from a few happy paths.

Gate: no unexplained differences for required official values or existing projections; every missing value has a stable reason. Conflict/ambiguity, stale worker, revoked grant, repeated delivery, partial pagination, remap and audience-isolation fixtures pass. Existing test/UI contract suites remain green.

### 4. Cut over by resource and league

Switch pilot read services to canonical contracts while preserving route/payload compatibility. Source adapters remain the single acquisition path. Official fallback must run through the same provider adapter and permission boundary; no generic loader may independently call Sleeper. Accept analytics-independent imports only after all downstream code can represent unavailable calculations. Private provider enablement waits for access and cache isolation qualification.

Gate: pilot screen dependency manifests resolve to accepted source revisions; source/request costs do not increase unexpectedly; normal polling still reads stored data only; old IDs/links and My Team choices work. A second provider completes the chosen read-only journey with explicit unavailable features.

### 5. Rollback and later retirement

Before cutover, application rollback simply disables new readers/activation and leaves additive evidence intact. During Sleeper cutover, revert the cohort read switch only to a verified compatible reader and the same accepted source lineage. Pause new jobs if necessary; do not destroy records or remove ledger entries. If new private-provider or official-only seasons exist, old application rollback may be incompatible: disable that provider/cohort through a version-aware path or forward-fix. Never route those leagues through legacy public/required-profile readers.

Retire direct legacy imports, dual normalized projections or redundant compatibility storage only after measured stability, a recorded rollback window and successful recovery drills. Physical column/table removal is a separate later migration. Do not retain two permanent ingestion/normalization systems.

Gate: rollback rehearsal preserves user access boundaries, old and new source evidence, immutable scoring/snapshot data, and recoverable pending jobs; re-enabling produces no duplicate resources/publication.

## Bundle 1 retained-evidence decision

Decision for the approved B1 continuation: preserve useful old facts through an explicitly labeled **retained compatibility projection**, while leaving PR270's qualified network acceptance unchanged. This follows the existing `legacy-retained-roster` bridge, not a new collector or an independent publication writer. The [retained-matchup comparison planner](retained-matchup-comparison.md) implements the first read-only inventory/manifest/batch step in a dependent continuation from PR275. Qualification and release are tracked in the sole Step 2 checklist; durable replay and production processing remain separate.

Three outcomes must remain distinguishable:

1. **Qualified acceptance:** the existing exact source mapping, pre-acquisition attempt, independently evidenced population, receipt, accepted generation and lease/order guards all apply.
2. **Retained compatibility evidence:** facts can be reproduced from an immutable v1 observation/content pair, with original provenance and explicitly enumerated missing qualifications. It is not an `AcceptedResource` and does not advance its head.
3. **Unavailable or conflicting evidence:** hash, normalization, identity, source/period or temporal checks fail; return a stable reason without substituting another week or current state.

Retained matchup projection must reuse `normalizeAdministrationObservation` and `projectExactMatchups`, with a lineage/limitations wrapper analogous to `projectRetainedRoster`. Validate observation→content linkage; provider, external league, league-season, family and native week; raw and semantic hashes and legacy normalized value; and content-linked season-team IDs. Reject missing/duplicate/cross-season team links and unknown normalizer versions. Preserve a captured mapping revision when it exists. Missing historical mapping stays `mapping_revision_not_captured`; today's mapping cannot be backdated. Use the original observation's timestamps, not the head's later verification time, the replay time, or a fabricated reservation.

Valid retained content may establish native week, participant/group identities, raw membership, ordered starters/vacancies, official stored team/player points and custom overrides. Complete v1 content alone does not independently prove full league population: absent separately bound population evidence leaves that coverage unknown, rather than inferring the expected count from the rows being checked. Partial evidence must remain separate and cannot masquerade as a complete resource or replace a complete accepted head.

Historical slot labels, bench categorization, IR/taxi, injury/team metadata, NFL mapping, provider finality and derived references need their own exact evidence. Reuse the existing configuration applicability resolver where actual period-bound evidence exists; nearby capture times or a matching current `leg` on today's document do not prove past applicability. The source can be unavailable, but a new reader may not silently degrade an existing supported view: qualify a compatible retained path or leave that reader's cutover gate open. Annual predecessor discovery and cross-season attribution remain Bundle 4.

### Bounded comparison and later materialization

First implement an internal immutable-observation read/scan and versioned comparison manifest for an explicitly selected league-season/period scope. The current administration reader follows a moving accepted head, so it is not already this history scan. Freeze source observation/content IDs, available mapping IDs, expected hashes, projection/selection versions and a deterministic input order in the manifest. Process fixed entries in bounded batches with an explicit cursor, producing semantic hashes, comparison results and limitation/rejection reasons. New captures belong to a new manifest. This planner makes zero provider requests, inserts no v1 observations or network receipts, advances no accepted head, and publishes no snapshot.

Choose persistent materialization only after that inventory shows a requirement that cannot be met by a qualified read over immutable evidence. Preserve the existing UUIDs, source lineage and one administration service/writer. A database materialization implementation must bind an immutable manifest identity, result deduplication and checkpoint to the same transformation version. Equal retries are no-ops; a different result for the same key is an error. Commit each result and its checkpoint atomically under the current job fence; interruption before commit repeats the entry, and after commit resumes after it. Do not store the only cursor in the generic `projection_jobs.payload`: the existing job claim overwrites that field. A narrow additive database checkpoint/manifest extension is an implementation decision, not permission for a second ingestion/publication path. An artifact-only comparison report may instead persist its manifest and progress with crash-safe file replacement and input-hash verification; this records comparison progress and does not qualify database backfill.

Required evidence: identical results across batch sizes and interruption points; no skipped/duplicate entries; fixed input set despite new captures; corruption and A→B→A mapping detection; original times on equal-content reacquisition; null/empty/zero/correction distinctions; exact historical applicability; zero provider/observation/head/snapshot writes for the planner. Any database-persisted result/checkpoint path additionally needs real isolated SQL for atomicity, retries, concurrent claims, expired/replaced leases and rollback. A read-only comparison report does not by itself qualify a durable backfill.

Rollback disables the new comparison/read or its bounded processing while retaining original evidence and completed immutable results. It never rewrites old content, scoring profiles, frozen baselines, snapshots, migration ledger entries or accepted pointers. Production processing, pilot cutover and release remain separate authorization boundaries. No new user-facing product decision is required to begin this internal evidence work under the approved plan; the exact pilot and unsupported-view behavior must be resolved before Step 3 switches readers.

## Required adversarial examples

- Two providers return external team ID `1`; two leagues within one provider also return `1`: all resolve to different season teams.
- A next-year provider league has the same display name and roster IDs: it cannot silently become a previous season without renewal evidence.
- A user associates a public manager username: no private grant is created. Two website users may make the same public association.
- A private authorization is revoked during an in-flight roster fetch: no new private head is published under the revoked generation and no private response remains accessible through its cache key.
- A second valid account is still authorized to the league: its continued access does not revive the first account's access.
- Roster page 2 fails: page 1 never becomes the complete roster and missing rows are not deleted.
- A complete roster arrives while avatar/user metadata fails: roster can advance; manager detail states its own availability.
- Official custom team total does not equal player sum: preserve the official total and adjustment provenance; do not overwrite it with reconstructed points.
- Unsupported scoring/competition setting is present: retain official data and source configuration; withhold only affected calculations.
- A provider-native matchup spans two NFL weeks: official period is representable; no accidental Week 1 snapshot or sum is presented as the full projected matchup.
- Provider mapping is corrected while a worker holds a lease: stale mapping generation cannot advance the new head.
- A correction is fetched after a newer attempt started: publication uses explicit revision/order rules and safe reconciliation, not whichever network response finishes last.

## Remaining decisions and evidence limits

- Actual second-provider permission scopes, credential lifecycle, visibility differences, historical pagination and stable keys need official documentation and an authorized pilot. Documentation examples alone do not prove live access or completeness.
- Keep identities, access, mappings, scope keys, revisions and accepted pointers in typed/indexed relational records. Choose typed rows versus small versioned JSON documents for individual read payloads using the [screen inventory](screen-data-map.md) and measured query patterns. Retain native extensions as versioned evidence; avoid a generic EAV graph for all fields.
- Exact database constraints/index migrations and role grants need installed-catalog verification in an implementation task. This design does not prove the current production schema or authorize production changes.
- Supported initial competition formats and whether multiweek official matchups fit the existing UI must be specified as capability decisions, not inferred from provider ingestion support.
- Private-data retention, provider transfer/annual continuity authorization, operational SLOs and the intended launch cohort need explicit implementation acceptance criteria. None is a reason to reconstruct every scoring rule now.

This design is achievable using the current foundation. The highest-risk changes are authorization/visibility, immutable identity mappings, decoupling registration from projections, and compatibility across old/new readers—not the addition of another HTTP client.
