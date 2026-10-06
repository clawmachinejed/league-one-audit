# First-slice fields and acceptance register

Generated from [foundation.json](foundation.json); do not edit this view independently.

Version: **backend-foundation-v1**. Status: **reconciled_target_not_implemented**. Baseline: `87da4d0cb909ee280e125e73ad10e1c3dbd7cd9f`.

Logical records are not mandatory physical tables. Existing nested source/resource types are reused.

D02: `sleeper-membership-access-v1`, `max_membership_age_seconds = 3600`; approved, not deployed. L1 account access is unaffected.

## Types

| Type | Meaning |
| --- | --- |
| `Id` | Opaque string; preserve existing UUID/content identity; never generate identity from display name |
| `NativeId` | Opaque nonempty provider string, namespace-qualified; never round through a JavaScript number |
| `Instant` | UTC ISO 8601 string ending Z; database time evaluates deadlines; unknown source times stay null |
| `Revision` | Nonnegative integer serialized as decimal string when crossing the safe-integer boundary |
| `Field<T>` | {state: known&#124;empty&#124;absent&#124;null&#124;invalid, value: T&#124;null}; absent/null/invalid have null value; empty requires explicit source evidence |
| `Ref` | Id of retained immutable evidence; reference must resolve in the same audience and declared scope |
| `Json` | Retained native JSON; shared readers consume normalized fields, not raw provider-specific paths |
| `IdentityLookupScope` | {kind:'identity-lookup', provider:string, lookupRequestId:Id, accessContextId:Id, audienceId:Id, coverageSpecId:Id}; capture-only before stable account resolution; no league or source mapping required; request ID prevents renamed/reassigned usernames merging evidence |
| `AccountResourceScope` | {kind:'account-resource', provider:string, providerAccountId:Id, nativeAccountId:NativeId, family:'league-discovery', sport:'nfl', season:integer, accessContextId:Id, audienceId:Id, coverageSpecId:Id}; account IDs must agree; one exact season per list receipt; no invented league ID |
| `EvidenceCoverage` | {coverageSpecId:Id, observed:ObservedCoverage, populationEvidenceRef:Ref&#124;null, roleGroups:{seasonTeamId:Id,primary:'known'&#124;'unknown',coManagers:'known'&#124;'unknown'}[]}; reuse ObservedCoverage from apps/site/lib/aggregator/contracts.ts; [] means not applicable or no qualified rows, never exhaustive removal without population and role qualification |
| `DependencyRef` | {kind:'actor'&#124;'session'&#124;'association'&#124;'acquisition-context'&#124;'source-mapping'&#124;'current-selection'&#124;'membership'&#124;'policy'&#124;'preference'&#124;'serving-selection', id:Id, revision:Revision&#124;string}; exact relevant vector, not arbitrary free-form claims; evaluated against authoritative current dependencies |
| `ProviderManagerIdentity` | Reuse apps/site/lib/aggregator/team-managers.ts: {providerManagerId:Id,sourceManager:ProviderReference}. providerManagerId resolves ProviderAccount.id; sourceManager.nativeId is the exact provider key, not the internal UUID; provider/namespace/native key must match that account. |

## Capability trace

| Capability | Fields | Source facts | Acceptance |
| --- | --- | --- | --- |
| identify | ProviderAccount.nativeAccountId, ProviderAccount.identityEvidenceRef, Association.assurance, IdentifyProviderAccountResult.status, IdentifyProviderAccountResult.evidenceRef | identity, account-reader | FS02, FS03, FS18 |
| discover-current-teams | DiscoveryScan.requiredSeasons, CurrentSelection.leagueSeasonId, TeamEvidence.primaryOwner, TeamEvidence.coManagers, DiscoverCurrentTeamsResult.status, DiscoverCurrentTeamsResult.teams | discovery, teams, portfolio | FS04, FS05, FS14, FS19 |
| shared-official-roster | LeagueSeason.settingsRef, HeldRoster.players, HeldRoster.acceptanceRef | roster, settings | FS01, FS11, FS12, FS13, FS15, FS16 |
| authorized-stored-read | LeagueAccessDecision.expiresAt, LeagueAccessDecision.dependencyRefs, ResourceEvidence.qualifyingVerifiedAt | accounts, teams, acceptance | FS06, FS07, FS08, FS17 |
| renewal-and-follow | Renewal.successorMappingRevisionId, Renewal.expectedFollowRevision, Follow.revision | mapping, settings, accounts | FS10, FS14, FS20 |
| ordered-versioned-acceptance | ResourceEvidence.canonicalNormalizerVersion, ResourceEvidence.attemptOrdinal, ServingSelection.selectionRevision | acceptance, mapping | FS09, FS10, FS21, FS22 |

## Source facts

| ID | Source at baseline | Observation |
| --- | --- | --- |
| identity | [apps/site/lib/sleeper.ts](../../apps/site/lib/sleeper.ts) — `getSleeperUserIdentity` | Existing GET /user/{username-or-id}; user_id is identity; current lookup is cached and is not membership verification |
| discovery | [apps/site/lib/accounts/sleeper-discovery.ts](../../apps/site/lib/accounts/sleeper-discovery.ts) — `discoverSleeperLeagues` | Existing read-only candidate discovery; current single season and preview sampling are insufficient for target complete current-team discovery |
| normalizer | [apps/site/lib/league-administration/normalize.ts](../../apps/site/lib/league-administration/normalize.ts) — `co_managers_absent` | Existing shared normalization; qualified manager resource distinguishes unknown co-managers from an empty array |
| teams | [apps/site/lib/aggregator/team-managers.ts](../../apps/site/lib/aggregator/team-managers.ts) — `TeamManagerRelationships` | Current primary-owner and independently qualified co-manager groups, shared season-team identities and provenance |
| settings | [apps/site/lib/aggregator/league-settings.ts](../../apps/site/lib/aggregator/league-settings.ts) — `LeagueSettingsValue` | Identity-complete resource with independently covered native settings, predecessor, periods and interpretation |
| roster | [apps/site/lib/aggregator/current-roster.ts](../../apps/site/lib/aggregator/current-roster.ts) — `AcceptedCurrentRosterRead` | Accepted shared held-player resource, independent groups and optional current metadata |
| acceptance | [apps/site/migrations/029_league_season_settings.sql](../../apps/site/migrations/029_league_season_settings.sql) — `identity_value:=jsonb_build_object('scope',p_scope,'policy',p_policy)` | Scoped resource identity already contains normalizer and validation policy; source inspection only |
| mapping | [apps/site/migrations/026_source_mapping_revisions.sql](../../apps/site/migrations/026_source_mapping_revisions.sql) — `mapping_generation` | Existing stable connection identity, immutable revisions and mapping generations |
| accounts | [apps/site/migrations/020_account_foundation.sql](../../apps/site/migrations/020_account_foundation.sql) — `app_provider_account_links_active_unique` | Existing L1 actors and preferences; current link uniqueness is only actor/account pair, not target exclusivity |
| account-reader | [apps/site/lib/accounts/neon/source-sql.ts](../../apps/site/lib/accounts/neon/source-sql.ts) — `provider_accounts AS` | Provider identity candidates depend on users evidence; current season selection uses max enrolled season |
| enrollment | [apps/site/migrations/025_account_league_enrollment.sql](../../apps/site/migrations/025_account_league_enrollment.sql) — `sleeper-` | Annual-ID key and three fresh legacy heads restrict current onboarding |
| season | [apps/site/migrations/001_projection_foundation.sql](../../apps/site/migrations/001_projection_foundation.sql) — `league_seasons_scoring_profile_immutable` | Stable league-season identities exist; required immutable scoring-profile attachment needs additive official-only adoption |
| portfolio | [apps/site/lib/accounts/fantasy.ts](../../apps/site/lib/accounts/fantasy.ts) — `String(league.season) === season` | Current portfolio global-year filtering conflicts with independently advancing current leagues |
| workers | [apps/site/lib/projections/worker/lineup-watch-policy.ts](../../apps/site/lib/projections/worker/lineup-watch-policy.ts) — `LINEUP_MATCHUP_REQUEST_LIMIT = 20` | Current bounded scheduler is not evidence of 500 watched leagues at approximately 60-second delay |

## Actor

Disposition: reuse. Key: `id; trusted issuer/subject association`.

Sources: accounts.

Constraints: Provider failures never change actor status or login identities

| Field | Type | Source | Null, relationship and acceptance rule |
| --- | --- | --- | --- |
| id | Id | trusted L1 principal -> app_users.id | Server resolved, not submitted provider identity |
| revision | Revision | app_users.revision and session authority | Recheck account/session validity on final delivery |
| status | active&#124;disabled&#124;deleted | L1 account lifecycle | Only L1 authority changes this state |

## ProviderAccount

Disposition: adapt. Key: `(provider, namespace, nativeAccountId)`.

Sources: identity, accounts.

Constraints: Reuse league_source_manager_accounts identity where namespace is proven; separate identity lookup evidence from user-directory display

| Field | Type | Source | Null, relationship and acceptance rule |
| --- | --- | --- | --- |
| id | Id | existing manager identity or shared identity resolver | Stable across username changes |
| provider | string | adapter registry | Only sleeper implemented |
| namespace | string | adapter identity rule | Sleeper user namespace is global within sleeper |
| nativeAccountId | NativeId | /user.user_id | Lookup validates returned ID; preserve string |
| username | Field<string> | /user.username | Mutable display/lookup label, not unique identity |
| displayName | Field<string> | /user.display_name | Absent optional display does not invalidate known identity |
| avatar | Field<string> | /user.avatar | Retain native token; adapter validates display URL |
| identityEvidenceRef | Ref | lookup capture | Identification is not proof of provider-account control |

## Association

Disposition: adapt. Key: `id; active UNIQUE(actorId, provider); active UNIQUE(providerAccountId)`.

Sources: accounts, account-reader.

Constraints: Atomic two-way uniqueness; provider agrees with referenced account; retained ended history; conflict never chooses a winner

| Field | Type | Source | Null, relationship and acceptance rule |
| --- | --- | --- | --- |
| id | Id | app_provider_account_links or compatible extension | Idempotent activation retry returns same association |
| actorId | Id | Actor.id | Private actor scope |
| providerAccountId | Id | ProviderAccount.id | Qualified lookup identity exists before association |
| provider | string | referenced ProviderAccount.provider | Enforce equality rather than trusting submitted provider |
| state | pending&#124;active&#124;ended | L1 association workflow | Only active participates in eligibility |
| assurance | user-asserted | read-only username identification | Exclusive L1 association does not imply external ownership proof |
| revision | Revision | association writer | End/replacement fences in-flight decisions |
| endedAt | Instant&#124;null | explicit disconnect authority | Null while active; never set because of outage |

## AcquisitionContext

Disposition: adapt. Key: `id + revision`.

Sources: mapping, accounts.

Constraints: Acquisition permission and league serving authorization are independent; no new credential store

| Field | Type | Source | Null, relationship and acceptance rule |
| --- | --- | --- | --- |
| id | Id | server-resolved public context or future private grant | Public context conveys no private entitlement |
| provider | string | adapter registry | Must match fetched resource |
| audienceId | Id | qualified visibility partition | Compatible public evidence can be shared; never widen private evidence automatically |
| revision | Revision | context authority | Revocation fences pending acquisition/publication |
| state | active&#124;revoked&#124;unavailable | acquisition authority | Unavailable does not change Actor.status |
| authorityExpiresAt | Instant&#124;null | applicable permission authority | Unknown/absent private authority cannot become unlimited permission |

## DiscoveryScan

Disposition: adapt. Key: `id; one resumable work identity per association revision and declared season-query set`.

Sources: discovery, identity.

Constraints: Candidate list does not prove eligible teams or enroll/follow automatically; failed scopes cannot be treated as empty

| Field | Type | Source | Null, relationship and acceptance rule |
| --- | --- | --- | --- |
| id | Id | existing job/checkpoint extension | No new independent collector |
| associationId | Id | Association.id | Capture active revision at reservation |
| associationRevision | Revision | Association.revision | Mismatch invalidates continuation/delivery |
| requiredSeasons | integer[] | qualified discovery strategy + retained current selections | Explicit sorted unique query set, not universal current-year filter |
| completedSeasons | integer[] | successful scoped candidate receipts | Subset of requiredSeasons; not proof of membership completeness |
| candidateRefs | Ref[] | /user/{id}/leagues/nfl/{season} | Each candidate retains league_id, season, sport and receipt |
| continuation | Json&#124;null | protected server checkpoint | Null only when finished or explicitly terminal, not on failure |
| status | pending&#124;partial&#124;complete&#124;failed | scan coverage | Complete only for declared season-query set |
| strategyVersion | string | qualified adapter discovery strategy | Cold-start coverage remains an explicit implementation qualification gate |

## LeagueSeason

Disposition: adapt. Key: `id; preserve existing (leagueId, season); source alias scoped by provider/native league/season`.

Sources: settings, season, enrollment, mapping.

Constraints: Existing league UUID/public key survive renewal; no merge by name; one selected official source per season

| Field | Type | Source | Null, relationship and acceptance rule |
| --- | --- | --- | --- |
| id | Id | league_seasons.id | Retain existing IDs |
| leagueId | Id | leagues.id | Permanent league identity |
| routeKey | string | leagues.league_key | Retain existing route keys; annual native key is only an alias |
| season | integer | /league.season | Parse four-digit year with exact source retained |
| sport | nfl | /league.sport | Other sports unsupported in this slice |
| sourceLeagueId | NativeId | /league.league_id | Annual Sleeper alias, not permanent league identity |
| connectionId | Id | league_source_connections.id | Selected source mapping relation |
| mappingRevisionId | Id | accepted source mapping revision | Exact revision, including A-B-A remaps |
| name | Field<string> | /league.name | Missing name may use explicit identifier label, never invented name |
| lifecycle | Field<string> | /league.status | Retain native state; completion alone does not remove current eligibility |
| predecessor | Field<NativeId> | /league.previous_league_id | Candidate lineage, not sufficient transition authority alone |
| teamCount | Field<integer> | /league.total_rosters | Independent population evidence; never infer expected count from returned rows |
| settingsRef | Ref | accepted LeagueSettingsValue | Retains scoring.rules, slots, competition, rosterRules, waivers, nativeSettings, periods with existing exact field types |
| analyticsAssessmentRef | Ref&#124;null | separately versioned assessment/applicability | Null is unqualified analytics, not denial of reliable official viewing |

## CurrentSelection

Disposition: adapt. Key: `(associationId, leagueId)`.

Sources: account-reader, portfolio, settings.

Constraints: Per-user per-league current choice; never max(year) or global NFL-year predicate; shared league facts remain independent

| Field | Type | Source | Null, relationship and acceptance rule |
| --- | --- | --- | --- |
| associationId | Id | Association.id | Current owned/co-managed teams for that provider account |
| leagueId | Id | LeagueSeason.leagueId | One stable league |
| leagueSeasonId | Id | verified initial candidate or Renewal.successorSeasonId | Retain completed current season until qualified renewal or loss |
| selectionRevision | Revision | existing authority/selection extension | Compare-and-swap renewal; reject delayed old selection |
| renewalRef | Ref&#124;null | Renewal evidence | Null for evidenced initial selection; never manufacture predecessor |

## TeamEvidence

Disposition: reuse-and-adapt. Key: `(leagueSeasonId, provider, nativeTeamId, acceptanceRef)`.

Sources: teams, normalizer.

Constraints: Shared season-team identity; multiple co-managers share it; manager absence requires exhaustive qualified group evidence

| Field | Type | Source | Null, relationship and acceptance rule |
| --- | --- | --- | --- |
| seasonTeamId | Id | league_season_teams.id | Stable within season; owner change does not recreate team |
| leagueSeasonId | Id | LeagueSeason.id | Cross-season foreign references rejected |
| nativeTeamId | NativeId | /rosters[].roster_id | Adapter converts validated integer to exact string scoped to source league |
| primaryOwner | {state:'owned',manager:ProviderManagerIdentity}&#124;{state:'unowned'&#124;'unknown',manager:null} | /rosters[].owner_id | Resolve native owner_id through ProviderAccount key to internal providerManagerId; explicit null is unowned, absent/invalid unknown; never join a native string to an internal UUID; unowned alone cannot exclude co-management |
| coManagers | {state:'known',managers:ProviderManagerIdentity[]}&#124;{state:'unknown',managers:null,reason:string} | /rosters[].co_owners | Resolve each native co_owners entry through ProviderAccount key; known [] proves empty for this row only; missing/null/invalid never means empty |
| acceptanceRef | Ref | accepted managers resource | Pin exact population, mapping, role coverage and network evidence |
| effectiveFrom | Instant&#124;null | documented provider applicability | Currently unknown; observed time is not historical effective time |

## HeldRoster

Disposition: reuse. Key: `(seasonTeamId, acceptanceRef)`.

Sources: roster, normalizer.

Constraints: Held players are current membership, not exact-week lineup proof; manager resource accepts independently of malformed players

| Field | Type | Source | Null, relationship and acceptance rule |
| --- | --- | --- | --- |
| seasonTeamId | Id | TeamEvidence.seasonTeamId | Same shared team scope |
| players | Field<NativeId[]> | /rosters[].players | Known unique held list; explicit [] empty; null/absent/invalid do not delete accepted inventory |
| canonicalEntityRefs | (Id&#124;null)[] | existing player/defense mapping | Corresponds to players; unresolved entry remains native and analytics limited |
| groupsRef | Ref&#124;null | currentGroups from same roster capture | Starter/bench/reserve/taxi coverage independent; no unknown placement fabricated |
| metadataRef | Ref&#124;null | optional currentPlayerMetadata | Independent source age; missing catalog never hides held identity |
| acceptanceRef | Ref | accepted current-roster receipt | Complete population required to replace full inventory |

## Follow

Disposition: adapt. Key: `(actorId, leagueId)`.

Sources: accounts.

Constraints: Preference never grants eligibility; carryover compares revision so a newer unfollow wins

| Field | Type | Source | Null, relationship and acceptance rule |
| --- | --- | --- | --- |
| actorId | Id | Actor.id | Private preference owner |
| leagueId | Id | stable league identity | No duplicate follow required for annual alias |
| state | following&#124;not-following | explicit user choice or verified carryover | Newly discovered leagues never auto-follow |
| revision | Revision | preference writer | Retain unfollow tombstone/revision to prevent resurrection |
| carryoverRef | Ref&#124;null | Renewal + captured preference revision | Only qualified renewal; D04 genuine loss/regain remains open |

## Renewal

Disposition: adapt. Key: `id; predecessor/successor mapping revisions + association revision + selection revision`.

Sources: settings, mapping, teams.

Constraints: Pin both source mappings; predecessor link plus compatible league identity and fresh successor eligibility; reject conflicts/forks and A-B-A stale proof

| Field | Type | Source | Null, relationship and acceptance rule |
| --- | --- | --- | --- |
| id | Id | existing mapping/evidence extension | Immutable transition proof |
| associationId | Id | Association.id | User-specific transition authority over shared season facts |
| associationRevision | Revision | Association.revision at reservation | End or replacement invalidates transition |
| expectedSelectionRevision | Revision | CurrentSelection.selectionRevision at reservation | Concurrent selection change invalidates transition |
| predecessorSeasonId | Id | CurrentSelection.leagueSeasonId | Current proven season |
| successorSeasonId | Id | verified annual successor | Same stable league, later season; not merely highest year |
| predecessorMappingRevisionId | Id | source mapping history | Must still match at selection |
| successorMappingRevisionId | Id | source mapping history | Must still match at selection |
| membershipEvidenceRef | Ref | qualified current successor team roles | D02 applies to successor, never inherit predecessor clock |
| expectedFollowRevision | Revision&#124;null | Follow.revision at transition reservation | Null means no follow to carry, not permission to create one |

## ResourceEvidence

Disposition: reuse-and-adapt. Key: `scope + policy identity; immutable receipt id; see contracts section 3`.

Sources: acceptance, mapping, normalizer.

Constraints: All references resolve to compatible scope/audience; no freshness extension from replay; immutable captures may support several normalized versions Identity lookup is capture-only until resolution; no accepted-head or enrolled mapping fabricated. Failed capture has no normalized content or acceptance generation.

| Field | Type | Source | Null, relationship and acceptance rule |
| --- | --- | --- | --- |
| scope | SourceScope&#124;DiscoveryScope&#124;AccountResourceScope&#124;IdentityLookupScope | existing aggregator contracts | Identity includes connection/season/family/entity/period/audience/coverage, or declared candidate scope |
| canonicalNormalizerVersion | string | qualified adapter interpretation | Part of accepted-head identity |
| validationVersion | string | qualified acceptance policy | Part of accepted-head identity; never compare ordinal across policy scopes |
| captureRef | Ref | actual source request receipt | Shared compatible acquisition, not one call per L1 user |
| sourceMappingRevisionId | Id&#124;null | mapping at capture | Required for enrolled scope; null for lookup/account/candidate discovery. Explicit linkage only after identity resolution. |
| origin | network&#124;cache&#124;retained-replay&#124;bootstrap | capture provenance | Only qualified network proof may advance membership verification |
| sourceObservedAt | Instant&#124;null | validated source observation | Never replace unknown provider time with normalize time |
| requestStartedAt | Instant&#124;null | network reservation/transport | Null for replay without a new request |
| requestCompletedAt | Instant&#124;null | network transport receipt | Arrival does not prove provider event order |
| normalizedAt | Instant | normalization event | Processing time only |
| qualifyingVerifiedAt | Instant&#124;null | accepted qualifying network proof | Original evidence clock preserved through cache/replay; record exact qualification |
| coverage | EvidenceCoverage | immutable requested spec + observed group coverage | Population, fields, roles, periods, pages and reasons; complete only within declared dimensions |
| attemptOrdinal | Revision&#124;null | reservation before network | Higher admitted attempt fences late older completion; null only before applicable reservation/acceptance, never interpreted as generation zero |
| acceptedGeneration | Revision&#124;null | transactional head | CAS with mapping/context/lease fences; null only before applicable reservation/acceptance, never interpreted as generation zero |
| contentRef | Ref&#124;null | immutable normalized content | Normalized content only when validation creates it; null for failure/invalid capture; equal qualified network content may retain identity with new receipt |

## ServingSelection

Disposition: adapt. Key: `(logical resource scope, reader contract/cohort)`.

Sources: acceptance.

Constraints: Logical selection responsibility, not mandatory new table; exactly one designated accepted policy head per serving contract

| Field | Type | Source | Null, relationship and acceptance rule |
| --- | --- | --- | --- |
| scope | SourceScope&#124;DiscoveryScope | same logical resource identity | Audience/coverage cannot be weakened during promotion |
| readerContract | string | internal reader binding | Legacy reader remains pinned until authorized qualified cutover |
| canonicalNormalizerVersion | string | selected qualified policy | No newest-semver or normalizedAt automatic promotion |
| validationVersion | string | selected qualified policy | Policy tuple matches versioned head |
| selectionRevision | Revision | existing config/authority revision or additive selector | Fence publication/materialization and cache invalidation |
| acceptedRef | Ref | selected head generation | Rollback also requires evidence age and compatibility checks |

## LeagueAccessDecision

Disposition: new-service-over-existing-owners. Key: `actor + association + current league selection + policy + dependency revisions`.

Sources: accounts, teams, acceptance.

Constraints: Final read authorization is separate from acquisition; no grant from follow, commissioner, membership-only, name or historical ownership

| Field | Type | Source | Null, relationship and acceptance rule |
| --- | --- | --- | --- |
| actorId | Id | Actor.id | Server principal |
| leagueSeasonId | Id | CurrentSelection.leagueSeasonId | Exactly the season served |
| eligibleTeamIds | Id[] | qualified owned/co-managed shared teams | Return all proven teams; no first-match truncation |
| outcome | allow&#124;deny&#124;indeterminate | approved policy evaluation | Unknown first-time never allow; indeterminate reveals no protected league data |
| reason | string | stable policy reason | Includes membership_unknown, membership_removed, membership_expired, association_ended, authority_revoked |
| policyVersion | sleeper-membership-access-v1 | D02 | Explicit approved version, no silent fallback default |
| qualifyingVerifiedAt | Instant&#124;null | ResourceEvidence qualifying role proof | Cannot move forward from failure, partial-unqualified, cache or replay |
| expiresAt | Instant&#124;null | min(T+3600s, earlier authority expiry) | Allow requires now < expiresAt; deny/removal can precede expiry; expiry is not removal |
| evaluatedAt | Instant | trusted evaluation clock | Re-evaluate immediately before delivery |
| dependencyRefs | DependencyRef[] | actor/session, association, context, mapping, selection, membership, policy and preference where relevant | Typed revision vector; membership id references immutable acceptance; policy revision is explicit version; validate at final delivery |

## ReadCurrentRosterResult

Disposition: new-service-over-existing-owners. Key: `actor-authorized request + current selection + serving binding`.

Sources: roster, teams, accounts.

Constraints: Internal discriminated result; variants enumerate all required keys and prohibit extras. Final authorization chooses shape. LeagueAccessDecision remains server-side, never embedded in result. Stored reader makes no provider request.

| Field | Type | Source | Null, relationship and acceptance rule |
| --- | --- | --- | --- |
| status | available&#124;pending&#124;unavailable&#124;denied&#124;indeterminate | access then stored resource evaluation | Pending is not empty; errors do not erase accepted facts |
| leagueSeasonId | Id | authorized CurrentSelection | Required only in authorized variants; omitted on denied/indeterminate |
| eligibleTeamIds | Id[] | LeagueAccessDecision.eligibleTeamIds | Required in authorized variants; omitted on denied/indeterminate |
| resourceRevision | string&#124;null | selected binding + accepted generation | Required nonempty on available, null on authorized pending/unavailable; omitted on denial |
| roster | HeldRoster[]&#124;null | accepted shared roster reader | Required on available with qualified coverage; null on authorized pending/unavailable; omitted on denial |
| fieldGroups | FieldGroup<HeldRoster[]>[] | existing aggregator FieldGroup contract | Exact authority/coverage/source age; original sourceRefs retained server-side; [] on authorized pending/unavailable; omitted on denial |
| features | FeatureAssessment[] | existing capability assessment | Official access independent of analytical support; no invented fallback estimate; [] on authorized pending/unavailable; omitted on denial |
| reason | string | safe service reason | Required only for non-available variants; omit on available; no protected metadata in reason |

Exact result variants (all listed keys required; additional keys prohibited):

| Status | Required keys | Rules |
| --- | --- | --- |
| available | status, leagueSeasonId, eligibleTeamIds, resourceRevision, roster, fieldGroups, features | resourceRevision nonempty; roster nonnull; every returned team belongs to selected league season |
| pending | status, leagueSeasonId, eligibleTeamIds, resourceRevision, roster, fieldGroups, features, reason | authorization allows; roster and resourceRevision null; fieldGroups and features empty |
| unavailable | status, leagueSeasonId, eligibleTeamIds, resourceRevision, roster, fieldGroups, features, reason | authorization allows; roster and resourceRevision null; fieldGroups and features empty |
| denied | status, reason | safe reason only; no protected identifiers or metadata; valid even before selection |
| indeterminate | status, reason | safe reason only; no protected identifiers or metadata; valid even before selection |

## IdentifyProviderAccountResult

Disposition: new-service-over-existing-owners. Key: `lookupRequestId`.

Sources: identity, accounts.

Constraints: Preview does not activate association, enroll or follow. Public lookup evidence does not prove external ownership. Failure cannot produce a provider account.

| Field | Type | Source | Null, relationship and acceptance rule |
| --- | --- | --- | --- |
| lookupRequestId | Id | IdentityLookupScope.lookupRequestId | Idempotent scoped lookup request |
| status | identified&#124;unavailable&#124;invalid | validated provider lookup | No empty/fabricated account on failure |
| account | ProviderAccount&#124;null | validated /user response | Required only when identified; stable native key survives username change |
| evidenceRef | Ref&#124;null | immutable lookup capture | Null only if no capture exists; preserve exact lookup scope and original age |
| reason | string&#124;null | adapter validation | Stable reason; null on success; no conflicting L1 actor disclosed |

## DiscoverCurrentTeamsResult

Disposition: new-service-over-existing-owners. Key: `scanId + association revision`.

Sources: discovery, teams, portfolio.

Constraints: List completion and qualified current-team completeness are independent. Include all proven team options with each league independently selected; unknown or denied candidates cannot expose protected roster content.

| Field | Type | Source | Null, relationship and acceptance rule |
| --- | --- | --- | --- |
| scanId | Id | DiscoveryScan.id | References immutable declared query strategy plus resumable progress |
| status | complete&#124;partial&#124;pending&#124;unavailable | candidate and role/current-selection coverage | Complete requires every required scope and current-team qualification; empty complete result needs qualified exhaustive evidence |
| selections | CurrentSelection[] | accepted per-association current selection | May contain different years; no max-year filtering |
| teams | TeamEvidence[] | qualified current role evidence | All proven eligible teams, shared UUIDs; each belongs to one returned current selection |
| access | LeagueAccessDecision[] | shared D02 evaluator | One decision per returned selected league; expired proof cannot qualify a new current team |
| unresolvedCandidateRefs | Ref[] | candidate/lineage/role evidence | Opaque server refs; uncertainty preserved, not removal |
| reasons | string[] | scope and role qualification | Explain partial/failed result; no fabricated defaults |

## Open product decisions

| ID | Decision | Activation gate |
| --- | --- | --- |
| D03 | Mistaken exclusive claim/replacement recovery | Before public exclusive-association launch; conflict returns no competing identity; no automatic replacement |
| D04 | Follow behavior after genuine membership loss and regain | Before activating that transition; do not infer follow restoration from regained eligibility |
| D05 | Retention and collection after last follower leaves | Before activating last-follower collection/retention changes; do not infer deletion or endless collection |

## Acceptance cases (specified, not executed)

| ID | Observable pass condition |
| --- | --- |
| FS01 | Owner and co-manager in separate L1 accounts resolve the same season/team/roster evidence; independent associations/access/follows; one compatible shared acquisition; resolved internal providerManagerId matches ProviderAccount.id while sourceManager preserves distinct native owner/co-owner IDs |
| FS02 | Concurrent different actors claiming the same provider account produce exactly one active association and a private-safe conflict; no competing user disclosure |
| FS03 | Concurrent same actor claiming two accounts of one provider yields at most one active association; retry is idempotent; no implicit replacement |
| FS04 | An unrelated supported league and renamed team use ordinary discovery and existing owners without hardcoded league IDs or custom configuration |
| FS05 | Member/commissioner without owned/co-managed team is denied; direct, aggregate and cached stored reads enforce the same result; denied/indeterminate serialization contains exactly status/reason, including before selection; no team IDs, revisions, field/source metadata, features or dependency IDs |
| FS06 | At T+3599s qualified prior membership can allow, at T+3600s it cannot; failure, partial-unqualified, cache, replay, outage onset and same old selected head never extend expiry; unknown first-time denies |
| FS07 | Complete accepted no-remaining-role evidence denies early; another qualifying role preserves eligibility; missing/null co-managers cannot prove removal; other users and shared facts survive |
| FS08 | Disconnect, session/actor change, accepted removal or mapping/context change during slow composition invalidates final delivery; already delivered responses are not claimed recallable |
| FS09 | Restart and duplicate request reuse canonical identities and resume only unfinished work; replay retains original verification age |
| FS10 | Delayed older request and A-B-A source remap cannot advance a newer head/selection; renewal pins both mappings and expected selection revision |
| FS11 | Optional users/catalog/projection failure and unknown placement preserve valid official team/held-player access; official-only admission and later analytics association preserve frozen history |
| FS12 | Partial/failed roster population retains accepted data with original age; invalid held players do not suppress independently complete manager removal; incomplete population prevents exhaustive exclusion |
| FS13 | Cross-provider/season/team/audience injection rejected at write and read; policy versions immutable and policy changes cannot use stale cached authorization; all success/failure result variants enforce their nullable fields and scope kind |
| FS14 | Two leagues with different current years both remain; completed current season persists while eligible; later-year candidate alone never advances selection |
| FS15 | Native ID above safe integer stays exact; explicit empty held list differs from null/absent/error; no synthetic player fills a gap |
| FS16 | Two co-managers/tabs/aggregate view coalesce compatible public requests; incompatible private scopes cannot share evidence or caches without qualification |
| FS17 | Provider outage through expiry suspends only affected league reads; independent revalidation remains possible and fresh positive recovery restores access; L1 sign-in unchanged |
| FS18 | Pre-enrollment username lookup establishes native identity without users-directory head; candidate preview remains read-only; activation requires trusted actor and atomic exclusive writer; lookup/list captures require no fabricated league/mapping and username rename/reassignment cannot merge provider accounts |
| FS19 | Cold-start discovery strategy finds nonrenewed current leagues as well as new-season candidates; incomplete season-query set reports partial and cannot establish loss |
| FS20 | Verified renewal carries an existing follow with captured revision; concurrent newer unfollow wins; no auto-follow on discovery; genuine loss/regain remains D04-gated |
| FS21 | Same capture normalized under v1/v2 coexists in separate policy heads; replay cannot renew D02; explicit compatible promotion chooses one serving policy; legacy binding remains unchanged |
| FS22 | Same-content fresh qualified network observation may advance verification; late older attempts cannot; accepted correction may decrease official value without altering frozen baselines |
