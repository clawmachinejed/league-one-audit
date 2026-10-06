# Atomic requirements and bidirectional verification trace

Design specification under [README](README.md), derived from [design-requirements.json](design-requirements.json). The JSON ledger owns these stable obligation and case IDs; regenerate this readable view after deliberate ledger edits. It does not create a second product contract.

Input design commit: 473e32e. Application baseline: 87da4d0cb909ee280e125e73ad10e1c3dbd7cd9f. 108 atomic requirements allocate all 135 top-level foundation fields, all 26 record constraints, all 25 named foundation types and all 22 grouped FS cases. These counts establish allocation only. Runtime/database/race/user-validation execution: **none**. Design status: **reviewed first slice and full scope plan**.

Requirements are independently falsifiable obligations. Several fields can jointly implement one invariant; a field can support several requirements. Record constraint IDs use the record name and one-based position in the pinned foundation register; exact text in the JSON catalog detects drift. Source anchors are exact substrings, not invented original requirement numbers. Verification cases below are later executable specifications, not passing tests.

## Roles and source authority

| Owner ID | Existing responsibility | Source paths |
| --- | --- | --- |
| auth | Existing account authentication/session authority | apps/site/lib/accounts/auth.ts; apps/site/migrations/021_website_auth.sql |
| accounts | Existing account association/preference writer | apps/site/lib/accounts/neon/store.ts; apps/site/migrations/020_account_foundation.sql |
| identity | Existing Sleeper lookup and shared identity resolver | apps/site/lib/sleeper.ts; apps/site/lib/league-administration/normalize.ts |
| discovery | Existing account discovery and durable administration work | apps/site/lib/accounts/sleeper-discovery.ts |
| mapping | Existing administration registry/source mapping/enrollment | apps/site/lib/league-administration/source-mapping.ts; apps/site/migrations/025_account_league_enrollment.sql; apps/site/migrations/026_source_mapping_revisions.sql |
| normalize | Existing administration normalizer | apps/site/lib/league-administration/normalize.ts |
| acceptance | Existing scoped administration acceptance writer | apps/site/migrations/029_league_season_settings.sql |
| settings | Existing settings reader/interpretation owner | apps/site/lib/aggregator/league-settings.ts |
| roster | Existing current-roster reader | apps/site/lib/aggregator/current-roster.ts |
| access | Existing account/aggregator composition adapting one shared access service | apps/site/lib/accounts/fantasy.ts; apps/site/lib/accounts/neon/source-sql.ts |
| teams | Existing manager relationship reader | apps/site/lib/aggregator/team-managers.ts |
| workers | Existing scheduling/acquisition owners | apps/site/lib/projections/worker/lineup-watch-policy.ts |
| review | Repository design/verification responsibility (no new runtime owner) | docs/aggregator-backend/README.md; docs/aggregator-backend/verification.md |

| Source ID | Classification | Exact anchor |
| --- | --- | --- |
| [H01](evidence/backend-workspace-handoff.md) | approved_need | Sleeper first; other providers are future adapters. |
| [H02](evidence/backend-workspace-handoff.md) | approved_need | One active provider account per L1 user per provider, and one L1 user per provider account. |
| [H03](evidence/backend-workspace-handoff.md) | approved_need | Require a current owned or co-managed team. |
| [H04](evidence/backend-workspace-handoff.md) | approved_need | Missing, null, partial or failed observations do not establish removal. |
| [H05](evidence/backend-workspace-handoff.md) | approved_need | Current teams advance per league after verified renewal and current membership; the dashboard may span season years. |
| [H06](evidence/backend-workspace-handoff.md) | approved_need | Eventually import all recoverable current-season competitive history, current information and the remaining published schedule. |
| [H07](evidence/backend-workspace-handoff.md) | approved_need | Use each league's actual scoring, roster slots, eligibility and competition settings. |
| [H08](evidence/backend-workspace-handoff.md) | approved_need | Collect shared resources once wherever permissions permit; continuously maintain followed leagues while users are absent. |
| [H09](evidence/backend-workspace-handoff.md) | approved_need | Qualification target: 500 distinct leagues per supported provider, all watched while imports, background work and retries continue. |
| [H10](evidence/backend-workspace-handoff.md) | approved_policy | Every league-access allow expires at the latest successful qualifying membership verification plus 3,600 seconds |
| [H11](evidence/backend-workspace-handoff.md) | approved_need | L1 account/sign-in access is never disabled by provider outage, membership loss, disconnect or this expiry. |
| [H12](evidence/backend-workspace-handoff.md) | preservation_constraint | Preserve the existing worker architecture, exact-week behavior, clock-v1, frozen baselines and missing/bye policies |
| [H13](evidence/backend-workspace-handoff.md) | approved_scope | A bounded first slice for identification, discovery, shared current teams and authorized stored reads |
| [H14](evidence/backend-workspace-handoff.md) | open_decisions | Open product decisions: D03 mistaken exclusive-account claim/replacement recovery |
| [H15](evidence/backend-workspace-handoff.md) | process_constraint | Never read or use retained `.env.integration.local` for this task |
| [H16](evidence/backend-workspace-handoff.md) | process_constraint | Use `clawmachinejed/league-one-audit`; a blank replacement repository is not the selected approach. |
| [H17](evidence/backend-workspace-handoff.md) | process_constraint | Establish one normative target entry point in the existing repository documentation |
| [P02](evidence/backend-policy-register.json) | approved_policy | "max_membership_age_seconds": 3600 |
| [C02](contracts.md) | engineering_derivation | ## 2. Identity and period model |
| [C03](contracts.md) | engineering_derivation | ## 3. Observation envelope and acceptance |
| [C05](contracts.md) | engineering_derivation | ## 5. Independent state and feature contracts |
| [C06](contracts.md) | engineering_derivation | ## 6. Adapter and ingestion ports |
| [C07](contracts.md) | engineering_derivation | ## 7. Reader ports and compatibility |
| [C08](contracts.md) | engineering_derivation | ## 8. Access, cache and display privacy |
| [C11](contracts.md) | engineering_derivation | ## 11. First slice: identification, shared current teams and stored reads |
| [F](foundation.json) | field_allocation | "records": [ |
| [G](methodology-audit.md) | verification_plan | ## Required closure artifacts and exit criteria |
| [AG](../../AGENTS.md) | preservation_constraint | Preserve existing routes, payloads, fallbacks, caching, presentation, league selection, and manager selection |
| [QO](quality-operations.md) | selected_engineering_design | ## Operating evidence contract |
| [QA](quality-operations.md) | selected_engineering_analysis | ## Refined scenarios and analysis |
| [AD](quality-operations.md) | selected_engineering_design | ## Selected alternatives and decision record |
| [BS](behavior-security-design.md) | selected_engineering_design | ## Context and ownership |
| [U01](backend-decisions.json) | direct_user_delegation | direct_user_delegation |

## Forward obligations

| ID | Atomic requirement | Source | Owner | Fields / constraints / types | Verification | Gate |
| --- | --- | --- | --- | --- | --- | --- |
| R001 | The service shall resolve Actor.id from the trusted L1 request principal rather than a submitted provider or actor identifier. | H02, C02 | auth | Actor.id; LeagueAccessDecision.actorId; type:Id; type:ActorDependency | FS18.01 | G6 |
| R002 | Provider outage, membership expiry, removal or disconnect shall leave the L1 actor lifecycle and login identities unchanged. | H11, P02 | auth | Actor.status; AcquisitionContext.state; Actor#1 | FS17.01 | G6 |
| R003 | Final delivery shall require the same active actor revision and live stored request session resolved by the existing authentication authority. | C08, C11 | auth | Actor.revision; LeagueAccessDecision.dependencyRefs; type:ActorDependency; type:SessionDependency | FS08.01 | G6 |
| R004 | Provider account identity shall remain unique and stable by the exact provider, namespace and native account key across username changes or reassignment. | H01, C02 | identity | ProviderAccount.id; ProviderAccount.provider; ProviderAccount.namespace; ProviderAccount.nativeAccountId; ProviderAccount.username; ProviderAccount#1; type:NativeId | FS18.02 | G6 |
| R005 | A shared manager identity shall retain truthful lookup or qualified-role provenance matching its exact provider account key. | H03, C03, F | identity | ProviderAccount.identityEvidenceKind; ProviderAccount.identityEvidenceRef; ProviderAccount.nativeAccountId; ProviderAccount#2; type:ProviderManagerIdentity; type:Ref | FS01.01 | G6 |
| R006 | Missing optional provider display fields shall preserve stable provider identity while retaining each field's observed state. | H01, H03, F | identity | ProviderAccount.username; ProviderAccount.displayName; ProviderAccount.avatar; type:Field<T> | FS11.01 | G6 |
| R007 | Pre-enrollment identification shall retain a capture scoped by immutable lookup request, provider, context and audience without a fabricated league or mapping. | H01, C03 | identity | IdentifyProviderAccountResult.lookupRequestId; IdentifyProviderAccountResult.evidenceRef; ResourceEvidence.scope; ResourceEvidence.sourceMappingRevisionId; ResourceEvidence#2; type:IdentityLookupScope | FS18.03 | G6 |
| R008 | A lookup preview shall produce no association activation, league enrollment or follow mutation. | H01, H13, F | accounts | IdentifyProviderAccountResult.lookupRequestId; IdentifyProviderAccountResult#1 | FS18.04 | G6 |
| R009 | Identification shall return an account only for a validated successful lookup and a stable safe reason for non-success. | H01, C11, F | identity | IdentifyProviderAccountResult.status; IdentifyProviderAccountResult.account; IdentifyProviderAccountResult.reason; IdentifyProviderAccountResult.evidenceRef; IdentifyProviderAccountResult#1 | FS13.01 | G6 |
| R010 | Association activation shall require the associating subject's successful lookup receipt matching the resolved provider account. | H01, H02, F | accounts | Association.subjectLookupEvidenceRef; Association.providerAccountId; Association#2 | FS18.05 | G6 |
| R011 | At most one active L1 association shall reference a given provider account. | H02, F | accounts | Association.providerAccountId; Association.state; Association#1 | FS02.01 | G6 |
| R012 | At most one active provider account per provider shall be associated with one actor. | H02, F | accounts | Association.actorId; Association.provider; Association.state; Association#1 | FS03.01 | G6 |
| R013 | Retrying the same successful association activation shall return its existing association identity. | H02, C03 | accounts | Association.id; Association#1 | FS03.02 | G6 |
| R014 | A read-only Sleeper association shall expose only user-asserted assurance. | H01, H02, F | accounts | Association.assurance | FS13.02 | G6 |
| R015 | Ending an association shall advance its revision and retain ended history with an actual end timestamp. | H02, H03, F | accounts | Association.state; Association.revision; Association.endedAt; Association#1 | FS08.02 | G6 |
| R016 | Acquisition shall require a server-resolved compatible provider and audience context independently of league serving permission. | H02, H08, C08 | acceptance | AcquisitionContext.id; AcquisitionContext.provider; AcquisitionContext.audienceId; AcquisitionContext#1; type:AccountResourceScope; type:IdentityLookupScope | FS16.01 | G6 |
| R017 | Revoked or expired acquisition authority shall fence pending acquisition and publication. | H02, P02, C08 | acceptance | AcquisitionContext.revision; AcquisitionContext.state; AcquisitionContext.authorityExpiresAt; AcquisitionContext#1; type:AcquisitionDependency | FS08.03 | G6 |
| R018 | A discovery continuation shall remain bound to its reserved association revision and declared work identity. | H02, C06, F | discovery | DiscoveryScan.id; DiscoveryScan.associationId; DiscoveryScan.associationRevision; DiscoveryScan#1 | FS09.01 | G6 |
| R019 | A discovery scan shall declare a versioned sorted unique season-query set covering its qualified strategy and retained current selections. | H05, C11, F | discovery | DiscoveryScan.requiredSeasons; DiscoveryScan.strategyVersion | FS19.01 | G6 |
| R020 | Discovery progress shall preserve successful season receipts and resumable unfinished work without converting failed scopes to empty results. | H04, C03, C06 | discovery | DiscoveryScan.completedSeasons; DiscoveryScan.candidateRefs; DiscoveryScan.continuation; DiscoveryScan.status; DiscoveryScan#1 | FS09.02 | G6 |
| R021 | Candidate discovery shall not itself create eligibility, enrollment or follow state. | H03, H05, F | discovery | DiscoveryScan.candidateRefs; DiscoveryScan#1 | FS04.01 | G6 |
| R022 | A league's stable UUID and public route key shall survive verified annual alias renewal. | H05, C02 | mapping | LeagueSeason.id; LeagueSeason.leagueId; LeagueSeason.routeKey; LeagueSeason.sourceLeagueId; LeagueSeason#1 | FS14.01 | G6 |
| R023 | A first-slice league season shall retain its exact native four-digit season and NFL sport identity. | H01, C02, F | mapping | LeagueSeason.season; LeagueSeason.sport | FS13.03 | G6 |
| R024 | An enrolled league-season source reference shall pin the selected connection and exact immutable mapping revision. | C02, C03, F | mapping | LeagueSeason.connectionId; LeagueSeason.mappingRevisionId; LeagueSeason#1; type:MappingDependency | FS10.01 | G6 |
| R025 | Unknown league name and lifecycle values shall remain explicit source states without changing proven current eligibility. | H04, H05, F | settings | LeagueSeason.name; LeagueSeason.lifecycle | FS14.02 | G6 |
| R026 | A native predecessor field shall remain candidate lineage until renewal qualification proves the transition. | H05, C11 | mapping | LeagueSeason.predecessor | FS14.03 | G6 |
| R027 | Exhaustive team population shall be qualified from independent expected-population evidence rather than counted returned rows. | H04, C03, F | teams | LeagueSeason.teamCount; ResourceEvidence.coverage; type:EvidenceCoverage | FS12.01 | G6 |
| R028 | The first slice shall retain actual native settings with their existing typed groups and source provenance. | H06, H07, C05 | settings | LeagueSeason.settingsRef | FS11.02 | G6 |
| R029 | Reliable official league access shall not require a qualified analytics assessment or optional directory/catalog/projection success. | H06, H07, C11 | access | LeagueSeason.analyticsAssessmentRef; ReadCurrentRosterResult.features | FS11.03 | G6 |
| R030 | Current selection shall be independent for each association and stable league rather than filtered to one global year. | H05, C11 | access | CurrentSelection.associationId; CurrentSelection.leagueId; CurrentSelection.leagueSeasonId; DiscoverCurrentTeamsResult.selections; CurrentSelection#1 | FS14.04 | G6 |
| R031 | A current-selection dependency shall resolve its exact association/league key and a season belonging to that league. | C02, C11, F | access | CurrentSelection.associationId; CurrentSelection.leagueId; CurrentSelection.leagueSeasonId; CurrentSelection.selectionRevision; CurrentSelection#2; type:CurrentSelectionDependency | FS20.01 | G6 |
| R032 | Initial current selection shall retain evidenced origin without manufacturing renewal history. | H05, C11, F | mapping | CurrentSelection.renewalRef | FS14.05 | G6 |
| R033 | All qualifying co-managers shall resolve one shared season-team identity and shared roster evidence. | H03, C02 | teams | TeamEvidence.seasonTeamId; TeamEvidence.leagueSeasonId; HeldRoster.seasonTeamId; TeamEvidence#1 | FS01.02 | G6 |
| R034 | Team provider/native aliases shall agree with the accepted source-team reference and captured mapping namespace. | C02, F | teams | TeamEvidence.provider; TeamEvidence.nativeTeamId; TeamEvidence.acceptanceRef; TeamEvidence#2 | FS13.04 | G6 |
| R035 | Primary-owner normalization shall distinguish owned, explicitly unowned and unknown evidence. | H03, H04, F | normalize | TeamEvidence.primaryOwner; type:ProviderManagerIdentity | FS07.01 | G6 |
| R036 | Co-manager normalization shall distinguish a qualified empty list from absent, null or invalid coverage. | H03, H04, F | normalize | TeamEvidence.coManagers; type:ProviderManagerIdentity; type:EvidenceCoverage | FS07.02 | G6 |
| R037 | Observed manager evidence shall not invent a historical effective start time. | H04, C03, F | teams | TeamEvidence.effectiveFrom | FS13.05 | G6 |
| R038 | Held inventory replacement shall require a validated complete population and an explicit known player list. | H04, C03, F | roster | HeldRoster.players; HeldRoster.acceptanceRef; HeldRoster#1; type:Field<T> | FS12.02 | G6 |
| R039 | Canonical held-player references shall remain positionally aligned with native players while preserving unresolved mappings as null. | H06, H07, F | roster | HeldRoster.players; HeldRoster.canonicalEntityRefs | FS15.01 | G6 |
| R040 | Held-roster placement and optional metadata shall carry independent evidence and age rather than invalidate held identity. | H06, C05, F | roster | HeldRoster.groupsRef; HeldRoster.metadataRef | FS11.04 | G6 |
| R041 | Current held membership shall never be substituted for exact-week lineup evidence. | H12, C07, F | roster | HeldRoster.acceptanceRef; HeldRoster#1 | INV-R041 | G6 |
| R042 | Manager-resource acceptance shall remain independent of held-player validation. | H04, C03, F | acceptance | TeamEvidence.acceptanceRef; HeldRoster.acceptanceRef; HeldRoster#1 | FS12.03 | G6 |
| R043 | Follow preference shall remain an explicit actor/stable-league choice with no authorization effect. | H02, H05, F | accounts | Follow.actorId; Follow.leagueId; Follow.state; Follow#1 | FS20.02 | G6 |
| R044 | An unfollow shall retain a revision tombstone addressable by the exact actor/league tuple. | H05, F | accounts | Follow.revision; Follow.actorId; Follow.leagueId; Follow#2; type:PreferenceDependency | FS20.03 | G6 |
| R045 | Renewal shall require immutable compatible predecessor/successor lineage for the same stable league and a later season. | H05, C11 | mapping | Renewal.id; Renewal.predecessorSeasonId; Renewal.successorSeasonId; CurrentSelection.renewalRef; Renewal#1 | FS14.06 | G6 |
| R046 | Renewal selection shall compare the reserved association, both mapping revisions and expected selection revision before commit. | H05, C03, F | mapping | Renewal.associationId; Renewal.associationRevision; Renewal.expectedSelectionRevision; Renewal.predecessorMappingRevisionId; Renewal.successorMappingRevisionId; CurrentSelection.selectionRevision; Renewal#1 | FS10.02 | G6 |
| R047 | Successor access shall require fresh qualified successor membership evidence rather than inherited predecessor age. | H05, H10, F | access | Renewal.membershipEvidenceRef; LeagueAccessDecision.qualifyingVerifiedAt; Renewal#1 | FS14.07 | G6 |
| R048 | Verified renewal shall carry only an existing follow whose captured revision remains current. | H05, F | accounts | Renewal.expectedFollowRevision; Follow.carryoverRef; Follow.revision; Follow#1 | FS20.04 | G6 |
| R049 | Individual unfollow, disconnect or eligibility loss shall preserve other actors' independent state and shared facts. | H03, H11 | accounts | Association.actorId; Follow.actorId; LeagueAccessDecision.eligibleTeamIds; TeamEvidence.seasonTeamId | FS07.03 | G6 |
| R050 | Every evidence reference shall resolve within its declared scope, audience and captured source mapping. | H08, C03, F | acceptance | ResourceEvidence.scope; ResourceEvidence.sourceMappingRevisionId; ResourceEvidence.captureRef; ResourceEvidence#1; type:SourceScope; type:DiscoveryScope; type:AccountResourceScope; type:IdentityLookupScope; type:Ref | FS13.06 | G6 |
| R051 | Accepted normalized heads shall be independently keyed by complete scope plus normalizer and validation versions. | C03, F | acceptance | ResourceEvidence.canonicalNormalizerVersion; ResourceEvidence.validationVersion; ResourceEvidence.scope; ResourceEvidence#1 | FS21.01 | G6 |
| R052 | Observation provenance shall preserve distinct network, cache, replay, source-observation and processing times. | H04, H08, C03 | acceptance | ResourceEvidence.origin; ResourceEvidence.sourceObservedAt; ResourceEvidence.requestStartedAt; ResourceEvidence.requestCompletedAt; ResourceEvidence.normalizedAt; ResourceEvidence#1; type:Instant | FS09.03 | G6 |
| R053 | Capture/transport failure shall retain null content, acceptance and normalization fields where those events did not occur. | H04, C03, F | acceptance | ResourceEvidence.normalizedAt; ResourceEvidence.contentRef; ResourceEvidence.acceptedGeneration; ResourceEvidence.attemptOrdinal; ResourceEvidence#2; ResourceEvidence#3 | FS12.04 | G6 |
| R054 | Qualifying membership verification time shall advance only from accepted compatible qualified network role evidence. | H10, P02, F | acceptance | ResourceEvidence.qualifyingVerifiedAt; LeagueAccessDecision.qualifyingVerifiedAt | FS22.01 | G6 |
| R055 | Coverage evidence shall distinguish requested dimensions, observed dimensions and independently qualified role/population groups. | H04, C03, F | acceptance | ResourceEvidence.coverage; ResourceEvidence#1; type:EvidenceCoverage | FS12.05 | G6 |
| R056 | An older admitted attempt shall not advance a newer accepted head or selection after delayed completion. | H08, C03, F | acceptance | ResourceEvidence.attemptOrdinal; ResourceEvidence.acceptedGeneration | FS10.03 | G6 |
| R057 | Accepted source corrections shall append immutable evidence and may decrease official values without rewriting frozen baselines. | H07, H08, H12, C03 | acceptance | ResourceEvidence.contentRef; ResourceEvidence.captureRef; ResourceEvidence.acceptedGeneration | FS22.02 | G6 |
| R058 | Compatible source demand shall share one acquisition while retaining distinct observation and normalized interpretation provenance. | H08, C06 | workers | ResourceEvidence.captureRef | FS16.02 | G6 |
| R059 | A serving selection shall identify exactly one explicit compatible versioned head for the complete scope and reader binding. | C03, F | access | ServingSelection.scope; ServingSelection.readerContract; ServingSelection.canonicalNormalizerVersion; ServingSelection.validationVersion; ServingSelection.acceptedRef; ServingSelection#1; ServingSelection#2; type:ServingSelectionDependency | FS21.02 | G6 |
| R060 | A serving-binding change and its required pending materialization shall commit atomically under the same binding revision. | C03, C06 | acceptance | ServingSelection.selectionRevision; ServingSelection.acceptedRef | FS09.04 | G6 |
| R061 | A qualified complete removal shall remain denying across promotion, rollback or replay until an explicitly proved later qualified positive supersedes it. | H04, H10, C03 | access | LeagueAccessDecision.dependencyRefs; ServingSelection.acceptedRef; LeagueAccessDecision#2; type:MembershipEvidenceRef; type:MembershipSupersession; type:AdverseMembershipEvidence | FS21.03 | G6 |
| R062 | Allow shall require a complete coherent adverse-evidence set that detects newly committed removals or newly qualified heads. | H04, C03, C11, F | access | LeagueAccessDecision.dependencyRefs; LeagueAccessDecision#2; type:MembershipDependency; type:AdverseMembershipEvidence | FS08.04 | G6 |
| R063 | League access shall expire at the latest qualifying verification plus exactly 3,600 seconds. | H10, P02 | access | LeagueAccessDecision.qualifyingVerifiedAt; LeagueAccessDecision.expiresAt; LeagueAccessDecision.evaluatedAt; type:Instant | FS06.01 | G6 |
| R064 | An independent deny or earlier applicable authority expiry shall end access before the D02 age limit. | H10, P02, C08 | access | LeagueAccessDecision.expiresAt; AcquisitionContext.authorityExpiresAt | FS07.04 | G6 |
| R065 | Unknown first-time membership shall never grant league access. | H03, H10, P02 | access | LeagueAccessDecision.outcome; LeagueAccessDecision.qualifyingVerifiedAt | FS06.02 | G6 |
| R066 | Failure, unqualified partial evidence, cache, replay and outage onset shall not extend membership verification or expiry. | H10, P02, C03 | access | ResourceEvidence.origin; LeagueAccessDecision.qualifyingVerifiedAt; LeagueAccessDecision.expiresAt | FS06.03 | G6 |
| R067 | Temporary membership expiry shall permit independently authorized bounded revalidation without requiring the expired league allow. | H10, H11, P02 | workers | LeagueAccessDecision.outcome; AcquisitionContext.state | FS17.02 | G6 |
| R068 | Only current qualified owner or co-manager roles shall qualify team-based league access. | H03, C11 | access | LeagueAccessDecision.eligibleTeamIds; LeagueAccessDecision#1 | FS05.01 | G6 |
| R069 | Qualified discovery and access shall enumerate all proven eligible teams for the selected season. | H03, C11, F | teams | LeagueAccessDecision.eligibleTeamIds; DiscoverCurrentTeamsResult.teams; DiscoverCurrentTeamsResult.access | FS01.03 | G6 |
| R070 | Access policy identity shall be explicit, immutable and validated against its current binding at delivery. | H10, P02, C11 | access | LeagueAccessDecision.policyVersion; LeagueAccessDecision.dependencyRefs; type:PolicyDependency | FS13.07 | G6 |
| R071 | Final stored delivery shall authorize from one coherent authoritative dependency state and clock rather than a mixture of independently read states. | C08, C11, G | access | LeagueAccessDecision.evaluatedAt; LeagueAccessDecision.dependencyRefs | FS08.05 | G6 |
| R072 | Dependency validation shall use the closed variant-specific key and exact revision or live-session semantics for every relevant authority. | C11, F | access | LeagueAccessDecision.dependencyRefs; type:DependencyRef; type:ActorDependency; type:SessionDependency; type:AssociationDependency; type:AcquisitionDependency; type:MappingDependency; type:CurrentSelectionDependency; type:MembershipDependency; type:PolicyDependency; type:PreferenceDependency; type:ServingSelectionDependency | FS13.08 | G6 |
| R073 | An access decision shall identify its exact selected league season and stable policy reason without conflating expiry with removal. | H04, H10, C11, F | access | LeagueAccessDecision.leagueSeasonId; LeagueAccessDecision.outcome; LeagueAccessDecision.reason | FS17.03 | G6 |
| R074 | An available stored-roster result shall contain the exact required fields bound to its selected season and resource revision. | H13, C07, F | roster | ReadCurrentRosterResult.status; ReadCurrentRosterResult.leagueSeasonId; ReadCurrentRosterResult.eligibleTeamIds; ReadCurrentRosterResult.resourceRevision; ReadCurrentRosterResult.roster; ReadCurrentRosterResult#1 | FS13.09 | G6 |
| R075 | Authorized pending or unavailable stored-roster results shall represent missing resources without fabricating empty accepted inventory. | H04, C07, F | roster | ReadCurrentRosterResult.status; ReadCurrentRosterResult.resourceRevision; ReadCurrentRosterResult.roster; ReadCurrentRosterResult.fieldGroups; ReadCurrentRosterResult.features; ReadCurrentRosterResult.reason; ReadCurrentRosterResult#1 | FS13.10 | G6 |
| R076 | Denied or indeterminate stored results shall serialize exactly status and a safe reason, including before current selection exists. | H03, C08, C11, F | access | ReadCurrentRosterResult.status; ReadCurrentRosterResult.reason; ReadCurrentRosterResult#1 | FS05.02 | G6 |
| R077 | Authorized official field groups shall preserve original source authority, coverage and age independently of derived feature assessment. | H06, H07, H08, C05 | roster | ReadCurrentRosterResult.fieldGroups; ReadCurrentRosterResult.features | FS11.05 | G6 |
| R078 | A discovered current-team result shall retain its exact scan, independent selections and unresolved candidate evidence. | H04, H05, C11, F | discovery | DiscoverCurrentTeamsResult.scanId; DiscoverCurrentTeamsResult.selections; DiscoverCurrentTeamsResult.unresolvedCandidateRefs; DiscoverCurrentTeamsResult.reasons; DiscoverCurrentTeamsResult#1 | FS19.02 | G6 |
| R079 | Discovery completeness shall require both declared list-scope completion and current-team qualification. | H03, H04, C11, F | discovery | DiscoveryScan.status; DiscoverCurrentTeamsResult.status; DiscoverCurrentTeamsResult.access; DiscoverCurrentTeamsResult#1 | FS19.03 | G6 |
| R080 | Stored-roster reads shall perform no provider acquisition. | H13, C06, C11, F | roster | ReadCurrentRosterResult.roster; ReadCurrentRosterResult#1 | FS05.03 | G6 |
| R081 | Opaque native identifiers shall round-trip exactly without JavaScript safe-integer conversion or synthetic substitution. | H01, C02, F | normalize | ProviderAccount.nativeAccountId; TeamEvidence.nativeTeamId; HeldRoster.players; LeagueSeason.sourceLeagueId; type:NativeId; type:Id; type:Revision | FS15.02 | G6 |
| R082 | Field-state serialization shall preserve known, explicit empty, absent, null and invalid meanings. | H04, C05, F | normalize | ProviderAccount.username; ProviderAccount.displayName; ProviderAccount.avatar; LeagueSeason.name; LeagueSeason.lifecycle; LeagueSeason.predecessor; LeagueSeason.teamCount; HeldRoster.players; type:Field<T>; type:Json | FS15.03 | G6 |
| R083 | The first slice shall extend existing shared acquisition, normalization, scoring, snapshot and publication owners without adding a parallel pipeline. | H12, H16, C06 | review | (preservation/process obligation; no new DTO field) | INV-R083 | G6 |
| R084 | Browser pages and lightweight observers shall make no Tank01 acquisition calls. | H12, AG | review | (preservation/process obligation; no new DTO field) | INV-R084 | G6 |
| R085 | Existing exact-week, clock-v1, frozen-baseline and bye/missing-projection semantics shall remain unchanged for preserved source inputs. | H12, H07 | review | (preservation/process obligation; no new DTO field) | INV-R085 | G6 |
| R086 | League One and League Two shall retain isolated official, calculated and selected-manager state. | H12, AG | review | (preservation/process obligation; no new DTO field) | INV-R086 | G7 |
| R087 | Existing routes, public payloads, fallback/cache behavior and league/manager selections shall remain unchanged before separately authorized cutover. | AG, C07, H13 | review | (preservation/process obligation; no new DTO field) | INV-R087 | G6 |
| R088 | Followed-league maintenance and active-view promotion shall use the existing shared scheduler while users are absent or views change. | H08, C06 | workers | (preservation/process obligation; no new DTO field) | INV-R088 | G6 |
| R089 | Future league providers shall remain unimplemented in this slice and use the existing adapter/mapping/test boundaries when later added. | H01, H16, C06 | review | (preservation/process obligation; no new DTO field) | INV-R089 | G6 |
| R090 | Documentation work shall remain confined to the attached isolated worktree and preserve unrelated primary-checkout changes. | H16, H15 | review | (preservation/process obligation; no new DTO field) | INV-R090 | G1 |
| R091 | The design shall retain one normative entry point and identify portable copies by exact source revision and hashes. | H17 | review | (preservation/process obligation; no new DTO field) | INV-R091 | G1 |
| R092 | Target database tests shall execute only through the fully guarded disposable harness and shall not read retained production credentials. | H15 | review | (preservation/process obligation; no new DTO field) | INV-R092 | G6 |
| R093 | Implementation and release shall revalidate canonical source and deployment identity before changing their respective baselines. | H16, AG | review | (preservation/process obligation; no new DTO field) | INV-R093 | G7 |
| R094 | A changed first-slice invariant shall trigger impact review of its source requirement, allocated design, test oracle and downstream evidence. | H17, G | review | (preservation/process obligation; no new DTO field) | INV-R094 | G1 |
| R095 | A final allow shall validate the selected active auth-admission epoch and configuration binding under the existing auth security fence. | C11, AD, G | auth | LeagueAccessDecision.dependencyRefs | FS08.06 | G6 |
| R096 | The selected coherent-read protocol shall require verified common auth/application database and clock authority before allowing a target league read. | C11, AD, G | access | LeagueAccessDecision.evaluatedAt | FS08.07 | G6 |
| R097 | Every relevant authority mutator and final reader shall use the selected ordered lock and per-connection authorization-generation protocol. | C11, AD, G | acceptance | LeagueAccessDecision.dependencyRefs; ResourceEvidence.attemptOrdinal; type:MembershipDependency | FS08.08 | G6 |
| R098 | A final-read authority failure shall return a bounded safe result without automatic retry in that request. | C11, AD | access | LeagueAccessDecision.outcome; LeagueAccessDecision.reason | FS08.09 | G6 |
| R099 | New diagnostic events shall serialize only the selected typed, non-identifying envelope and fixed reason/outcome combinations. | QO | access | (preservation/process obligation; no new DTO field) | INV-R099 | G6 |
| R100 | A forbidden protected response shape shall be suppressed before serialization and reported only by a safe count/correlation event. | QO, C08 | access | ReadCurrentRosterResult.status; ReadCurrentRosterResult.reason | INV-R100 | G6 |
| R101 | Revalidation queue diagnostics shall describe committed durable work and its actual pending count/oldest age. | QO, H10 | workers | DiscoveryScan.continuation | INV-R101 | G6 |
| R102 | Nontransactional diagnostic sink failure shall not change the completed authorization outcome or recursively log through the failed sink. | QO | access | LeagueAccessDecision.outcome | INV-R102 | G6 |
| R103 | Failure of required transactional mutation audit or pending-work persistence shall roll back the associated mutation. | QO, C06 | accounts | Association.revision; ServingSelection.selectionRevision | INV-R103 | G6 |
| R104 | Target activation shall require restricted operator-only diagnostics with enforced retention no greater than seven days. | QO | review | (preservation/process obligation; no new DTO field) | INV-R104 | G7 |
| R105 | Proposed privileged guard helpers shall confine every call to the exact allowlisted role, signature and server-authorized scope. | BS, C08, C11 | access | (preservation/process obligation; no new DTO field) | FS13.11 | G6 |
| R106 | Target stored responses shall be private/no-store and shall never reuse a cached access allow. | BS, C08, C11 | access | ReadCurrentRosterResult.status | FS05.04 | G6 |
| R107 | Target identification and mutation commands shall preserve existing admission, origin, input-size and request/mutation-budget controls. | BS, C08, C11 | accounts | (preservation/process obligation; no new DTO field) | INV-R107 | G6 |
| R108 | The provider adapter shall construct allowlisted routes from validated encoded keys rather than execute caller-supplied network or SQL targets. | BS, C08, C11 | identity | (preservation/process obligation; no new DTO field) | INV-R108 | G6 |

All obligations have the bounded design status recorded above; runtime status is unexecuted. JSON records preserve allocation rationale and scope. Approved needs remain binding. Derived mechanisms may be replaced only after equivalent proof and synchronized change review; a requirement does not authorize its own implementation.

## Fixture and evidence controls

### FX0

Disposable deterministic graph: trusted L1 actors A and B with distinct live sessions SA/SB; provider sleeper, global user namespace; accounts PA/PB with exact native strings; stable leagues L/L2, seasons L-2025/L-2026 and L2-2026; shared teams T1/T2; immutable mapping revisions MA1/MB1; public audience U and disjoint private audiences V/W; trusted clock T=2026-10-01T00:00:00Z. Each case declares only the required variation. Fixture IDs are synthetic, not production identifiers.

### FX-race

Use the guarded disposable SQL harness and actual restricted writer/reader roles. Two independent transactions or workers stop at declared barriers, then commit in the specified order. Expected values are independently stated here; assert final stored rows/receipts and serialized bytes, not only success flags. Reverse commit order where specified.

### FX-source

Versioned sanitized Sleeper endpoint captures plus authored malformed/absent/null/empty variations; retain original bytes, declared request scope, observation provenance and validation expectations. An unrelated supported league must be independently sourced before claiming source completeness. Synthetic fixtures prove handling, not provider coverage.

### FX-preserve

Pinned source-baseline compatibility manifests for existing League One and League Two routes, public payloads, selected manager/league, exact-week behavior, clock-v1 calculations and frozen snapshot/profile identities. Compare the same input captures before and after later implementation; preserve approved exceptions.

## Forward design allocation

Each requirement names actual design element IDs. Storage field allocations come only from the exact relational field map; additional storage scaffolding has a specific rationale. Behavior transition allocation is manually reviewed by trigger/guard/output. Control, quality, decision and oracle allocations are exact inverses of their authored crosswalks plus explicit reviewed extensions. Review gates allocate process/preservation obligations without inventing runtime components. The reverse model_trace is generated from these forward allocations and must be exact; IDs and links establish navigation, not evidence that a test passed.

| Requirement | Allocated model elements | Concrete design references |
| --- | --- | --- |
| R001 | storage_responsibilities: RD01, RD02, RD05, RD09, RD10, RD14, RD17; transitions: BS-T01, BS-T02, BS-T06, BS-T17; controls: BS-C01; security_oracles: BS-O01 | [relational-design.json](relational-design.json); [behavior-security-design.md#transition-contracts](behavior-security-design.md#transition-contracts); [behavior-security-design.md#threat-control-and-verification-allocation](behavior-security-design.md#threat-control-and-verification-allocation); [behavior-security-design.md#independent-fixture-and-oracle-methods](behavior-security-design.md#independent-fixture-and-oracle-methods); [relational-design.md#selected-model-and-storage](relational-design.md#selected-model-and-storage) |
| R002 | storage_responsibilities: RD01, RD06; transitions: BS-T07, BS-T08, BS-T09, BS-T10, BS-T17; controls: BS-C11; quality_scenarios: QA03; security_oracles: BS-O09 | [relational-design.json](relational-design.json); [behavior-security-design.md#transition-contracts](behavior-security-design.md#transition-contracts); [behavior-security-design.md#threat-control-and-verification-allocation](behavior-security-design.md#threat-control-and-verification-allocation); [quality-operations.md#refined-scenarios-and-analysis](quality-operations.md#refined-scenarios-and-analysis); [behavior-security-design.md#independent-fixture-and-oracle-methods](behavior-security-design.md#independent-fixture-and-oracle-methods); [relational-design.md#selected-model-and-storage](relational-design.md#selected-model-and-storage) |
| R003 | storage_responsibilities: RD01, RD02, RD17; transitions: BS-T02, BS-T06, BS-T17; controls: BS-C01; quality_scenarios: QA02; architecture_decisions: AD01; security_oracles: BS-O05, BS-O07 | [relational-design.json](relational-design.json); [behavior-security-design.md#transition-contracts](behavior-security-design.md#transition-contracts); [behavior-security-design.md#threat-control-and-verification-allocation](behavior-security-design.md#threat-control-and-verification-allocation); [quality-operations.md#refined-scenarios-and-analysis](quality-operations.md#refined-scenarios-and-analysis); [quality-operations.md#selected-alternatives-and-decision-record](quality-operations.md#selected-alternatives-and-decision-record); [behavior-security-design.md#independent-fixture-and-oracle-methods](behavior-security-design.md#independent-fixture-and-oracle-methods); [relational-design.md#selected-model-and-storage](relational-design.md#selected-model-and-storage); [relational-design.md#selected-transaction-protocols](relational-design.md#selected-transaction-protocols) |
| R004 | storage_responsibilities: RD03, RD04; transitions: BS-T01; security_oracles: BS-O01 | [relational-design.json](relational-design.json); [behavior-security-design.md#transition-contracts](behavior-security-design.md#transition-contracts); [behavior-security-design.md#independent-fixture-and-oracle-methods](behavior-security-design.md#independent-fixture-and-oracle-methods); [relational-design.md#selected-model-and-storage](relational-design.md#selected-model-and-storage) |
| R005 | storage_responsibilities: RD03, RD04; transitions: BS-T01, BS-T04; controls: BS-C10; security_oracles: BS-O10 | [relational-design.json](relational-design.json); [behavior-security-design.md#transition-contracts](behavior-security-design.md#transition-contracts); [behavior-security-design.md#threat-control-and-verification-allocation](behavior-security-design.md#threat-control-and-verification-allocation); [behavior-security-design.md#independent-fixture-and-oracle-methods](behavior-security-design.md#independent-fixture-and-oracle-methods); [relational-design.md#selected-model-and-storage](relational-design.md#selected-model-and-storage) |
| R006 | storage_responsibilities: RD03, RD04; transitions: BS-T01, BS-T04; controls: BS-C10; quality_scenarios: QA10; security_oracles: BS-O10 | [relational-design.json](relational-design.json); [behavior-security-design.md#transition-contracts](behavior-security-design.md#transition-contracts); [behavior-security-design.md#threat-control-and-verification-allocation](behavior-security-design.md#threat-control-and-verification-allocation); [quality-operations.md#refined-scenarios-and-analysis](quality-operations.md#refined-scenarios-and-analysis); [behavior-security-design.md#independent-fixture-and-oracle-methods](behavior-security-design.md#independent-fixture-and-oracle-methods); [relational-design.md#selected-model-and-storage](relational-design.md#selected-model-and-storage) |
| R007 | storage_responsibilities: RD04, RD09, RD13, RD17; transitions: BS-T01; security_oracles: BS-O10 | [relational-design.json](relational-design.json); [behavior-security-design.md#transition-contracts](behavior-security-design.md#transition-contracts); [behavior-security-design.md#independent-fixture-and-oracle-methods](behavior-security-design.md#independent-fixture-and-oracle-methods); [relational-design.md#selected-model-and-storage](relational-design.md#selected-model-and-storage) |
| R008 | storage_responsibilities: RD04, RD17; transitions: BS-T01; security_oracles: BS-O10 | [relational-design.json](relational-design.json); [behavior-security-design.md#transition-contracts](behavior-security-design.md#transition-contracts); [behavior-security-design.md#independent-fixture-and-oracle-methods](behavior-security-design.md#independent-fixture-and-oracle-methods); [relational-design.md#selected-model-and-storage](relational-design.md#selected-model-and-storage) |
| R009 | storage_responsibilities: RD04, RD17; transitions: BS-T01; security_oracles: BS-O01 | [relational-design.json](relational-design.json); [behavior-security-design.md#transition-contracts](behavior-security-design.md#transition-contracts); [behavior-security-design.md#independent-fixture-and-oracle-methods](behavior-security-design.md#independent-fixture-and-oracle-methods); [relational-design.md#selected-model-and-storage](relational-design.md#selected-model-and-storage) |
| R010 | storage_responsibilities: RD05; transitions: BS-T02; controls: BS-C02, BS-C10; quality_scenarios: QA04; security_oracles: BS-O02, BS-O10 | [relational-design.json](relational-design.json); [behavior-security-design.md#transition-contracts](behavior-security-design.md#transition-contracts); [behavior-security-design.md#threat-control-and-verification-allocation](behavior-security-design.md#threat-control-and-verification-allocation); [quality-operations.md#refined-scenarios-and-analysis](quality-operations.md#refined-scenarios-and-analysis); [behavior-security-design.md#independent-fixture-and-oracle-methods](behavior-security-design.md#independent-fixture-and-oracle-methods); [relational-design.md#selected-model-and-storage](relational-design.md#selected-model-and-storage) |
| R011 | storage_responsibilities: RD05; transitions: BS-T02; controls: BS-C02; quality_scenarios: QA04; security_oracles: BS-O02 | [relational-design.json](relational-design.json); [behavior-security-design.md#transition-contracts](behavior-security-design.md#transition-contracts); [behavior-security-design.md#threat-control-and-verification-allocation](behavior-security-design.md#threat-control-and-verification-allocation); [quality-operations.md#refined-scenarios-and-analysis](quality-operations.md#refined-scenarios-and-analysis); [behavior-security-design.md#independent-fixture-and-oracle-methods](behavior-security-design.md#independent-fixture-and-oracle-methods); [relational-design.md#selected-model-and-storage](relational-design.md#selected-model-and-storage) |
| R012 | storage_responsibilities: RD05; transitions: BS-T02; controls: BS-C02; quality_scenarios: QA04; security_oracles: BS-O02 | [relational-design.json](relational-design.json); [behavior-security-design.md#transition-contracts](behavior-security-design.md#transition-contracts); [behavior-security-design.md#threat-control-and-verification-allocation](behavior-security-design.md#threat-control-and-verification-allocation); [quality-operations.md#refined-scenarios-and-analysis](quality-operations.md#refined-scenarios-and-analysis); [behavior-security-design.md#independent-fixture-and-oracle-methods](behavior-security-design.md#independent-fixture-and-oracle-methods); [relational-design.md#selected-model-and-storage](relational-design.md#selected-model-and-storage) |
| R013 | storage_responsibilities: RD05, RD16; transitions: BS-T02, BS-T18; controls: BS-C02, BS-C09; quality_scenarios: QA04; security_oracles: BS-O02, BS-O13 | [relational-design.json](relational-design.json); [behavior-security-design.md#transition-contracts](behavior-security-design.md#transition-contracts); [behavior-security-design.md#threat-control-and-verification-allocation](behavior-security-design.md#threat-control-and-verification-allocation); [quality-operations.md#refined-scenarios-and-analysis](quality-operations.md#refined-scenarios-and-analysis); [behavior-security-design.md#independent-fixture-and-oracle-methods](behavior-security-design.md#independent-fixture-and-oracle-methods); [relational-design.md#selected-model-and-storage](relational-design.md#selected-model-and-storage) |
| R014 | storage_responsibilities: RD05; transitions: BS-T02; controls: BS-C02; quality_scenarios: QA04; security_oracles: BS-O02 | [relational-design.json](relational-design.json); [behavior-security-design.md#transition-contracts](behavior-security-design.md#transition-contracts); [behavior-security-design.md#threat-control-and-verification-allocation](behavior-security-design.md#threat-control-and-verification-allocation); [quality-operations.md#refined-scenarios-and-analysis](quality-operations.md#refined-scenarios-and-analysis); [behavior-security-design.md#independent-fixture-and-oracle-methods](behavior-security-design.md#independent-fixture-and-oracle-methods); [relational-design.md#selected-model-and-storage](relational-design.md#selected-model-and-storage) |
| R015 | storage_responsibilities: RD05; transitions: BS-T09; security_oracles: BS-O05 | [relational-design.json](relational-design.json); [behavior-security-design.md#transition-contracts](behavior-security-design.md#transition-contracts); [behavior-security-design.md#independent-fixture-and-oracle-methods](behavior-security-design.md#independent-fixture-and-oracle-methods); [relational-design.md#selected-model-and-storage](relational-design.md#selected-model-and-storage) |
| R016 | storage_responsibilities: RD06; transitions: BS-T03, BS-T06, BS-T10; controls: BS-C04; quality_scenarios: QA06; architecture_decisions: AD05 | [relational-design.json](relational-design.json); [behavior-security-design.md#transition-contracts](behavior-security-design.md#transition-contracts); [behavior-security-design.md#threat-control-and-verification-allocation](behavior-security-design.md#threat-control-and-verification-allocation); [quality-operations.md#refined-scenarios-and-analysis](quality-operations.md#refined-scenarios-and-analysis); [quality-operations.md#selected-alternatives-and-decision-record](quality-operations.md#selected-alternatives-and-decision-record); [relational-design.md#selected-model-and-storage](relational-design.md#selected-model-and-storage) |
| R017 | storage_responsibilities: RD06; transitions: BS-T03, BS-T06, BS-T09, BS-T10, BS-T16; quality_scenarios: QA02; architecture_decisions: AD04; security_oracles: BS-O05, BS-O09 | [relational-design.json](relational-design.json); [behavior-security-design.md#transition-contracts](behavior-security-design.md#transition-contracts); [quality-operations.md#refined-scenarios-and-analysis](quality-operations.md#refined-scenarios-and-analysis); [quality-operations.md#selected-alternatives-and-decision-record](quality-operations.md#selected-alternatives-and-decision-record); [behavior-security-design.md#independent-fixture-and-oracle-methods](behavior-security-design.md#independent-fixture-and-oracle-methods); [relational-design.md#selected-model-and-storage](relational-design.md#selected-model-and-storage) |
| R018 | storage_responsibilities: RD04, RD07; transitions: BS-T03, BS-T16; controls: BS-C03, BS-C09; quality_scenarios: QA09; security_oracles: BS-O03 | [relational-design.json](relational-design.json); [behavior-security-design.md#transition-contracts](behavior-security-design.md#transition-contracts); [behavior-security-design.md#threat-control-and-verification-allocation](behavior-security-design.md#threat-control-and-verification-allocation); [quality-operations.md#refined-scenarios-and-analysis](quality-operations.md#refined-scenarios-and-analysis); [behavior-security-design.md#independent-fixture-and-oracle-methods](behavior-security-design.md#independent-fixture-and-oracle-methods); [relational-design.md#selected-model-and-storage](relational-design.md#selected-model-and-storage) |
| R019 | storage_responsibilities: RD04, RD07; transitions: BS-T03; quality_scenarios: QA09; security_oracles: BS-O03 | [relational-design.json](relational-design.json); [behavior-security-design.md#transition-contracts](behavior-security-design.md#transition-contracts); [quality-operations.md#refined-scenarios-and-analysis](quality-operations.md#refined-scenarios-and-analysis); [behavior-security-design.md#independent-fixture-and-oracle-methods](behavior-security-design.md#independent-fixture-and-oracle-methods); [relational-design.md#selected-model-and-storage](relational-design.md#selected-model-and-storage) |
| R020 | storage_responsibilities: RD04, RD07; transitions: BS-T03, BS-T10, BS-T18; controls: BS-C03, BS-C09; quality_scenarios: QA05, QA09; operating_tests: OE-T03; security_oracles: BS-O03, BS-O13 | [relational-design.json](relational-design.json); [behavior-security-design.md#transition-contracts](behavior-security-design.md#transition-contracts); [behavior-security-design.md#threat-control-and-verification-allocation](behavior-security-design.md#threat-control-and-verification-allocation); [quality-operations.md#refined-scenarios-and-analysis](quality-operations.md#refined-scenarios-and-analysis); [quality-operations.md#operating-evidence-contract](quality-operations.md#operating-evidence-contract); [behavior-security-design.md#independent-fixture-and-oracle-methods](behavior-security-design.md#independent-fixture-and-oracle-methods); [relational-design.md#selected-model-and-storage](relational-design.md#selected-model-and-storage) |
| R021 | storage_responsibilities: RD04, RD07; transitions: BS-T03; quality_scenarios: QA09; security_oracles: BS-O03 | [relational-design.json](relational-design.json); [behavior-security-design.md#transition-contracts](behavior-security-design.md#transition-contracts); [quality-operations.md#refined-scenarios-and-analysis](quality-operations.md#refined-scenarios-and-analysis); [behavior-security-design.md#independent-fixture-and-oracle-methods](behavior-security-design.md#independent-fixture-and-oracle-methods); [relational-design.md#selected-model-and-storage](relational-design.md#selected-model-and-storage) |
| R022 | storage_responsibilities: RD08, RD09, RD15; transitions: BS-T04, BS-T12; architecture_decisions: AD06; security_oracles: BS-O08 | [relational-design.json](relational-design.json); [behavior-security-design.md#transition-contracts](behavior-security-design.md#transition-contracts); [quality-operations.md#selected-alternatives-and-decision-record](quality-operations.md#selected-alternatives-and-decision-record); [behavior-security-design.md#independent-fixture-and-oracle-methods](behavior-security-design.md#independent-fixture-and-oracle-methods); [relational-design.md#selected-model-and-storage](relational-design.md#selected-model-and-storage) |
| R023 | storage_responsibilities: RD08, RD09, RD15; transitions: BS-T04, BS-T05 | [relational-design.json](relational-design.json); [behavior-security-design.md#transition-contracts](behavior-security-design.md#transition-contracts); [relational-design.md#selected-model-and-storage](relational-design.md#selected-model-and-storage) |
| R024 | storage_responsibilities: RD08, RD09, RD15; transitions: BS-T04, BS-T06, BS-T12, BS-T16; controls: BS-C04; architecture_decisions: AD06; security_oracles: BS-O08, BS-O11 | [relational-design.json](relational-design.json); [behavior-security-design.md#transition-contracts](behavior-security-design.md#transition-contracts); [behavior-security-design.md#threat-control-and-verification-allocation](behavior-security-design.md#threat-control-and-verification-allocation); [quality-operations.md#selected-alternatives-and-decision-record](quality-operations.md#selected-alternatives-and-decision-record); [behavior-security-design.md#independent-fixture-and-oracle-methods](behavior-security-design.md#independent-fixture-and-oracle-methods); [relational-design.md#selected-model-and-storage](relational-design.md#selected-model-and-storage) |
| R025 | storage_responsibilities: RD08, RD09, RD15; transitions: BS-T04, BS-T05; security_oracles: BS-O08 | [relational-design.json](relational-design.json); [behavior-security-design.md#transition-contracts](behavior-security-design.md#transition-contracts); [behavior-security-design.md#independent-fixture-and-oracle-methods](behavior-security-design.md#independent-fixture-and-oracle-methods); [relational-design.md#selected-model-and-storage](relational-design.md#selected-model-and-storage) |
| R026 | storage_responsibilities: RD08, RD09, RD15; transitions: BS-T04, BS-T05, BS-T12; security_oracles: BS-O08 | [relational-design.json](relational-design.json); [behavior-security-design.md#transition-contracts](behavior-security-design.md#transition-contracts); [behavior-security-design.md#independent-fixture-and-oracle-methods](behavior-security-design.md#independent-fixture-and-oracle-methods); [relational-design.md#selected-model-and-storage](relational-design.md#selected-model-and-storage) |
| R027 | storage_responsibilities: RD04, RD08, RD09, RD13, RD15; transitions: BS-T03, BS-T04, BS-T08; controls: BS-C10; quality_scenarios: QA08; security_oracles: BS-O04 | [relational-design.json](relational-design.json); [behavior-security-design.md#transition-contracts](behavior-security-design.md#transition-contracts); [behavior-security-design.md#threat-control-and-verification-allocation](behavior-security-design.md#threat-control-and-verification-allocation); [quality-operations.md#refined-scenarios-and-analysis](quality-operations.md#refined-scenarios-and-analysis); [behavior-security-design.md#independent-fixture-and-oracle-methods](behavior-security-design.md#independent-fixture-and-oracle-methods); [relational-design.md#selected-model-and-storage](relational-design.md#selected-model-and-storage) |
| R028 | storage_responsibilities: RD08, RD09, RD15; transitions: BS-T04; quality_scenarios: QA10; architecture_decisions: AD06; security_oracles: BS-O10 | [relational-design.json](relational-design.json); [behavior-security-design.md#transition-contracts](behavior-security-design.md#transition-contracts); [quality-operations.md#refined-scenarios-and-analysis](quality-operations.md#refined-scenarios-and-analysis); [quality-operations.md#selected-alternatives-and-decision-record](quality-operations.md#selected-alternatives-and-decision-record); [behavior-security-design.md#independent-fixture-and-oracle-methods](behavior-security-design.md#independent-fixture-and-oracle-methods); [relational-design.md#selected-model-and-storage](relational-design.md#selected-model-and-storage) |
| R029 | storage_responsibilities: RD08, RD09, RD11, RD15, RD17; transitions: BS-T04; controls: BS-C10; quality_scenarios: QA10; security_oracles: BS-O10 | [relational-design.json](relational-design.json); [behavior-security-design.md#transition-contracts](behavior-security-design.md#transition-contracts); [behavior-security-design.md#threat-control-and-verification-allocation](behavior-security-design.md#threat-control-and-verification-allocation); [quality-operations.md#refined-scenarios-and-analysis](quality-operations.md#refined-scenarios-and-analysis); [behavior-security-design.md#independent-fixture-and-oracle-methods](behavior-security-design.md#independent-fixture-and-oracle-methods); [relational-design.md#selected-model-and-storage](relational-design.md#selected-model-and-storage) |
| R030 | storage_responsibilities: RD07, RD10, RD17; transitions: BS-T05, BS-T12; controls: BS-C08; quality_scenarios: QA07; security_oracles: BS-O08 | [relational-design.json](relational-design.json); [behavior-security-design.md#transition-contracts](behavior-security-design.md#transition-contracts); [behavior-security-design.md#threat-control-and-verification-allocation](behavior-security-design.md#threat-control-and-verification-allocation); [quality-operations.md#refined-scenarios-and-analysis](quality-operations.md#refined-scenarios-and-analysis); [behavior-security-design.md#independent-fixture-and-oracle-methods](behavior-security-design.md#independent-fixture-and-oracle-methods); [relational-design.md#selected-model-and-storage](relational-design.md#selected-model-and-storage) |
| R031 | storage_responsibilities: RD10; transitions: BS-T05, BS-T06, BS-T12; controls: BS-C04, BS-C08; quality_scenarios: QA07; security_oracles: BS-O08 | [relational-design.json](relational-design.json); [behavior-security-design.md#transition-contracts](behavior-security-design.md#transition-contracts); [behavior-security-design.md#threat-control-and-verification-allocation](behavior-security-design.md#threat-control-and-verification-allocation); [quality-operations.md#refined-scenarios-and-analysis](quality-operations.md#refined-scenarios-and-analysis); [behavior-security-design.md#independent-fixture-and-oracle-methods](behavior-security-design.md#independent-fixture-and-oracle-methods); [relational-design.md#selected-model-and-storage](relational-design.md#selected-model-and-storage) |
| R032 | storage_responsibilities: RD10; transitions: BS-T05; security_oracles: BS-O08 | [relational-design.json](relational-design.json); [behavior-security-design.md#transition-contracts](behavior-security-design.md#transition-contracts); [behavior-security-design.md#independent-fixture-and-oracle-methods](behavior-security-design.md#independent-fixture-and-oracle-methods); [relational-design.md#selected-model-and-storage](relational-design.md#selected-model-and-storage) |
| R033 | storage_responsibilities: RD11, RD13; transitions: BS-T04; quality_scenarios: QA06; architecture_decisions: AD05 | [relational-design.json](relational-design.json); [behavior-security-design.md#transition-contracts](behavior-security-design.md#transition-contracts); [quality-operations.md#refined-scenarios-and-analysis](quality-operations.md#refined-scenarios-and-analysis); [quality-operations.md#selected-alternatives-and-decision-record](quality-operations.md#selected-alternatives-and-decision-record); [relational-design.md#selected-model-and-storage](relational-design.md#selected-model-and-storage) |
| R034 | storage_responsibilities: RD11, RD13; transitions: BS-T04, BS-T16; controls: BS-C04; security_oracles: BS-O01 | [relational-design.json](relational-design.json); [behavior-security-design.md#transition-contracts](behavior-security-design.md#transition-contracts); [behavior-security-design.md#threat-control-and-verification-allocation](behavior-security-design.md#threat-control-and-verification-allocation); [behavior-security-design.md#independent-fixture-and-oracle-methods](behavior-security-design.md#independent-fixture-and-oracle-methods); [relational-design.md#selected-model-and-storage](relational-design.md#selected-model-and-storage) |
| R035 | storage_responsibilities: RD11, RD13; transitions: BS-T04, BS-T08, BS-T11; controls: BS-C10; quality_scenarios: QA08; security_oracles: BS-O04 | [relational-design.json](relational-design.json); [behavior-security-design.md#transition-contracts](behavior-security-design.md#transition-contracts); [behavior-security-design.md#threat-control-and-verification-allocation](behavior-security-design.md#threat-control-and-verification-allocation); [quality-operations.md#refined-scenarios-and-analysis](quality-operations.md#refined-scenarios-and-analysis); [behavior-security-design.md#independent-fixture-and-oracle-methods](behavior-security-design.md#independent-fixture-and-oracle-methods); [relational-design.md#selected-model-and-storage](relational-design.md#selected-model-and-storage) |
| R036 | storage_responsibilities: RD11, RD13; transitions: BS-T04, BS-T08, BS-T11; controls: BS-C10; quality_scenarios: QA08; security_oracles: BS-O04 | [relational-design.json](relational-design.json); [behavior-security-design.md#transition-contracts](behavior-security-design.md#transition-contracts); [behavior-security-design.md#threat-control-and-verification-allocation](behavior-security-design.md#threat-control-and-verification-allocation); [quality-operations.md#refined-scenarios-and-analysis](quality-operations.md#refined-scenarios-and-analysis); [behavior-security-design.md#independent-fixture-and-oracle-methods](behavior-security-design.md#independent-fixture-and-oracle-methods); [relational-design.md#selected-model-and-storage](relational-design.md#selected-model-and-storage) |
| R037 | storage_responsibilities: RD11, RD13; transitions: BS-T04 | [relational-design.json](relational-design.json); [behavior-security-design.md#transition-contracts](behavior-security-design.md#transition-contracts); [relational-design.md#selected-model-and-storage](relational-design.md#selected-model-and-storage) |
| R038 | storage_responsibilities: RD11, RD13; transitions: BS-T04; controls: BS-C10; quality_scenarios: QA08; security_oracles: BS-O04 | [relational-design.json](relational-design.json); [behavior-security-design.md#transition-contracts](behavior-security-design.md#transition-contracts); [behavior-security-design.md#threat-control-and-verification-allocation](behavior-security-design.md#threat-control-and-verification-allocation); [quality-operations.md#refined-scenarios-and-analysis](quality-operations.md#refined-scenarios-and-analysis); [behavior-security-design.md#independent-fixture-and-oracle-methods](behavior-security-design.md#independent-fixture-and-oracle-methods); [relational-design.md#selected-model-and-storage](relational-design.md#selected-model-and-storage) |
| R039 | storage_responsibilities: RD11, RD13; transitions: BS-T04 | [relational-design.json](relational-design.json); [behavior-security-design.md#transition-contracts](behavior-security-design.md#transition-contracts); [relational-design.md#selected-model-and-storage](relational-design.md#selected-model-and-storage) |
| R040 | storage_responsibilities: RD11, RD13; transitions: BS-T04; controls: BS-C10; quality_scenarios: QA10; security_oracles: BS-O10 | [relational-design.json](relational-design.json); [behavior-security-design.md#transition-contracts](behavior-security-design.md#transition-contracts); [behavior-security-design.md#threat-control-and-verification-allocation](behavior-security-design.md#threat-control-and-verification-allocation); [quality-operations.md#refined-scenarios-and-analysis](quality-operations.md#refined-scenarios-and-analysis); [behavior-security-design.md#independent-fixture-and-oracle-methods](behavior-security-design.md#independent-fixture-and-oracle-methods); [relational-design.md#selected-model-and-storage](relational-design.md#selected-model-and-storage) |
| R041 | storage_responsibilities: RD11, RD13; transitions: BS-T04 | [relational-design.json](relational-design.json); [behavior-security-design.md#transition-contracts](behavior-security-design.md#transition-contracts); [relational-design.md#selected-model-and-storage](relational-design.md#selected-model-and-storage) |
| R042 | storage_responsibilities: RD11, RD13; transitions: BS-T04, BS-T08, BS-T11; controls: BS-C10; quality_scenarios: QA08; security_oracles: BS-O04 | [relational-design.json](relational-design.json); [behavior-security-design.md#transition-contracts](behavior-security-design.md#transition-contracts); [behavior-security-design.md#threat-control-and-verification-allocation](behavior-security-design.md#threat-control-and-verification-allocation); [quality-operations.md#refined-scenarios-and-analysis](quality-operations.md#refined-scenarios-and-analysis); [behavior-security-design.md#independent-fixture-and-oracle-methods](behavior-security-design.md#independent-fixture-and-oracle-methods); [relational-design.md#selected-model-and-storage](relational-design.md#selected-model-and-storage) |
| R043 | storage_responsibilities: RD12; transitions: BS-T12, BS-T13, BS-T14; controls: BS-C08; quality_scenarios: QA06; security_oracles: BS-O12 | [relational-design.json](relational-design.json); [behavior-security-design.md#transition-contracts](behavior-security-design.md#transition-contracts); [behavior-security-design.md#threat-control-and-verification-allocation](behavior-security-design.md#threat-control-and-verification-allocation); [quality-operations.md#refined-scenarios-and-analysis](quality-operations.md#refined-scenarios-and-analysis); [behavior-security-design.md#independent-fixture-and-oracle-methods](behavior-security-design.md#independent-fixture-and-oracle-methods); [relational-design.md#selected-model-and-storage](relational-design.md#selected-model-and-storage) |
| R044 | storage_responsibilities: RD12; transitions: BS-T12, BS-T13; controls: BS-C08; security_oracles: BS-O12 | [relational-design.json](relational-design.json); [behavior-security-design.md#transition-contracts](behavior-security-design.md#transition-contracts); [behavior-security-design.md#threat-control-and-verification-allocation](behavior-security-design.md#threat-control-and-verification-allocation); [behavior-security-design.md#independent-fixture-and-oracle-methods](behavior-security-design.md#independent-fixture-and-oracle-methods); [relational-design.md#selected-model-and-storage](relational-design.md#selected-model-and-storage) |
| R045 | storage_responsibilities: RD10; transitions: BS-T12; controls: BS-C08; quality_scenarios: QA07; security_oracles: BS-O08, BS-O12 | [relational-design.json](relational-design.json); [behavior-security-design.md#transition-contracts](behavior-security-design.md#transition-contracts); [behavior-security-design.md#threat-control-and-verification-allocation](behavior-security-design.md#threat-control-and-verification-allocation); [quality-operations.md#refined-scenarios-and-analysis](quality-operations.md#refined-scenarios-and-analysis); [behavior-security-design.md#independent-fixture-and-oracle-methods](behavior-security-design.md#independent-fixture-and-oracle-methods); [relational-design.md#selected-model-and-storage](relational-design.md#selected-model-and-storage) |
| R046 | storage_responsibilities: RD10; transitions: BS-T12, BS-T16; controls: BS-C08; quality_scenarios: QA07; security_oracles: BS-O08, BS-O12 | [relational-design.json](relational-design.json); [behavior-security-design.md#transition-contracts](behavior-security-design.md#transition-contracts); [behavior-security-design.md#threat-control-and-verification-allocation](behavior-security-design.md#threat-control-and-verification-allocation); [quality-operations.md#refined-scenarios-and-analysis](quality-operations.md#refined-scenarios-and-analysis); [behavior-security-design.md#independent-fixture-and-oracle-methods](behavior-security-design.md#independent-fixture-and-oracle-methods); [relational-design.md#selected-model-and-storage](relational-design.md#selected-model-and-storage) |
| R047 | storage_responsibilities: RD01, RD02, RD05, RD09, RD10, RD14, RD17; transitions: BS-T12; controls: BS-C08; quality_scenarios: QA07; security_oracles: BS-O08 | [relational-design.json](relational-design.json); [behavior-security-design.md#transition-contracts](behavior-security-design.md#transition-contracts); [behavior-security-design.md#threat-control-and-verification-allocation](behavior-security-design.md#threat-control-and-verification-allocation); [quality-operations.md#refined-scenarios-and-analysis](quality-operations.md#refined-scenarios-and-analysis); [behavior-security-design.md#independent-fixture-and-oracle-methods](behavior-security-design.md#independent-fixture-and-oracle-methods); [relational-design.md#selected-model-and-storage](relational-design.md#selected-model-and-storage) |
| R048 | storage_responsibilities: RD10, RD12; transitions: BS-T12, BS-T13; controls: BS-C08; quality_scenarios: QA07; security_oracles: BS-O12 | [relational-design.json](relational-design.json); [behavior-security-design.md#transition-contracts](behavior-security-design.md#transition-contracts); [behavior-security-design.md#threat-control-and-verification-allocation](behavior-security-design.md#threat-control-and-verification-allocation); [quality-operations.md#refined-scenarios-and-analysis](quality-operations.md#refined-scenarios-and-analysis); [behavior-security-design.md#independent-fixture-and-oracle-methods](behavior-security-design.md#independent-fixture-and-oracle-methods); [relational-design.md#selected-model-and-storage](relational-design.md#selected-model-and-storage) |
| R049 | storage_responsibilities: RD01, RD02, RD05, RD09, RD10, RD11, RD12, RD13, RD14, RD17; transitions: BS-T08, BS-T09, BS-T12, BS-T13, BS-T14; quality_scenarios: QA06; architecture_decisions: AD05 | [relational-design.json](relational-design.json); [behavior-security-design.md#transition-contracts](behavior-security-design.md#transition-contracts); [quality-operations.md#refined-scenarios-and-analysis](quality-operations.md#refined-scenarios-and-analysis); [quality-operations.md#selected-alternatives-and-decision-record](quality-operations.md#selected-alternatives-and-decision-record); [relational-design.md#selected-model-and-storage](relational-design.md#selected-model-and-storage) |
| R050 | storage_responsibilities: RD04, RD09, RD13; transitions: BS-T01, BS-T04, BS-T06, BS-T11, BS-T16; controls: BS-C04; security_oracles: BS-O01 | [relational-design.json](relational-design.json); [behavior-security-design.md#transition-contracts](behavior-security-design.md#transition-contracts); [behavior-security-design.md#threat-control-and-verification-allocation](behavior-security-design.md#threat-control-and-verification-allocation); [behavior-security-design.md#independent-fixture-and-oracle-methods](behavior-security-design.md#independent-fixture-and-oracle-methods); [relational-design.md#selected-model-and-storage](relational-design.md#selected-model-and-storage) |
| R051 | storage_responsibilities: RD04, RD09, RD13; transitions: BS-T04, BS-T06, BS-T11, BS-T15; controls: BS-C07; quality_scenarios: QA01; architecture_decisions: AD02; security_oracles: BS-O11 | [relational-design.json](relational-design.json); [behavior-security-design.md#transition-contracts](behavior-security-design.md#transition-contracts); [behavior-security-design.md#threat-control-and-verification-allocation](behavior-security-design.md#threat-control-and-verification-allocation); [quality-operations.md#refined-scenarios-and-analysis](quality-operations.md#refined-scenarios-and-analysis); [quality-operations.md#selected-alternatives-and-decision-record](quality-operations.md#selected-alternatives-and-decision-record); [behavior-security-design.md#independent-fixture-and-oracle-methods](behavior-security-design.md#independent-fixture-and-oracle-methods); [relational-design.md#selected-model-and-storage](relational-design.md#selected-model-and-storage) |
| R052 | storage_responsibilities: RD04, RD09, RD13; transitions: BS-T01, BS-T03, BS-T04, BS-T11, BS-T15, BS-T18 | [relational-design.json](relational-design.json); [behavior-security-design.md#transition-contracts](behavior-security-design.md#transition-contracts); [relational-design.md#selected-model-and-storage](relational-design.md#selected-model-and-storage) |
| R053 | storage_responsibilities: RD04, RD09, RD13; transitions: BS-T01, BS-T04, BS-T11, BS-T18; controls: BS-C09; quality_scenarios: QA05, QA08; security_oracles: BS-O13 | [relational-design.json](relational-design.json); [behavior-security-design.md#transition-contracts](behavior-security-design.md#transition-contracts); [behavior-security-design.md#threat-control-and-verification-allocation](behavior-security-design.md#threat-control-and-verification-allocation); [quality-operations.md#refined-scenarios-and-analysis](quality-operations.md#refined-scenarios-and-analysis); [behavior-security-design.md#independent-fixture-and-oracle-methods](behavior-security-design.md#independent-fixture-and-oracle-methods); [relational-design.md#selected-model-and-storage](relational-design.md#selected-model-and-storage) |
| R054 | storage_responsibilities: RD01, RD02, RD04, RD05, RD09, RD10, RD13, RD14, RD17; transitions: BS-T04, BS-T08, BS-T11, BS-T15; controls: BS-C07, BS-C11; quality_scenarios: QA03; architecture_decisions: AD03; security_oracles: BS-O06 | [relational-design.json](relational-design.json); [behavior-security-design.md#transition-contracts](behavior-security-design.md#transition-contracts); [behavior-security-design.md#threat-control-and-verification-allocation](behavior-security-design.md#threat-control-and-verification-allocation); [quality-operations.md#refined-scenarios-and-analysis](quality-operations.md#refined-scenarios-and-analysis); [quality-operations.md#selected-alternatives-and-decision-record](quality-operations.md#selected-alternatives-and-decision-record); [behavior-security-design.md#independent-fixture-and-oracle-methods](behavior-security-design.md#independent-fixture-and-oracle-methods); [relational-design.md#selected-model-and-storage](relational-design.md#selected-model-and-storage) |
| R055 | storage_responsibilities: RD04, RD09, RD13; transitions: BS-T03, BS-T04, BS-T11; quality_scenarios: QA08; security_oracles: BS-O04 | [relational-design.json](relational-design.json); [behavior-security-design.md#transition-contracts](behavior-security-design.md#transition-contracts); [quality-operations.md#refined-scenarios-and-analysis](quality-operations.md#refined-scenarios-and-analysis); [behavior-security-design.md#independent-fixture-and-oracle-methods](behavior-security-design.md#independent-fixture-and-oracle-methods); [relational-design.md#selected-model-and-storage](relational-design.md#selected-model-and-storage) |
| R056 | storage_responsibilities: RD04, RD09, RD13; transitions: BS-T04, BS-T11, BS-T15, BS-T16, BS-T18; controls: BS-C07, BS-C09; quality_scenarios: QA05; architecture_decisions: AD03; security_oracles: BS-O11, BS-O13 | [relational-design.json](relational-design.json); [behavior-security-design.md#transition-contracts](behavior-security-design.md#transition-contracts); [behavior-security-design.md#threat-control-and-verification-allocation](behavior-security-design.md#threat-control-and-verification-allocation); [quality-operations.md#refined-scenarios-and-analysis](quality-operations.md#refined-scenarios-and-analysis); [quality-operations.md#selected-alternatives-and-decision-record](quality-operations.md#selected-alternatives-and-decision-record); [behavior-security-design.md#independent-fixture-and-oracle-methods](behavior-security-design.md#independent-fixture-and-oracle-methods); [relational-design.md#selected-model-and-storage](relational-design.md#selected-model-and-storage) |
| R057 | storage_responsibilities: RD04, RD09, RD13; transitions: BS-T04, BS-T11; security_oracles: BS-O13 | [relational-design.json](relational-design.json); [behavior-security-design.md#transition-contracts](behavior-security-design.md#transition-contracts); [behavior-security-design.md#independent-fixture-and-oracle-methods](behavior-security-design.md#independent-fixture-and-oracle-methods); [relational-design.md#selected-model-and-storage](relational-design.md#selected-model-and-storage) |
| R058 | storage_responsibilities: RD04, RD09, RD13, RD16; transitions: BS-T03, BS-T10; controls: BS-C03; quality_scenarios: QA06, QA11; architecture_decisions: AD05; security_oracles: BS-O09 | [relational-design.json](relational-design.json); [behavior-security-design.md#transition-contracts](behavior-security-design.md#transition-contracts); [behavior-security-design.md#threat-control-and-verification-allocation](behavior-security-design.md#threat-control-and-verification-allocation); [quality-operations.md#refined-scenarios-and-analysis](quality-operations.md#refined-scenarios-and-analysis); [quality-operations.md#selected-alternatives-and-decision-record](quality-operations.md#selected-alternatives-and-decision-record); [behavior-security-design.md#independent-fixture-and-oracle-methods](behavior-security-design.md#independent-fixture-and-oracle-methods); [relational-design.md#selected-model-and-storage](relational-design.md#selected-model-and-storage) |
| R059 | storage_responsibilities: RD13, RD14; transitions: BS-T06, BS-T15; controls: BS-C07; quality_scenarios: QA01; architecture_decisions: AD02; security_oracles: BS-O11 | [relational-design.json](relational-design.json); [behavior-security-design.md#transition-contracts](behavior-security-design.md#transition-contracts); [behavior-security-design.md#threat-control-and-verification-allocation](behavior-security-design.md#threat-control-and-verification-allocation); [quality-operations.md#refined-scenarios-and-analysis](quality-operations.md#refined-scenarios-and-analysis); [quality-operations.md#selected-alternatives-and-decision-record](quality-operations.md#selected-alternatives-and-decision-record); [behavior-security-design.md#independent-fixture-and-oracle-methods](behavior-security-design.md#independent-fixture-and-oracle-methods); [relational-design.md#selected-model-and-storage](relational-design.md#selected-model-and-storage) |
| R060 | storage_responsibilities: RD13, RD14, RD16; transitions: BS-T15, BS-T18; controls: BS-C07, BS-C09; quality_scenarios: QA05; operating_tests: OE-T03; security_oracles: BS-O13 | [relational-design.json](relational-design.json); [behavior-security-design.md#transition-contracts](behavior-security-design.md#transition-contracts); [behavior-security-design.md#threat-control-and-verification-allocation](behavior-security-design.md#threat-control-and-verification-allocation); [quality-operations.md#refined-scenarios-and-analysis](quality-operations.md#refined-scenarios-and-analysis); [quality-operations.md#operating-evidence-contract](quality-operations.md#operating-evidence-contract); [behavior-security-design.md#independent-fixture-and-oracle-methods](behavior-security-design.md#independent-fixture-and-oracle-methods); [relational-design.md#selected-model-and-storage](relational-design.md#selected-model-and-storage); [relational-design.md#selected-transaction-protocols](relational-design.md#selected-transaction-protocols) |
| R061 | storage_responsibilities: RD09, RD13, RD14, RD17; transitions: BS-T06, BS-T08, BS-T11, BS-T15; controls: BS-C06, BS-C07; quality_scenarios: QA01; architecture_decisions: AD02, AD03; security_oracles: BS-O11 | [relational-design.json](relational-design.json); [behavior-security-design.md#transition-contracts](behavior-security-design.md#transition-contracts); [behavior-security-design.md#threat-control-and-verification-allocation](behavior-security-design.md#threat-control-and-verification-allocation); [quality-operations.md#refined-scenarios-and-analysis](quality-operations.md#refined-scenarios-and-analysis); [quality-operations.md#selected-alternatives-and-decision-record](quality-operations.md#selected-alternatives-and-decision-record); [behavior-security-design.md#independent-fixture-and-oracle-methods](behavior-security-design.md#independent-fixture-and-oracle-methods); [relational-design.md#selected-model-and-storage](relational-design.md#selected-model-and-storage); [relational-design.md#selected-transaction-protocols](relational-design.md#selected-transaction-protocols) |
| R062 | storage_responsibilities: RD09, RD14, RD17; transitions: BS-T06, BS-T08, BS-T11, BS-T15, BS-T16; controls: BS-C06; quality_scenarios: QA01; architecture_decisions: AD02; security_oracles: BS-O05, BS-O11 | [relational-design.json](relational-design.json); [behavior-security-design.md#transition-contracts](behavior-security-design.md#transition-contracts); [behavior-security-design.md#threat-control-and-verification-allocation](behavior-security-design.md#threat-control-and-verification-allocation); [quality-operations.md#refined-scenarios-and-analysis](quality-operations.md#refined-scenarios-and-analysis); [quality-operations.md#selected-alternatives-and-decision-record](quality-operations.md#selected-alternatives-and-decision-record); [behavior-security-design.md#independent-fixture-and-oracle-methods](behavior-security-design.md#independent-fixture-and-oracle-methods); [relational-design.md#selected-model-and-storage](relational-design.md#selected-model-and-storage); [relational-design.md#selected-transaction-protocols](relational-design.md#selected-transaction-protocols) |
| R063 | storage_responsibilities: RD01, RD02, RD05, RD09, RD10, RD14, RD17; transitions: BS-T06, BS-T07, BS-T10, BS-T11; controls: BS-C11; quality_scenarios: QA03; operating_tests: OE-T04; security_oracles: BS-O06 | [relational-design.json](relational-design.json); [behavior-security-design.md#transition-contracts](behavior-security-design.md#transition-contracts); [behavior-security-design.md#threat-control-and-verification-allocation](behavior-security-design.md#threat-control-and-verification-allocation); [quality-operations.md#refined-scenarios-and-analysis](quality-operations.md#refined-scenarios-and-analysis); [quality-operations.md#operating-evidence-contract](quality-operations.md#operating-evidence-contract); [behavior-security-design.md#independent-fixture-and-oracle-methods](behavior-security-design.md#independent-fixture-and-oracle-methods); [relational-design.md#selected-model-and-storage](relational-design.md#selected-model-and-storage); [relational-design.md#selected-transaction-protocols](relational-design.md#selected-transaction-protocols) |
| R064 | storage_responsibilities: RD01, RD02, RD05, RD06, RD09, RD10, RD14, RD17; transitions: BS-T06, BS-T07, BS-T08; controls: BS-C11; quality_scenarios: QA03; architecture_decisions: AD03; security_oracles: BS-O06 | [relational-design.json](relational-design.json); [behavior-security-design.md#transition-contracts](behavior-security-design.md#transition-contracts); [behavior-security-design.md#threat-control-and-verification-allocation](behavior-security-design.md#threat-control-and-verification-allocation); [quality-operations.md#refined-scenarios-and-analysis](quality-operations.md#refined-scenarios-and-analysis); [quality-operations.md#selected-alternatives-and-decision-record](quality-operations.md#selected-alternatives-and-decision-record); [behavior-security-design.md#independent-fixture-and-oracle-methods](behavior-security-design.md#independent-fixture-and-oracle-methods); [relational-design.md#selected-model-and-storage](relational-design.md#selected-model-and-storage) |
| R065 | storage_responsibilities: RD01, RD02, RD05, RD09, RD10, RD14, RD17; transitions: BS-T06, BS-T07; controls: BS-C11; security_oracles: BS-O06 | [relational-design.json](relational-design.json); [behavior-security-design.md#transition-contracts](behavior-security-design.md#transition-contracts); [behavior-security-design.md#threat-control-and-verification-allocation](behavior-security-design.md#threat-control-and-verification-allocation); [behavior-security-design.md#independent-fixture-and-oracle-methods](behavior-security-design.md#independent-fixture-and-oracle-methods); [relational-design.md#selected-model-and-storage](relational-design.md#selected-model-and-storage) |
| R066 | storage_responsibilities: RD01, RD02, RD04, RD05, RD09, RD10, RD13, RD14, RD17; transitions: BS-T06, BS-T07, BS-T10; controls: BS-C11; quality_scenarios: QA03; operating_tests: OE-T04; security_oracles: BS-O06 | [relational-design.json](relational-design.json); [behavior-security-design.md#transition-contracts](behavior-security-design.md#transition-contracts); [behavior-security-design.md#threat-control-and-verification-allocation](behavior-security-design.md#threat-control-and-verification-allocation); [quality-operations.md#refined-scenarios-and-analysis](quality-operations.md#refined-scenarios-and-analysis); [quality-operations.md#operating-evidence-contract](quality-operations.md#operating-evidence-contract); [behavior-security-design.md#independent-fixture-and-oracle-methods](behavior-security-design.md#independent-fixture-and-oracle-methods); [relational-design.md#selected-model-and-storage](relational-design.md#selected-model-and-storage) |
| R067 | storage_responsibilities: RD01, RD02, RD05, RD06, RD09, RD10, RD14, RD16, RD17; transitions: BS-T10, BS-T11; controls: BS-C03, BS-C11; quality_scenarios: QA03; architecture_decisions: AD04; operating_tests: OE-T04; security_oracles: BS-O09 | [relational-design.json](relational-design.json); [behavior-security-design.md#transition-contracts](behavior-security-design.md#transition-contracts); [behavior-security-design.md#threat-control-and-verification-allocation](behavior-security-design.md#threat-control-and-verification-allocation); [quality-operations.md#refined-scenarios-and-analysis](quality-operations.md#refined-scenarios-and-analysis); [quality-operations.md#selected-alternatives-and-decision-record](quality-operations.md#selected-alternatives-and-decision-record); [quality-operations.md#operating-evidence-contract](quality-operations.md#operating-evidence-contract); [behavior-security-design.md#independent-fixture-and-oracle-methods](behavior-security-design.md#independent-fixture-and-oracle-methods); [relational-design.md#selected-model-and-storage](relational-design.md#selected-model-and-storage) |
| R068 | storage_responsibilities: RD01, RD02, RD05, RD09, RD10, RD14, RD17; transitions: BS-T04, BS-T05, BS-T06, BS-T08 | [relational-design.json](relational-design.json); [behavior-security-design.md#transition-contracts](behavior-security-design.md#transition-contracts); [relational-design.md#selected-model-and-storage](relational-design.md#selected-model-and-storage) |
| R069 | storage_responsibilities: RD01, RD02, RD05, RD07, RD09, RD10, RD14, RD17; transitions: BS-T04, BS-T05, BS-T06, BS-T08 | [relational-design.json](relational-design.json); [behavior-security-design.md#transition-contracts](behavior-security-design.md#transition-contracts); [relational-design.md#selected-model-and-storage](relational-design.md#selected-model-and-storage) |
| R070 | storage_responsibilities: RD14, RD17; transitions: BS-T06, BS-T15; controls: BS-C07 | [relational-design.json](relational-design.json); [behavior-security-design.md#transition-contracts](behavior-security-design.md#transition-contracts); [behavior-security-design.md#threat-control-and-verification-allocation](behavior-security-design.md#threat-control-and-verification-allocation); [relational-design.md#selected-model-and-storage](relational-design.md#selected-model-and-storage) |
| R071 | storage_responsibilities: RD01, RD02, RD05, RD09, RD10, RD14, RD17; transitions: BS-T06, BS-T09, BS-T16, BS-T17, BS-T18; controls: BS-C06; quality_scenarios: QA02; architecture_decisions: AD01; security_oracles: BS-O05 | [relational-design.json](relational-design.json); [behavior-security-design.md#transition-contracts](behavior-security-design.md#transition-contracts); [behavior-security-design.md#threat-control-and-verification-allocation](behavior-security-design.md#threat-control-and-verification-allocation); [quality-operations.md#refined-scenarios-and-analysis](quality-operations.md#refined-scenarios-and-analysis); [quality-operations.md#selected-alternatives-and-decision-record](quality-operations.md#selected-alternatives-and-decision-record); [behavior-security-design.md#independent-fixture-and-oracle-methods](behavior-security-design.md#independent-fixture-and-oracle-methods); [relational-design.md#selected-model-and-storage](relational-design.md#selected-model-and-storage); [relational-design.md#selected-transaction-protocols](relational-design.md#selected-transaction-protocols) |
| R072 | storage_responsibilities: RD01, RD02, RD05, RD09, RD10, RD14, RD17; transitions: BS-T06, BS-T09, BS-T16, BS-T17; controls: BS-C01, BS-C04; quality_scenarios: QA02; security_oracles: BS-O01, BS-O15 | [relational-design.json](relational-design.json); [behavior-security-design.md#transition-contracts](behavior-security-design.md#transition-contracts); [behavior-security-design.md#threat-control-and-verification-allocation](behavior-security-design.md#threat-control-and-verification-allocation); [quality-operations.md#refined-scenarios-and-analysis](quality-operations.md#refined-scenarios-and-analysis); [behavior-security-design.md#independent-fixture-and-oracle-methods](behavior-security-design.md#independent-fixture-and-oracle-methods); [relational-design.md#selected-model-and-storage](relational-design.md#selected-model-and-storage) |
| R073 | storage_responsibilities: RD01, RD02, RD05, RD09, RD10, RD14, RD17; transitions: BS-T06, BS-T07, BS-T08; controls: BS-C05; security_oracles: BS-O14 | [relational-design.json](relational-design.json); [behavior-security-design.md#transition-contracts](behavior-security-design.md#transition-contracts); [behavior-security-design.md#threat-control-and-verification-allocation](behavior-security-design.md#threat-control-and-verification-allocation); [behavior-security-design.md#independent-fixture-and-oracle-methods](behavior-security-design.md#independent-fixture-and-oracle-methods); [relational-design.md#selected-model-and-storage](relational-design.md#selected-model-and-storage) |
| R074 | storage_responsibilities: RD11, RD17; transitions: BS-T06; controls: BS-C05 | [relational-design.json](relational-design.json); [behavior-security-design.md#transition-contracts](behavior-security-design.md#transition-contracts); [behavior-security-design.md#threat-control-and-verification-allocation](behavior-security-design.md#threat-control-and-verification-allocation); [relational-design.md#selected-model-and-storage](relational-design.md#selected-model-and-storage) |
| R075 | storage_responsibilities: RD11, RD17; transitions: BS-T06; controls: BS-C05 | [relational-design.json](relational-design.json); [behavior-security-design.md#transition-contracts](behavior-security-design.md#transition-contracts); [behavior-security-design.md#threat-control-and-verification-allocation](behavior-security-design.md#threat-control-and-verification-allocation); [relational-design.md#selected-model-and-storage](relational-design.md#selected-model-and-storage) |
| R076 | storage_responsibilities: RD11, RD17; transitions: BS-T06, BS-T18; controls: BS-C05; quality_scenarios: QA12; operating_tests: OE-T02; security_oracles: BS-O05, BS-O14 | [relational-design.json](relational-design.json); [behavior-security-design.md#transition-contracts](behavior-security-design.md#transition-contracts); [behavior-security-design.md#threat-control-and-verification-allocation](behavior-security-design.md#threat-control-and-verification-allocation); [quality-operations.md#refined-scenarios-and-analysis](quality-operations.md#refined-scenarios-and-analysis); [quality-operations.md#operating-evidence-contract](quality-operations.md#operating-evidence-contract); [behavior-security-design.md#independent-fixture-and-oracle-methods](behavior-security-design.md#independent-fixture-and-oracle-methods); [relational-design.md#selected-model-and-storage](relational-design.md#selected-model-and-storage) |
| R077 | storage_responsibilities: RD11, RD17; transitions: BS-T06; quality_scenarios: QA10 | [relational-design.json](relational-design.json); [behavior-security-design.md#transition-contracts](behavior-security-design.md#transition-contracts); [quality-operations.md#refined-scenarios-and-analysis](quality-operations.md#refined-scenarios-and-analysis); [relational-design.md#selected-model-and-storage](relational-design.md#selected-model-and-storage) |
| R078 | storage_responsibilities: RD07, RD17; transitions: BS-T03, BS-T05; quality_scenarios: QA09; security_oracles: BS-O03 | [relational-design.json](relational-design.json); [behavior-security-design.md#transition-contracts](behavior-security-design.md#transition-contracts); [quality-operations.md#refined-scenarios-and-analysis](quality-operations.md#refined-scenarios-and-analysis); [behavior-security-design.md#independent-fixture-and-oracle-methods](behavior-security-design.md#independent-fixture-and-oracle-methods); [relational-design.md#selected-model-and-storage](relational-design.md#selected-model-and-storage) |
| R079 | storage_responsibilities: RD04, RD07, RD17; transitions: BS-T03, BS-T05; quality_scenarios: QA09; security_oracles: BS-O03 | [relational-design.json](relational-design.json); [behavior-security-design.md#transition-contracts](behavior-security-design.md#transition-contracts); [quality-operations.md#refined-scenarios-and-analysis](quality-operations.md#refined-scenarios-and-analysis); [behavior-security-design.md#independent-fixture-and-oracle-methods](behavior-security-design.md#independent-fixture-and-oracle-methods); [relational-design.md#selected-model-and-storage](relational-design.md#selected-model-and-storage) |
| R080 | storage_responsibilities: RD11, RD17; transitions: BS-T06, BS-T10; controls: BS-C05; architecture_decisions: AD04 | [relational-design.json](relational-design.json); [behavior-security-design.md#transition-contracts](behavior-security-design.md#transition-contracts); [behavior-security-design.md#threat-control-and-verification-allocation](behavior-security-design.md#threat-control-and-verification-allocation); [quality-operations.md#selected-alternatives-and-decision-record](quality-operations.md#selected-alternatives-and-decision-record); [relational-design.md#selected-model-and-storage](relational-design.md#selected-model-and-storage) |
| R081 | storage_responsibilities: RD03, RD04, RD08, RD09, RD11, RD13, RD15; transitions: BS-T01, BS-T04; controls: BS-C04; security_oracles: BS-O01 | [relational-design.json](relational-design.json); [behavior-security-design.md#transition-contracts](behavior-security-design.md#transition-contracts); [behavior-security-design.md#threat-control-and-verification-allocation](behavior-security-design.md#threat-control-and-verification-allocation); [behavior-security-design.md#independent-fixture-and-oracle-methods](behavior-security-design.md#independent-fixture-and-oracle-methods); [relational-design.md#selected-model-and-storage](relational-design.md#selected-model-and-storage) |
| R082 | storage_responsibilities: RD03, RD04, RD08, RD09, RD11, RD13, RD15; transitions: BS-T01, BS-T04 | [relational-design.json](relational-design.json); [behavior-security-design.md#transition-contracts](behavior-security-design.md#transition-contracts); [relational-design.md#selected-model-and-storage](relational-design.md#selected-model-and-storage) |
| R083 | quality_scenarios: QA11; architecture_decisions: AD06; review_gates: G6, G7 | [quality-operations.md#refined-scenarios-and-analysis](quality-operations.md#refined-scenarios-and-analysis); [quality-operations.md#selected-alternatives-and-decision-record](quality-operations.md#selected-alternatives-and-decision-record); [methodology-audit.md#required-closure-artifacts-and-exit-criteria](methodology-audit.md#required-closure-artifacts-and-exit-criteria) |
| R084 | review_gates: G6, G7 | [methodology-audit.md#required-closure-artifacts-and-exit-criteria](methodology-audit.md#required-closure-artifacts-and-exit-criteria) |
| R085 | quality_scenarios: QA10 | [quality-operations.md#refined-scenarios-and-analysis](quality-operations.md#refined-scenarios-and-analysis) |
| R086 | review_gates: G6, G7 | [methodology-audit.md#required-closure-artifacts-and-exit-criteria](methodology-audit.md#required-closure-artifacts-and-exit-criteria) |
| R087 | architecture_decisions: AD06; review_gates: G6, G7 | [quality-operations.md#selected-alternatives-and-decision-record](quality-operations.md#selected-alternatives-and-decision-record); [methodology-audit.md#required-closure-artifacts-and-exit-criteria](methodology-audit.md#required-closure-artifacts-and-exit-criteria) |
| R088 | transitions: BS-T10; quality_scenarios: QA11; review_gates: G6, G7 | [behavior-security-design.md#transition-contracts](behavior-security-design.md#transition-contracts); [quality-operations.md#refined-scenarios-and-analysis](quality-operations.md#refined-scenarios-and-analysis); [methodology-audit.md#required-closure-artifacts-and-exit-criteria](methodology-audit.md#required-closure-artifacts-and-exit-criteria) |
| R089 | review_gates: G6, G7 | [methodology-audit.md#required-closure-artifacts-and-exit-criteria](methodology-audit.md#required-closure-artifacts-and-exit-criteria) |
| R090 | review_gates: G1 | [methodology-audit.md#required-closure-artifacts-and-exit-criteria](methodology-audit.md#required-closure-artifacts-and-exit-criteria) |
| R091 | review_gates: G1, G7 | [methodology-audit.md#required-closure-artifacts-and-exit-criteria](methodology-audit.md#required-closure-artifacts-and-exit-criteria) |
| R092 | review_gates: G6 | [methodology-audit.md#required-closure-artifacts-and-exit-criteria](methodology-audit.md#required-closure-artifacts-and-exit-criteria) |
| R093 | review_gates: G1, G7 | [methodology-audit.md#required-closure-artifacts-and-exit-criteria](methodology-audit.md#required-closure-artifacts-and-exit-criteria) |
| R094 | review_gates: G1, G2, G3, G4, G5, G6, G7 | [methodology-audit.md#required-closure-artifacts-and-exit-criteria](methodology-audit.md#required-closure-artifacts-and-exit-criteria) |
| R095 | storage_responsibilities: RD02, RD17; transitions: BS-T02, BS-T06, BS-T17; controls: BS-C01, BS-C06, BS-C13; quality_scenarios: QA02; architecture_decisions: AD01; security_oracles: BS-O07 | [relational-design.json](relational-design.json); [behavior-security-design.md#transition-contracts](behavior-security-design.md#transition-contracts); [behavior-security-design.md#threat-control-and-verification-allocation](behavior-security-design.md#threat-control-and-verification-allocation); [quality-operations.md#refined-scenarios-and-analysis](quality-operations.md#refined-scenarios-and-analysis); [quality-operations.md#selected-alternatives-and-decision-record](quality-operations.md#selected-alternatives-and-decision-record); [behavior-security-design.md#independent-fixture-and-oracle-methods](behavior-security-design.md#independent-fixture-and-oracle-methods); [relational-design.md#selected-model-and-storage](relational-design.md#selected-model-and-storage); [relational-design.md#selected-transaction-protocols](relational-design.md#selected-transaction-protocols) |
| R096 | storage_responsibilities: RD01, RD02, RD05, RD09, RD10, RD14, RD17; transitions: BS-T06, BS-T17; controls: BS-C06, BS-C11; quality_scenarios: QA02; architecture_decisions: AD01; security_oracles: BS-O06, BS-O07 | [relational-design.json](relational-design.json); [behavior-security-design.md#transition-contracts](behavior-security-design.md#transition-contracts); [behavior-security-design.md#threat-control-and-verification-allocation](behavior-security-design.md#threat-control-and-verification-allocation); [quality-operations.md#refined-scenarios-and-analysis](quality-operations.md#refined-scenarios-and-analysis); [quality-operations.md#selected-alternatives-and-decision-record](quality-operations.md#selected-alternatives-and-decision-record); [behavior-security-design.md#independent-fixture-and-oracle-methods](behavior-security-design.md#independent-fixture-and-oracle-methods); [relational-design.md#selected-model-and-storage](relational-design.md#selected-model-and-storage); [relational-design.md#selected-transaction-protocols](relational-design.md#selected-transaction-protocols) |
| R097 | storage_responsibilities: RD01, RD02, RD04, RD05, RD09, RD10, RD13, RD14, RD17; transitions: BS-T06, BS-T08, BS-T09, BS-T11, BS-T12, BS-T13, BS-T15, BS-T16, BS-T17; controls: BS-C06, BS-C07, BS-C12, BS-C13; quality_scenarios: QA01, QA02; architecture_decisions: AD01, AD02, AD06; security_oracles: BS-O05, BS-O07, BS-O11 | [relational-design.json](relational-design.json); [behavior-security-design.md#transition-contracts](behavior-security-design.md#transition-contracts); [behavior-security-design.md#threat-control-and-verification-allocation](behavior-security-design.md#threat-control-and-verification-allocation); [quality-operations.md#refined-scenarios-and-analysis](quality-operations.md#refined-scenarios-and-analysis); [quality-operations.md#selected-alternatives-and-decision-record](quality-operations.md#selected-alternatives-and-decision-record); [behavior-security-design.md#independent-fixture-and-oracle-methods](behavior-security-design.md#independent-fixture-and-oracle-methods); [relational-design.md#selected-model-and-storage](relational-design.md#selected-model-and-storage); [relational-design.md#selected-transaction-protocols](relational-design.md#selected-transaction-protocols) |
| R098 | storage_responsibilities: RD01, RD02, RD05, RD09, RD10, RD14, RD17; transitions: BS-T06, BS-T10, BS-T18; controls: BS-C03, BS-C13; architecture_decisions: AD07; security_oracles: BS-O06, BS-O15 | [relational-design.json](relational-design.json); [behavior-security-design.md#transition-contracts](behavior-security-design.md#transition-contracts); [behavior-security-design.md#threat-control-and-verification-allocation](behavior-security-design.md#threat-control-and-verification-allocation); [quality-operations.md#selected-alternatives-and-decision-record](quality-operations.md#selected-alternatives-and-decision-record); [behavior-security-design.md#independent-fixture-and-oracle-methods](behavior-security-design.md#independent-fixture-and-oracle-methods); [relational-design.md#selected-model-and-storage](relational-design.md#selected-model-and-storage); [relational-design.md#selected-transaction-protocols](relational-design.md#selected-transaction-protocols) |
| R099 | transitions: BS-T06, BS-T10, BS-T18; controls: BS-C12; quality_scenarios: QA12; architecture_decisions: AD08; operating_tests: OE-T01; security_oracles: BS-O14 | [behavior-security-design.md#transition-contracts](behavior-security-design.md#transition-contracts); [behavior-security-design.md#threat-control-and-verification-allocation](behavior-security-design.md#threat-control-and-verification-allocation); [quality-operations.md#refined-scenarios-and-analysis](quality-operations.md#refined-scenarios-and-analysis); [quality-operations.md#selected-alternatives-and-decision-record](quality-operations.md#selected-alternatives-and-decision-record); [quality-operations.md#operating-evidence-contract](quality-operations.md#operating-evidence-contract); [behavior-security-design.md#independent-fixture-and-oracle-methods](behavior-security-design.md#independent-fixture-and-oracle-methods) |
| R100 | storage_responsibilities: RD11, RD17; transitions: BS-T06, BS-T18; controls: BS-C05, BS-C12; quality_scenarios: QA12; architecture_decisions: AD08; operating_tests: OE-T02; security_oracles: BS-O14 | [relational-design.json](relational-design.json); [behavior-security-design.md#transition-contracts](behavior-security-design.md#transition-contracts); [behavior-security-design.md#threat-control-and-verification-allocation](behavior-security-design.md#threat-control-and-verification-allocation); [quality-operations.md#refined-scenarios-and-analysis](quality-operations.md#refined-scenarios-and-analysis); [quality-operations.md#selected-alternatives-and-decision-record](quality-operations.md#selected-alternatives-and-decision-record); [quality-operations.md#operating-evidence-contract](quality-operations.md#operating-evidence-contract); [behavior-security-design.md#independent-fixture-and-oracle-methods](behavior-security-design.md#independent-fixture-and-oracle-methods); [relational-design.md#selected-model-and-storage](relational-design.md#selected-model-and-storage) |
| R101 | storage_responsibilities: RD04, RD07, RD16; transitions: BS-T03, BS-T10, BS-T18; controls: BS-C12; quality_scenarios: QA12; architecture_decisions: AD08; operating_tests: OE-T03, OE-T04; security_oracles: BS-O09 | [relational-design.json](relational-design.json); [behavior-security-design.md#transition-contracts](behavior-security-design.md#transition-contracts); [behavior-security-design.md#threat-control-and-verification-allocation](behavior-security-design.md#threat-control-and-verification-allocation); [quality-operations.md#refined-scenarios-and-analysis](quality-operations.md#refined-scenarios-and-analysis); [quality-operations.md#selected-alternatives-and-decision-record](quality-operations.md#selected-alternatives-and-decision-record); [quality-operations.md#operating-evidence-contract](quality-operations.md#operating-evidence-contract); [behavior-security-design.md#independent-fixture-and-oracle-methods](behavior-security-design.md#independent-fixture-and-oracle-methods); [relational-design.md#selected-model-and-storage](relational-design.md#selected-model-and-storage) |
| R102 | storage_responsibilities: RD01, RD02, RD05, RD09, RD10, RD14, RD17; transitions: BS-T06, BS-T10, BS-T18; controls: BS-C12; quality_scenarios: QA12; architecture_decisions: AD08; operating_tests: OE-T05; security_oracles: BS-O14 | [relational-design.json](relational-design.json); [behavior-security-design.md#transition-contracts](behavior-security-design.md#transition-contracts); [behavior-security-design.md#threat-control-and-verification-allocation](behavior-security-design.md#threat-control-and-verification-allocation); [quality-operations.md#refined-scenarios-and-analysis](quality-operations.md#refined-scenarios-and-analysis); [quality-operations.md#selected-alternatives-and-decision-record](quality-operations.md#selected-alternatives-and-decision-record); [quality-operations.md#operating-evidence-contract](quality-operations.md#operating-evidence-contract); [behavior-security-design.md#independent-fixture-and-oracle-methods](behavior-security-design.md#independent-fixture-and-oracle-methods); [relational-design.md#selected-model-and-storage](relational-design.md#selected-model-and-storage) |
| R103 | storage_responsibilities: RD05, RD13, RD14, RD16; transitions: BS-T02, BS-T09, BS-T11, BS-T12, BS-T13, BS-T14, BS-T15, BS-T16, BS-T18; controls: BS-C09, BS-C12; quality_scenarios: QA04, QA05, QA12; architecture_decisions: AD08; operating_tests: OE-T03, OE-T05; security_oracles: BS-O02, BS-O13 | [relational-design.json](relational-design.json); [behavior-security-design.md#transition-contracts](behavior-security-design.md#transition-contracts); [behavior-security-design.md#threat-control-and-verification-allocation](behavior-security-design.md#threat-control-and-verification-allocation); [quality-operations.md#refined-scenarios-and-analysis](quality-operations.md#refined-scenarios-and-analysis); [quality-operations.md#selected-alternatives-and-decision-record](quality-operations.md#selected-alternatives-and-decision-record); [quality-operations.md#operating-evidence-contract](quality-operations.md#operating-evidence-contract); [behavior-security-design.md#independent-fixture-and-oracle-methods](behavior-security-design.md#independent-fixture-and-oracle-methods); [relational-design.md#selected-model-and-storage](relational-design.md#selected-model-and-storage); [relational-design.md#selected-transaction-protocols](relational-design.md#selected-transaction-protocols) |
| R104 | controls: BS-C12; architecture_decisions: AD08; operating_tests: OE-T06; security_oracles: BS-O14; review_gates: G5, G7 | [behavior-security-design.md#threat-control-and-verification-allocation](behavior-security-design.md#threat-control-and-verification-allocation); [quality-operations.md#selected-alternatives-and-decision-record](quality-operations.md#selected-alternatives-and-decision-record); [quality-operations.md#operating-evidence-contract](quality-operations.md#operating-evidence-contract); [behavior-security-design.md#independent-fixture-and-oracle-methods](behavior-security-design.md#independent-fixture-and-oracle-methods); [methodology-audit.md#required-closure-artifacts-and-exit-criteria](methodology-audit.md#required-closure-artifacts-and-exit-criteria) |
| R105 | transitions: BS-T06, BS-T17; controls: BS-C01, BS-C13; security_oracles: BS-O07, BS-O15; review_gates: G4, G5, G6, G7 | [behavior-security-design.md#transition-contracts](behavior-security-design.md#transition-contracts); [behavior-security-design.md#threat-control-and-verification-allocation](behavior-security-design.md#threat-control-and-verification-allocation); [behavior-security-design.md#independent-fixture-and-oracle-methods](behavior-security-design.md#independent-fixture-and-oracle-methods); [methodology-audit.md#required-closure-artifacts-and-exit-criteria](methodology-audit.md#required-closure-artifacts-and-exit-criteria); [relational-design.md#selected-transaction-protocols](relational-design.md#selected-transaction-protocols) |
| R106 | storage_responsibilities: RD11, RD17; transitions: BS-T06; controls: BS-C05; security_oracles: BS-O05 | [relational-design.json](relational-design.json); [behavior-security-design.md#transition-contracts](behavior-security-design.md#transition-contracts); [behavior-security-design.md#threat-control-and-verification-allocation](behavior-security-design.md#threat-control-and-verification-allocation); [behavior-security-design.md#independent-fixture-and-oracle-methods](behavior-security-design.md#independent-fixture-and-oracle-methods); [relational-design.md#selected-model-and-storage](relational-design.md#selected-model-and-storage) |
| R107 | transitions: BS-T01, BS-T02, BS-T03, BS-T13, BS-T14; controls: BS-C03; security_oracles: BS-O09 | [behavior-security-design.md#transition-contracts](behavior-security-design.md#transition-contracts); [behavior-security-design.md#threat-control-and-verification-allocation](behavior-security-design.md#threat-control-and-verification-allocation); [behavior-security-design.md#independent-fixture-and-oracle-methods](behavior-security-design.md#independent-fixture-and-oracle-methods) |
| R108 | transitions: BS-T01; controls: BS-C04; security_oracles: BS-O01 | [behavior-security-design.md#transition-contracts](behavior-security-design.md#transition-contracts); [behavior-security-design.md#threat-control-and-verification-allocation](behavior-security-design.md#threat-control-and-verification-allocation); [behavior-security-design.md#independent-fixture-and-oracle-methods](behavior-security-design.md#independent-fixture-and-oracle-methods) |

### Reverse model allocation: storage responsibilities

| Model element | Requirement IDs |
| --- | --- |
| RD01 | R001, R002, R003, R047, R049, R054, R063, R064, R065, R066, R067, R068, R069, R071, R072, R073, R096, R097, R098, R102 |
| RD02 | R001, R003, R047, R049, R054, R063, R064, R065, R066, R067, R068, R069, R071, R072, R073, R095, R096, R097, R098, R102 |
| RD03 | R004, R005, R006, R081, R082 |
| RD04 | R004, R005, R006, R007, R008, R009, R018, R019, R020, R021, R027, R050, R051, R052, R053, R054, R055, R056, R057, R058, R066, R079, R081, R082, R097, R101 |
| RD05 | R001, R010, R011, R012, R013, R014, R015, R047, R049, R054, R063, R064, R065, R066, R067, R068, R069, R071, R072, R073, R096, R097, R098, R102, R103 |
| RD06 | R002, R016, R017, R064, R067 |
| RD07 | R018, R019, R020, R021, R030, R069, R078, R079, R101 |
| RD08 | R022, R023, R024, R025, R026, R027, R028, R029, R081, R082 |
| RD09 | R001, R007, R022, R023, R024, R025, R026, R027, R028, R029, R047, R049, R050, R051, R052, R053, R054, R055, R056, R057, R058, R061, R062, R063, R064, R065, R066, R067, R068, R069, R071, R072, R073, R081, R082, R096, R097, R098, R102 |
| RD10 | R001, R030, R031, R032, R045, R046, R047, R048, R049, R054, R063, R064, R065, R066, R067, R068, R069, R071, R072, R073, R096, R097, R098, R102 |
| RD11 | R029, R033, R034, R035, R036, R037, R038, R039, R040, R041, R042, R049, R074, R075, R076, R077, R080, R081, R082, R100, R106 |
| RD12 | R043, R044, R048, R049 |
| RD13 | R007, R027, R033, R034, R035, R036, R037, R038, R039, R040, R041, R042, R049, R050, R051, R052, R053, R054, R055, R056, R057, R058, R059, R060, R061, R066, R081, R082, R097, R103 |
| RD14 | R001, R047, R049, R054, R059, R060, R061, R062, R063, R064, R065, R066, R067, R068, R069, R070, R071, R072, R073, R096, R097, R098, R102, R103 |
| RD15 | R022, R023, R024, R025, R026, R027, R028, R029, R081, R082 |
| RD16 | R013, R058, R060, R067, R101, R103 |
| RD17 | R001, R003, R007, R008, R009, R029, R030, R047, R049, R054, R061, R062, R063, R064, R065, R066, R067, R068, R069, R070, R071, R072, R073, R074, R075, R076, R077, R078, R079, R080, R095, R096, R097, R098, R100, R102, R106 |

### Reverse model allocation: transitions

| Model element | Requirement IDs |
| --- | --- |
| BS-T01 | R001, R004, R005, R006, R007, R008, R009, R050, R052, R053, R081, R082, R107, R108 |
| BS-T02 | R001, R003, R010, R011, R012, R013, R014, R095, R103, R107 |
| BS-T03 | R016, R017, R018, R019, R020, R021, R027, R052, R055, R058, R078, R079, R101, R107 |
| BS-T04 | R005, R006, R022, R023, R024, R025, R026, R027, R028, R029, R033, R034, R035, R036, R037, R038, R039, R040, R041, R042, R050, R051, R052, R053, R054, R055, R056, R057, R068, R069, R081, R082 |
| BS-T05 | R023, R025, R026, R030, R031, R032, R068, R069, R078, R079 |
| BS-T06 | R001, R003, R016, R017, R024, R031, R050, R051, R059, R061, R062, R063, R064, R065, R066, R068, R069, R070, R071, R072, R073, R074, R075, R076, R077, R080, R095, R096, R097, R098, R099, R100, R102, R105, R106 |
| BS-T07 | R002, R063, R064, R065, R066, R073 |
| BS-T08 | R002, R027, R035, R036, R042, R049, R054, R061, R062, R064, R068, R069, R073, R097 |
| BS-T09 | R002, R015, R017, R049, R071, R072, R097, R103 |
| BS-T10 | R002, R016, R017, R020, R058, R063, R066, R067, R080, R088, R098, R099, R101, R102 |
| BS-T11 | R035, R036, R042, R050, R051, R052, R053, R054, R055, R056, R057, R061, R062, R063, R067, R097, R103 |
| BS-T12 | R022, R024, R026, R030, R031, R043, R044, R045, R046, R047, R048, R049, R097, R103 |
| BS-T13 | R043, R044, R048, R049, R097, R103, R107 |
| BS-T14 | R043, R049, R103, R107 |
| BS-T15 | R051, R052, R054, R056, R059, R060, R061, R062, R070, R097, R103 |
| BS-T16 | R017, R018, R024, R034, R046, R050, R056, R062, R071, R072, R097, R103 |
| BS-T17 | R001, R002, R003, R071, R072, R095, R096, R097, R105 |
| BS-T18 | R013, R020, R052, R053, R056, R060, R071, R076, R098, R099, R100, R101, R102, R103 |

### Reverse model allocation: controls

| Model element | Requirement IDs |
| --- | --- |
| BS-C01 | R001, R003, R072, R095, R105 |
| BS-C02 | R010, R011, R012, R013, R014 |
| BS-C03 | R018, R020, R058, R067, R098, R107 |
| BS-C04 | R016, R024, R031, R034, R050, R072, R081, R108 |
| BS-C05 | R073, R074, R075, R076, R080, R100, R106 |
| BS-C06 | R061, R062, R071, R095, R096, R097 |
| BS-C07 | R051, R054, R056, R059, R060, R061, R070, R097 |
| BS-C08 | R030, R031, R043, R044, R045, R046, R047, R048 |
| BS-C09 | R013, R018, R020, R053, R056, R060, R103 |
| BS-C10 | R005, R006, R010, R027, R029, R035, R036, R038, R040, R042 |
| BS-C11 | R002, R054, R063, R064, R065, R066, R067, R096 |
| BS-C12 | R097, R099, R100, R101, R102, R103, R104 |
| BS-C13 | R095, R097, R098, R105 |

### Reverse model allocation: quality scenarios

| Model element | Requirement IDs |
| --- | --- |
| QA01 | R051, R059, R061, R062, R097 |
| QA02 | R003, R017, R071, R072, R095, R096, R097 |
| QA03 | R002, R054, R063, R064, R066, R067 |
| QA04 | R010, R011, R012, R013, R014, R103 |
| QA05 | R020, R053, R056, R060, R103 |
| QA06 | R016, R033, R043, R049, R058 |
| QA07 | R030, R031, R045, R046, R047, R048 |
| QA08 | R027, R035, R036, R038, R042, R053, R055 |
| QA09 | R018, R019, R020, R021, R078, R079 |
| QA10 | R006, R028, R029, R040, R077, R085 |
| QA11 | R058, R083, R088 |
| QA12 | R076, R099, R100, R101, R102, R103 |

### Reverse model allocation: architecture decisions

| Model element | Requirement IDs |
| --- | --- |
| AD01 | R003, R071, R095, R096, R097 |
| AD02 | R051, R059, R061, R062, R097 |
| AD03 | R054, R056, R061, R064 |
| AD04 | R017, R067, R080 |
| AD05 | R016, R033, R049, R058 |
| AD06 | R022, R024, R028, R083, R087, R097 |
| AD07 | R098 |
| AD08 | R099, R100, R101, R102, R103, R104 |

### Reverse model allocation: operating tests

| Model element | Requirement IDs |
| --- | --- |
| OE-T01 | R099 |
| OE-T02 | R076, R100 |
| OE-T03 | R020, R060, R101, R103 |
| OE-T04 | R063, R066, R067, R101 |
| OE-T05 | R102, R103 |
| OE-T06 | R104 |

### Reverse model allocation: security oracles

| Model element | Requirement IDs |
| --- | --- |
| BS-O01 | R001, R004, R009, R034, R050, R072, R081, R108 |
| BS-O02 | R010, R011, R012, R013, R014, R103 |
| BS-O03 | R018, R019, R020, R021, R078, R079 |
| BS-O04 | R027, R035, R036, R038, R042, R055 |
| BS-O05 | R003, R015, R017, R062, R071, R076, R097, R106 |
| BS-O06 | R054, R063, R064, R065, R066, R096, R098 |
| BS-O07 | R003, R095, R096, R097, R105 |
| BS-O08 | R022, R024, R025, R026, R030, R031, R032, R045, R046, R047 |
| BS-O09 | R002, R017, R058, R067, R101, R107 |
| BS-O10 | R005, R006, R007, R008, R010, R028, R029, R040 |
| BS-O11 | R024, R051, R056, R059, R061, R062, R097 |
| BS-O12 | R043, R044, R045, R046, R048 |
| BS-O13 | R013, R020, R053, R056, R057, R060, R103 |
| BS-O14 | R073, R076, R099, R100, R102, R104 |
| BS-O15 | R072, R098, R105 |

### Reverse model allocation: review gates

| Model element | Requirement IDs |
| --- | --- |
| G1 | R090, R091, R093, R094 |
| G2 | R094 |
| G3 | R094 |
| G4 | R094, R105 |
| G5 | R094, R104, R105 |
| G6 | R083, R084, R086, R087, R088, R089, R092, R094, R105 |
| G7 | R083, R084, R086, R087, R088, R089, R091, R093, R094, R104, R105 |

Use independently stated expected outcomes. Before execution record fixture bytes/hash, implementation SHA, role/grant identity, controlled clock/barriers, method, receipts and deviations. SQL cases require every disposable-harness guard. Synthetic fixtures prove handling, not live provider completeness. Never use production/retained data or credentials.

## Verification specifications

### FS18.01 - R001

Parent: FS18. Method: test. Status: **specified, not executed**.

**Fixture:** FX0; authenticated A submits B or PA as actor identifier.

**Procedure:** Invoke identification/association/read with forged actor inputs under A's session.

**Independent oracle:** All actor-scoped work remains A or is rejected; no B preference, association or protected response is reachable.

**Required evidence:** Exact implementation SHA and sanitized fixture hash; Declared clock/barrier schedule and actual execution receipt; Independent expected-versus-actual committed state and response bytes, with failures/skips recorded.

### FS17.01 - R002

Parent: FS17. Method: test. Status: **specified, not executed**.

**Fixture:** FX0; A active; PA loses each provider condition separately.

**Procedure:** Apply provider outage, expiry, complete removal and disconnect; compare L1 account/session rows.

**Independent oracle:** Actor stays active with same login identities and usable L1 sign-in; only affected league access changes.

**Required evidence:** Exact implementation SHA and sanitized fixture hash; Declared clock/barrier schedule and actual execution receipt; Independent expected-versus-actual committed state and response bytes, with failures/skips recorded.

### FS08.01 - R003

Parent: FS08. Method: test. Status: **specified, not executed**.

**Fixture:** FX0/FX-race; compose with SA then separately revoke, expire, delete or replace SA or change actor revision.

**Procedure:** Pause before final delivery; commit one invalidating change; resume through actual auth owner with cookie cache/refresh disabled.

**Independent oracle:** No protected bytes are serialized for any changed/invalid session or actor; unchanged live SA permits the remaining access checks; no invented session revision is used.

**Required evidence:** Exact implementation SHA and sanitized fixture hash; Declared clock/barrier schedule and actual execution receipt; Independent expected-versus-actual committed state and response bytes, with failures/skips recorded.

### FS18.02 - R004

Parent: FS18. Method: test. Status: **specified, not executed**.

**Fixture:** FX-source; native account N renames u to v; another account M later takes u.

**Procedure:** Resolve all three lookups and compare persistent identities.

**Independent oracle:** N retains one ProviderAccount.id; M is distinct; display-name equality never merges them; only implemented sleeper is accepted.

**Required evidence:** Exact implementation SHA and sanitized fixture hash; Declared clock/barrier schedule and actual execution receipt; Independent expected-versus-actual committed state and response bytes, with failures/skips recorded.

### FS01.01 - R005

Parent: FS01. Method: test. Status: **specified, not executed**.

**Fixture:** FX-source; roster has primary owner N and co-manager M but only N has a lookup capture.

**Procedure:** Normalize accepted role IDs using shared identity resolver; deliberately substitute a receipt for another key or evidence kind.

**Independent oracle:** M resolves without a per-manager lookup; both refs prove their exact native keys; mismatched kinds/keys are rejected; neither proof asserts external account control.

**Required evidence:** Exact implementation SHA and sanitized fixture hash; Declared clock/barrier schedule and actual execution receipt; Independent expected-versus-actual committed state and response bytes, with failures/skips recorded.

### FS11.01 - R006

Parent: FS11. Method: test. Status: **specified, not executed**.

**Fixture:** FX-source; role-only identity and lookup variants omit, null or empty each display field.

**Procedure:** Resolve identity and render optional decorations using adapter validation.

**Independent oracle:** Identity remains available with absent/null/empty distinguished; no fabricated username/name/avatar; unsafe avatar URL is not emitted.

**Required evidence:** Exact implementation SHA and sanitized fixture hash; Declared clock/barrier schedule and actual execution receipt; Independent expected-versus-actual committed state and response bytes, with failures/skips recorded.

### FS18.03 - R007

Parent: FS18. Method: test. Status: **specified, not executed**.

**Fixture:** FX-source; valid /user response before any enrolled league exists.

**Procedure:** Perform read-only lookup twice under the same lookup request; inspect immutable capture scope and references.

**Independent oracle:** Same request identity is reused; capture exists with the actual lookup scope and no synthetic league/mapping; original source age remains unchanged.

**Required evidence:** Exact implementation SHA and sanitized fixture hash; Declared clock/barrier schedule and actual execution receipt; Independent expected-versus-actual committed state and response bytes, with failures/skips recorded.

### FS18.04 - R008

Parent: FS18. Method: test. Status: **specified, not executed**.

**Fixture:** FX0/FX-source; actor A with no associations, enrollment or follows.

**Procedure:** Run valid, invalid and unavailable lookup previews; compare all affected tables or writer calls.

**Independent oracle:** Zero activation/enrollment/follow writes; result is identification evidence only.

**Required evidence:** Exact implementation SHA and sanitized fixture hash; Declared clock/barrier schedule and actual execution receipt; Independent expected-versus-actual committed state and response bytes, with failures/skips recorded.

### FS13.01 - R009

Parent: FS13. Method: test. Status: **specified, not executed**.

**Fixture:** FX-source; successful lookup, transport failure without capture, invalid captured payload and wrong user key.

**Procedure:** Validate and serialize each result variant.

**Independent oracle:** identified has matching account and null reason; unavailable/invalid have null account and safe reason; evidence ref exists only if a capture exists; no competing L1 identity is exposed.

**Required evidence:** Exact implementation SHA and sanitized fixture hash; Declared clock/barrier schedule and actual execution receipt; Independent expected-versus-actual committed state and response bytes, with failures/skips recorded.

### FS18.05 - R010

Parent: FS18. Method: test. Status: **specified, not executed**.

**Fixture:** FX0; PA exists from role evidence; lookup captures prove PA, PB, failed PA and no lookup.

**Procedure:** Attempt activation with each receipt under A.

**Independent oracle:** Only the matching successful PA lookup can qualify activation; role-only, failed or PB lookup is rejected; valid activation retains its receipt without refreshing membership.

**Required evidence:** Exact implementation SHA and sanitized fixture hash; Declared clock/barrier schedule and actual execution receipt; Independent expected-versus-actual committed state and response bytes, with failures/skips recorded.

### FS02.01 - R011

Parent: FS02. Method: test. Status: **specified, not executed**.

**Fixture:** FX0/FX-race; A and B concurrently claim PA with valid subject lookup; exercise both choices of first lock holder.

**Procedure:** Using the actual guarded writer, let A acquire the provider-account identity UPDATE lock and finish its authoritative claim check, then start B and prove it waits before that check. Commit A, release B, and observe B recheck the committed claim. Repeat with B as first lock holder. Do not place both transactions at a post-check barrier that the selected identity lock makes unreachable.

**Independent oracle:** Exactly one active link survives; the waiting claimant sees the committed claim and receives private-safe conflict without rival identity; no silent winner replacement. The observed lock order and wait are part of the result, not a skipped barrier. The selected writer schedule does not itself prove the independent unique constraint rejects bypassing inserts.

**Required evidence:** Exact implementation SHA and sanitized fixture hash; Declared clock/barrier schedule and actual execution receipt; Independent expected-versus-actual committed state and response bytes, with failures/skips recorded.

### FS03.01 - R012

Parent: FS03. Method: test. Status: **specified, not executed**.

**Fixture:** FX0/FX-race; A concurrently claims PA and PB, both sleeper.

**Procedure:** Commit competing activations in both orders.

**Independent oracle:** At most one active sleeper association for A; provider value equals its referenced account; conflict never displaces the established link.

**Required evidence:** Exact implementation SHA and sanitized fixture hash; Declared clock/barrier schedule and actual execution receipt; Independent expected-versus-actual committed state and response bytes, with failures/skips recorded.

### FS03.02 - R013

Parent: FS03. Method: test. Status: **specified, not executed**.

**Fixture:** FX0; one activation succeeds but its response is lost.

**Procedure:** Retry the same activation through the writer after restart.

**Independent oracle:** The same Association.id is returned and no duplicate active or ended row is fabricated.

**Required evidence:** Exact implementation SHA and sanitized fixture hash; Declared clock/barrier schedule and actual execution receipt; Independent expected-versus-actual committed state and response bytes, with failures/skips recorded.

### FS13.02 - R014

Parent: FS13. Method: test. Status: **specified, not executed**.

**Fixture:** FX0; valid exclusive association established from public lookup.

**Procedure:** Inspect stored assurance and server/client representations.

**Independent oracle:** Assurance is user-asserted; no provider-control/private entitlement claim appears.

**Required evidence:** Exact implementation SHA and sanitized fixture hash; Declared clock/barrier schedule and actual execution receipt; Independent expected-versus-actual committed state and response bytes, with failures/skips recorded.

### FS08.02 - R015

Parent: FS08. Method: test. Status: **specified, not executed**.

**Fixture:** FX0/FX-race; active PA link with captured revision; provider outage separately.

**Procedure:** Disconnect through explicit L1 authority, then resume earlier read; run outage without disconnect as control.

**Independent oracle:** Disconnect sets ended state, actual endedAt and newer revision; earlier read fails; retained history survives; outage alone leaves link/end timestamp unchanged.

**Required evidence:** Exact implementation SHA and sanitized fixture hash; Declared clock/barrier schedule and actual execution receipt; Independent expected-versus-actual committed state and response bytes, with failures/skips recorded.

### FS16.01 - R016

Parent: FS16. Method: test. Status: **specified, not executed**.

**Fixture:** FX0; compatible public U and disjoint private V/W contexts.

**Procedure:** Request identical resource in each context and attempt cross-context evidence reuse.

**Independent oracle:** Public-compatible work can coalesce; V/W evidence never cross-serves without qualification; public context grants no private entitlement.

**Required evidence:** Exact implementation SHA and sanitized fixture hash; Declared clock/barrier schedule and actual execution receipt; Independent expected-versus-actual committed state and response bytes, with failures/skips recorded.

### FS08.03 - R017

Parent: FS08. Method: test. Status: **specified, not executed**.

**Fixture:** FX0/FX-race; valid private authority expires or revokes between reservation and acceptance.

**Procedure:** Commit revocation/expiry before pending work accepts or publishes; include unknown private expiry/authority case.

**Independent oracle:** Pending work cannot advance/publish under invalid context; missing private authority is never interpreted as unlimited; actor lifecycle is unchanged.

**Required evidence:** Exact implementation SHA and sanitized fixture hash; Declared clock/barrier schedule and actual execution receipt; Independent expected-versus-actual committed state and response bytes, with failures/skips recorded.

### FS09.01 - R018

Parent: FS09. Method: test. Status: **specified, not executed**.

**Fixture:** FX0/FX-race; scan for PA stops at checkpoint; association is ended or changed.

**Procedure:** Resume once without changes and once after changed association revision.

**Independent oracle:** Unchanged scan resumes its existing identity; changed association cannot continue or deliver under old authority.

**Required evidence:** Exact implementation SHA and sanitized fixture hash; Declared clock/barrier schedule and actual execution receipt; Independent expected-versus-actual committed state and response bytes, with failures/skips recorded.

### FS19.01 - R019

Parent: FS19. Method: test. Status: **specified, not executed**.

**Fixture:** FX-source; cold-start new-year league, nonrenewed older current league and existing retained selection.

**Procedure:** Inspect planned season set, then qualify strategy against unrelated supported source fixtures; omit one required scope adversarially.

**Independent oracle:** Declared set is explicit, sorted and unique; nonrenewed and new candidates are considered; missing/unqualified coverage cannot produce a claim of exhaustive current-team discovery.

**Required evidence:** Exact implementation SHA and sanitized fixture hash; Declared clock/barrier schedule and actual execution receipt; Independent expected-versus-actual committed state and response bytes, with failures/skips recorded.

### FS09.02 - R020

Parent: FS09. Method: test. Status: **specified, not executed**.

**Fixture:** FX-source; declared seasons [2025,2026], 2025 succeeds and 2026 fails after one candidate. Include a completed scan followed by an explicit refresh with the same association revision, strategy and season set.

**Procedure:** Restart at checkpoint, retry only unfinished scope and inspect receipts. After completing the first scan, start that later refresh; also retry while the original scan is still unfinished.

**Independent oracle:** completedSeasons remains a subset of required; finished work is retained, failed scope stays incomplete; continuation is not null merely because of failure; no duplicate candidate identities. At most one unfinished scan exists for the reserved tuple. Completion permits a new scan UUID with new source receipts; old receipt timestamps cannot be relabeled as fresh. An interrupted/retryable failure resumes the unfinished identity.

**Required evidence:** Exact implementation SHA and sanitized fixture hash; Declared clock/barrier schedule and actual execution receipt; Independent expected-versus-actual committed state and response bytes, with failures/skips recorded.

### FS04.01 - R021

Parent: FS04. Method: test. Status: **specified, not executed**.

**Fixture:** FX-source; unrelated league with renamed team listed for account but roles not yet qualified.

**Procedure:** Run ordinary discovery without hardcoded league configuration; inspect state and authorizations.

**Independent oracle:** Candidate is retained through existing owners; no enrollment/follow/access grant follows from list or team name alone.

**Required evidence:** Exact implementation SHA and sanitized fixture hash; Declared clock/barrier schedule and actual execution receipt; Independent expected-versus-actual committed state and response bytes, with failures/skips recorded.

### FS14.01 - R022

Parent: FS14. Method: test. Status: **specified, not executed**.

**Fixture:** FX0; L has annual aliases 2025-X and 2026-Y with proven continuity; separate league has same name.

**Procedure:** Apply verified renewal and resolve both aliases and existing links.

**Independent oracle:** One stable L/route remains; season IDs stay distinct and preserved; same-name league is not merged.

**Required evidence:** Exact implementation SHA and sanitized fixture hash; Declared clock/barrier schedule and actual execution receipt; Independent expected-versus-actual committed state and response bytes, with failures/skips recorded.

### FS13.03 - R023

Parent: FS13. Method: test. Status: **specified, not executed**.

**Fixture:** FX-source; NFL 2026, malformed year, different sport and ambiguous numeric conversion.

**Procedure:** Validate candidates and retain native evidence.

**Independent oracle:** Only supported NFL and valid exact year qualify this slice; invalid values are explicit unsupported/invalid, never inferred from global year.

**Required evidence:** Exact implementation SHA and sanitized fixture hash; Declared clock/barrier schedule and actual execution receipt; Independent expected-versus-actual committed state and response bytes, with failures/skips recorded.

### FS10.01 - R024

Parent: FS10. Method: test. Status: **specified, not executed**.

**Fixture:** FX0/FX-race; source mapping changes A to B to A before old work completes.

**Procedure:** Accept and read with current and old mapping receipts.

**Independent oracle:** Only exact current mapping/generation qualifies; return to same external A never validates stale revision.

**Required evidence:** Exact implementation SHA and sanitized fixture hash; Declared clock/barrier schedule and actual execution receipt; Independent expected-versus-actual committed state and response bytes, with failures/skips recorded.

### FS14.02 - R025

Parent: FS14. Method: test. Status: **specified, not executed**.

**Fixture:** FX-source; name missing and lifecycle changes to complete while membership remains qualified.

**Procedure:** Normalize fields and request selected current league.

**Independent oracle:** Unknown name uses only explicit identifier label; complete season remains selectable while eligible; no invented name/status/removal.

**Required evidence:** Exact implementation SHA and sanitized fixture hash; Declared clock/barrier schedule and actual execution receipt; Independent expected-versus-actual committed state and response bytes, with failures/skips recorded.

### FS14.03 - R026

Parent: FS14. Method: test. Status: **specified, not executed**.

**Fixture:** FX-source; later-year candidate points at predecessor but has missing successor role proof or conflicting lineage.

**Procedure:** Attempt current-selection advancement.

**Independent oracle:** Current selection stays unchanged; predecessor name/year/link alone is insufficient.

**Required evidence:** Exact implementation SHA and sanitized fixture hash; Declared clock/barrier schedule and actual execution receipt; Independent expected-versus-actual committed state and response bytes, with failures/skips recorded.

### FS12.01 - R027

Parent: FS12. Method: test. Status: **specified, not executed**.

**Fixture:** FX-source; league total_rosters=12 but only 11 roster rows; variant lacks total count.

**Procedure:** Evaluate roster and manager completeness against independent receipt.

**Independent oracle:** No complete population/exhaustive exclusion is asserted from 11 rows or missing count; prior accepted complete state is preserved.

**Required evidence:** Exact implementation SHA and sanitized fixture hash; Declared clock/barrier schedule and actual execution receipt; Independent expected-versus-actual committed state and response bytes, with failures/skips recorded.

### FS11.02 - R028

Parent: FS11. Method: test. Status: **specified, not executed**.

**Fixture:** FX-source; nondefault scoring, roster slots, competition and waiver settings with one unsupported analytical rule.

**Procedure:** Read accepted settings and compare exact retained groups/coverage to source.

**Independent oracle:** Native facts survive without fabricated defaults; unsupported analytical rule is reported independently.

**Required evidence:** Exact implementation SHA and sanitized fixture hash; Declared clock/barrier schedule and actual execution receipt; Independent expected-versus-actual committed state and response bytes, with failures/skips recorded.

### FS11.03 - R029

Parent: FS11. Method: test. Status: **specified, not executed**.

**Fixture:** FX0/FX-source; valid identity/population/role/roster; absent users head/catalog/projections and null analytics assessment.

**Procedure:** Admit/read official-only league through target writer; later attach qualified analytics applicability.

**Independent oracle:** Official held/team facts remain available; analytics is explicit unavailable until qualified; original frozen/profile lineage is unchanged.

**Required evidence:** Exact implementation SHA and sanitized fixture hash; Declared clock/barrier schedule and actual execution receipt; Independent expected-versus-actual committed state and response bytes, with failures/skips recorded.

### FS14.04 - R030

Parent: FS14. Method: test. Status: **specified, not executed**.

**Fixture:** FX0; A has eligible L-2025 and L2-2026; 2026 candidate for L is unqualified.

**Procedure:** Read portfolio selections and then finish L-2025 season without renewal.

**Independent oracle:** Both seasons remain selected; later-year candidate and completion alone do not advance/remove L.

**Required evidence:** Exact implementation SHA and sanitized fixture hash; Declared clock/barrier schedule and actual execution receipt; Independent expected-versus-actual committed state and response bytes, with failures/skips recorded.

### FS20.01 - R031

Parent: FS20. Method: test. Status: **specified, not executed**.

**Fixture:** FX0; two selections share revision 7 but differ in association/league; third points at another league's season.

**Procedure:** Substitute each component before read and carryover validation.

**Independent oracle:** Mismatched tuple/season fails even when revisions match; legitimate exact tuple resolves.

**Required evidence:** Exact implementation SHA and sanitized fixture hash; Declared clock/barrier schedule and actual execution receipt; Independent expected-versus-actual committed state and response bytes, with failures/skips recorded.

### FS14.05 - R032

Parent: FS14. Method: test. Status: **specified, not executed**.

**Fixture:** FX0/FX-source; new current league has no predecessor; compare with verified successor transition.

**Procedure:** Create first selection and inspect evidence refs.

**Independent oracle:** Initial selection has truthful candidate/role evidence and null renewalRef; successor selection references its actual renewal proof.

**Required evidence:** Exact implementation SHA and sanitized fixture hash; Declared clock/barrier schedule and actual execution receipt; Independent expected-versus-actual committed state and response bytes, with failures/skips recorded.

### FS01.02 - R033

Parent: FS01. Method: test. Status: **specified, not executed**.

**Fixture:** FX0; PA owns T1, PB co-manages T1; another season reuses native roster number.

**Procedure:** Resolve both authorized actors and an owner change using existing identity mapping.

**Independent oracle:** PA/PB see identical T1/roster refs; owner change retains T1; reused number in other season stays distinct; associations/preferences remain actor-specific.

**Required evidence:** Exact implementation SHA and sanitized fixture hash; Declared clock/barrier schedule and actual execution receipt; Independent expected-versus-actual committed state and response bytes, with failures/skips recorded.

### FS13.04 - R034

Parent: FS13. Method: test. Status: **specified, not executed**.

**Fixture:** FX-source; valid roster_id 3 under L; tamper provider, native league namespace or mapping receipt.

**Procedure:** Validate references at writer and reader.

**Independent oracle:** Only the exact captured provider/league/native-team tuple resolves; no caller-supplied provider override or cross-league alias join.

**Required evidence:** Exact implementation SHA and sanitized fixture hash; Declared clock/barrier schedule and actual execution receipt; Independent expected-versus-actual committed state and response bytes, with failures/skips recorded.

### FS07.01 - R035

Parent: FS07. Method: test. Status: **specified, not executed**.

**Fixture:** FX-source; owner_id=N, explicit null, absent and invalid; co-manager M remains independently known.

**Procedure:** Normalize each through shared manager resolver.

**Independent oracle:** N resolves via exact ProviderAccount key; null is unowned primary role; absent/invalid is unknown; none alone proves no co-manager.

**Required evidence:** Exact implementation SHA and sanitized fixture hash; Declared clock/barrier schedule and actual execution receipt; Independent expected-versus-actual committed state and response bytes, with failures/skips recorded.

### FS07.02 - R036

Parent: FS07. Method: test. Status: **specified, not executed**.

**Fixture:** FX-source; co_owners=[], [N,M], missing, null and malformed value.

**Procedure:** Normalize and evaluate complete removal.

**Independent oracle:** Known [] is empty only for that qualified row; missing/null/invalid is unknown with null managers/reason; each known native manager resolves to internal account; unknown cannot establish exhaustive loss.

**Required evidence:** Exact implementation SHA and sanitized fixture hash; Declared clock/barrier schedule and actual execution receipt; Independent expected-versus-actual committed state and response bytes, with failures/skips recorded.

### FS13.05 - R037

Parent: FS13. Method: test. Status: **specified, not executed**.

**Fixture:** FX-source; role capture has observation time but no provider applicability timestamp.

**Procedure:** Normalize and inspect effectiveFrom.

**Independent oracle:** effectiveFrom remains null; observed/processed times are not substituted.

**Required evidence:** Exact implementation SHA and sanitized fixture hash; Declared clock/barrier schedule and actual execution receipt; Independent expected-versus-actual committed state and response bytes, with failures/skips recorded.

### FS12.02 - R038

Parent: FS12. Method: test. Status: **specified, not executed**.

**Fixture:** FX-source; accepted players [N,M], then [], null, absent, malformed and partial-population variants.

**Procedure:** Attempt inventory acceptance separately for each variation.

**Independent oracle:** Qualified explicit [] replaces with empty; null/absent/invalid/partial does not erase prior [N,M] or advance its age; no synthetic player fills missing data.

**Required evidence:** Exact implementation SHA and sanitized fixture hash; Declared clock/barrier schedule and actual execution receipt; Independent expected-versus-actual committed state and response bytes, with failures/skips recorded.

### FS15.01 - R039

Parent: FS15. Method: test. Status: **specified, not executed**.

**Fixture:** FX-source; three native players with mapping only for positions 0 and 2.

**Procedure:** Build held roster and inspect aligned arrays.

**Independent oracle:** Native three-player list stays exact; refs are [known,null,known]; unresolved entity remains visible with limited analytics and no invented canonical identity.

**Required evidence:** Exact implementation SHA and sanitized fixture hash; Declared clock/barrier schedule and actual execution receipt; Independent expected-versus-actual committed state and response bytes, with failures/skips recorded.

### FS11.04 - R040

Parent: FS11. Method: test. Status: **specified, not executed**.

**Fixture:** FX-source; valid held players, unknown placement, missing catalog and stale independent metadata.

**Procedure:** Read held resource and available field groups.

**Independent oracle:** Players remain represented; unknown placement remains unknown; group evidence belongs to same capture; metadata keeps independent age and no fabricated bench/IR/taxi placement.

**Required evidence:** Exact implementation SHA and sanitized fixture hash; Declared clock/barrier schedule and actual execution receipt; Independent expected-versus-actual committed state and response bytes, with failures/skips recorded.

### INV-R041 - R041

Parent: additional preservation/process invariant. Method: test. Status: **specified, not executed**.

**Fixture:** FX-preserve; current held resource differs from an earlier-week frozen lineup.

**Procedure:** Request earlier exact-week view after current roster changes.

**Independent oracle:** Earlier view resolves its existing exact-week evidence or explicit unavailability; current held list cannot satisfy it.

**Required evidence:** Exact implementation SHA and sanitized fixture hash; Declared clock/barrier schedule and actual execution receipt; Independent expected-versus-actual committed state and response bytes, with failures/skips recorded.

### FS12.03 - R042

Parent: FS12. Method: test. Status: **specified, not executed**.

**Fixture:** FX-source; independently complete no-role manager evidence plus malformed player array.

**Procedure:** Accept each resource group via existing split owner.

**Independent oracle:** Qualified manager removal is accepted and denies affected access; malformed players neither suppress removal nor replace accepted inventory.

**Required evidence:** Exact implementation SHA and sanitized fixture hash; Declared clock/barrier schedule and actual execution receipt; Independent expected-versus-actual committed state and response bytes, with failures/skips recorded.

### FS20.02 - R043

Parent: FS20. Method: test. Status: **specified, not executed**.

**Fixture:** FX0; A follows L, B does not; discover L2 and deny A's role while follow persists.

**Procedure:** Read preferences/access, then run discovery.

**Independent oracle:** Only explicit following or verified carryover alters preference; L2 is not auto-followed; follow never grants eligibility; B/shared facts unchanged.

**Required evidence:** Exact implementation SHA and sanitized fixture hash; Declared clock/barrier schedule and actual execution receipt; Independent expected-versus-actual committed state and response bytes, with failures/skips recorded.

### FS20.03 - R044

Parent: FS20. Method: test. Status: **specified, not executed**.

**Fixture:** FX0; (A,L) and (B,L2) share revision 9; A unfollows L.

**Procedure:** Resolve preference dependencies and attempt stale follow carryover.

**Independent oracle:** A's newer not-following revision remains; equal revision on another tuple cannot satisfy A/L; no fabricated surrogate ID or zero revision substitutes for absence.

**Required evidence:** Exact implementation SHA and sanitized fixture hash; Declared clock/barrier schedule and actual execution receipt; Independent expected-versus-actual committed state and response bytes, with failures/skips recorded.

### FS14.06 - R045

Parent: FS14. Method: test. Status: **specified, not executed**.

**Fixture:** FX-source; valid successor, same-name unrelated league, conflicting/forked predecessors and equal/older year.

**Procedure:** Evaluate each transition against current selected predecessor.

**Independent oracle:** Only compatible evidenced later successor creates a Renewal; conflict/fork/year/name-only candidates leave selection unchanged.

**Required evidence:** Exact implementation SHA and sanitized fixture hash; Declared clock/barrier schedule and actual execution receipt; Independent expected-versus-actual committed state and response bytes, with failures/skips recorded.

### FS10.02 - R046

Parent: FS10. Method: test. Status: **specified, not executed**.

**Fixture:** FX0/FX-race; valid renewal reserved; alter each fence independently including A-B-A source remap.

**Procedure:** Commit competing change before renewal and retry stale attempt.

**Independent oracle:** Every mismatched fence rejects stale transition; unchanged exact revisions permit one advancement; no lost update.

**Required evidence:** Exact implementation SHA and sanitized fixture hash; Declared clock/barrier schedule and actual execution receipt; Independent expected-versus-actual committed state and response bytes, with failures/skips recorded.

### FS14.07 - R047

Parent: FS14. Method: test. Status: **specified, not executed**.

**Fixture:** FX0; predecessor proof at T is valid; successor roles unknown, expired, then fresh at T+10.

**Procedure:** Attempt successor selection/read under each membership state.

**Independent oracle:** Unknown/expired successor cannot qualify transition; fresh proof uses successor T+10 clock, never predecessor T.

**Required evidence:** Exact implementation SHA and sanitized fixture hash; Declared clock/barrier schedule and actual execution receipt; Independent expected-versus-actual committed state and response bytes, with failures/skips recorded.

### FS20.04 - R048

Parent: FS20. Method: test. Status: **specified, not executed**.

**Fixture:** FX0/FX-race; existing following revision 4 captured; concurrent explicit unfollow revision 5; control has no follow.

**Procedure:** Commit renewal before and after unfollow; inspect preference and carryover evidence.

**Independent oracle:** Newer unfollow wins in both serial orders; absent follow stays absent/not-following; successful carryover retains exact renewal/captured preference proof; genuine loss/regain stays D04-gated.

**Required evidence:** Exact implementation SHA and sanitized fixture hash; Declared clock/barrier schedule and actual execution receipt; Independent expected-versus-actual committed state and response bytes, with failures/skips recorded.

### FS07.03 - R049

Parent: FS07. Method: test. Status: **specified, not executed**.

**Fixture:** FX0; A and B independently access shared T1; A alone changes preference/connection/role.

**Procedure:** Apply each A-only event and read B plus shared evidence store.

**Independent oracle:** Only A's relevant association/preference/access changes; B remains eligible when its proof is valid; team/roster evidence is not deleted.

**Required evidence:** Exact implementation SHA and sanitized fixture hash; Declared clock/barrier schedule and actual execution receipt; Independent expected-versus-actual committed state and response bytes, with failures/skips recorded.

### FS13.06 - R050

Parent: FS13. Method: test. Status: **specified, not executed**.

**Fixture:** FX0; enrolled, candidate, account-list and lookup captures; swap audience/period/entity/mapping/ref kind.

**Procedure:** Validate each scope/reference at acceptance and read.

**Independent oracle:** Cross-scope references fail; enrolled mappings are required and exact; pre-enrollment scopes have no fabricated mapping; null components compare exactly.

**Required evidence:** Exact implementation SHA and sanitized fixture hash; Declared clock/barrier schedule and actual execution receipt; Independent expected-versus-actual committed state and response bytes, with failures/skips recorded.

### FS21.01 - R051

Parent: FS21. Method: test. Status: **specified, not executed**.

**Fixture:** FX-source; one immutable capture interpreted as v1 and v2 with same scope.

**Procedure:** Accept both policy versions and compare keys/generations.

**Independent oracle:** Both heads coexist independently; neither overwrites the other; only head-local ordinals/generations compare.

**Required evidence:** Exact implementation SHA and sanitized fixture hash; Declared clock/barrier schedule and actual execution receipt; Independent expected-versus-actual committed state and response bytes, with failures/skips recorded.

### FS09.03 - R052

Parent: FS09. Method: test. Status: **specified, not executed**.

**Fixture:** FX-source; original network receipt at T, replay at T+100, cached observation with unknown original time.

**Procedure:** Replay and inspect all provenance fields.

**Independent oracle:** Replay has no invented new network request; original observed time is retained or null if unknown; normalization time records processing only; arrival time never claims provider event order.

**Required evidence:** Exact implementation SHA and sanitized fixture hash; Declared clock/barrier schedule and actual execution receipt; Independent expected-versus-actual committed state and response bytes, with failures/skips recorded.

### FS12.04 - R053

Parent: FS12. Method: test. Status: **specified, not executed**.

**Fixture:** FX-source; transport failure before normalize; capture-only lookup; invalid payload with recorded failed normalization attempt.

**Procedure:** Record each actual event sequence.

**Independent oracle:** No normalized content/accepted generation is invented; normalizedAt=null before any attempt; actual failed normalization time may be retained; null ordinal/generation is not zero.

**Required evidence:** Exact implementation SHA and sanitized fixture hash; Declared clock/barrier schedule and actual execution receipt; Independent expected-versus-actual committed state and response bytes, with failures/skips recorded.

### FS22.01 - R054

Parent: FS22. Method: test. Status: **specified, not executed**.

**Fixture:** FX-source; same-content valid network receipt at T+10, old cached/replayed receipt and independently qualified positive role group with optional display failure.

**Procedure:** Accept each observation with declared qualification.

**Independent oracle:** Fresh qualified network proof may advance T even with unrelated partial fields; cache/replay/unqualified partial cannot; qualification is retained explicitly.

**Required evidence:** Exact implementation SHA and sanitized fixture hash; Declared clock/barrier schedule and actual execution receipt; Independent expected-versus-actual committed state and response bytes, with failures/skips recorded.

### FS12.05 - R055

Parent: FS12. Method: test. Status: **specified, not executed**.

**Fixture:** FX-source; full vs subset population, complete vs continuation pages, known primary vs unknown co-managers.

**Procedure:** Compare proposed completeness and removal against immutable coverage spec.

**Independent oracle:** Complete applies only to declared qualified dimensions; no subset/page/group gap silently becomes full absence.

**Required evidence:** Exact implementation SHA and sanitized fixture hash; Declared clock/barrier schedule and actual execution receipt; Independent expected-versus-actual committed state and response bytes, with failures/skips recorded.

### FS10.03 - R056

Parent: FS10. Method: test. Status: **specified, not executed**.

**Fixture:** FX0/FX-race; reserve ordinal 10 then 11 for same head; 11 completes first; repeat expired/replaced lease or changed context.

**Procedure:** Complete 10 after 11 through actual fenced writer.

**Independent oracle:** Head remains at later admitted qualified state; stale generation/lease/context/mapping writes fail; cross-head ordinal comparisons never determine precedence.

**Required evidence:** Exact implementation SHA and sanitized fixture hash; Declared clock/barrier schedule and actual execution receipt; Independent expected-versus-actual committed state and response bytes, with failures/skips recorded.

### FS22.02 - R057

Parent: FS22. Method: test. Status: **specified, not executed**.

**Fixture:** FX-source/FX-preserve; value 10 corrected to 7 in a later admitted valid observation.

**Procedure:** Accept correction and compare old/new evidence and baseline hashes.

**Independent oracle:** Current official value becomes 7; old receipt/content and frozen baseline hashes persist unchanged; numeric monotonicity is not an acceptance rule.

**Required evidence:** Exact implementation SHA and sanitized fixture hash; Declared clock/barrier schedule and actual execution receipt; Independent expected-versus-actual committed state and response bytes, with failures/skips recorded.

### FS16.02 - R058

Parent: FS16. Method: test. Status: **specified, not executed**.

**Fixture:** FX0; co-managers A/B plus two tabs and aggregate view request same public resource; V/W private controls.

**Procedure:** Count actual HTTP starts and capture refs through existing request boundary.

**Independent oracle:** Compatible simultaneous requests coalesce to one permitted shared acquisition; incompatible private evidence remains partitioned; normalization versions may share capture without fake source requests.

**Required evidence:** Exact implementation SHA and sanitized fixture hash; Declared clock/barrier schedule and actual execution receipt; Independent expected-versus-actual committed state and response bytes, with failures/skips recorded.

### FS21.02 - R059

Parent: FS21. Method: test. Status: **specified, not executed**.

**Fixture:** FX0; v1/v2 heads with distinct semver/timestamps; scopes differ in null member, audience, coverage or reader binding.

**Procedure:** Resolve selected data and attempt key-component substitutions.

**Independent oracle:** Only explicit full-key binding selects head; neither newest version nor timestamp auto-promotes; legacy binding remains pinned; distinct tuples never alias.

**Required evidence:** Exact implementation SHA and sanitized fixture hash; Declared clock/barrier schedule and actual execution receipt; Independent expected-versus-actual committed state and response bytes, with failures/skips recorded.

### FS09.04 - R060

Parent: FS09. Method: test. Status: **specified, not executed**.

**Fixture:** FX0/FX-race; promote v1 to v2; crash before commit, after commit before dispatch and during old in-flight materialization.

**Procedure:** Resume each crash point and attempt old-revision publication.

**Independent oracle:** Before commit nothing changes; after commit durable pending work survives and resumes once; old binding work cannot publish; no lost or duplicate required publication.

**Required evidence:** Exact implementation SHA and sanitized fixture hash; Declared clock/barrier schedule and actual execution receipt; Independent expected-versus-actual committed state and response bytes, with failures/skips recorded.

### FS21.03 - R061

Parent: FS21. Method: test. Status: **specified, not executed**.

**Fixture:** FX0; v2 positive at T1, qualified complete v1 removal at T2>T1, promotion before T1+3600; repeat incomparable lineage.

**Procedure:** Promote/rollback/replay old positive, then introduce a later qualified positive with explicit ordering proof.

**Independent oracle:** Old or incomparable evidence never restores access; denial/no protected bytes persists; only proved matching later positive supersession can restore; D04 follow outcome remains undecided.

**Required evidence:** Exact implementation SHA and sanitized fixture hash; Declared clock/barrier schedule and actual execution receipt; Independent expected-versus-actual committed state and response bytes, with failures/skips recorded.

### FS08.04 - R062

Parent: FS08. Method: test. Status: **specified, not executed**.

**Fixture:** FX0/FX-race; qualified positive selected head, initially empty adverse set, and a qualified complete removal under a different compatible version. Include unknown/unqueried adverse-set controls.

**Procedure:** Run two actual guarded schedules. First commit removal before the reader acquires the connection SHARE lock, then perform the fresh complete evidence read. Second let the reader acquire all required locks and enumerate the complete empty set, start the removal writer, prove its connection UPDATE lock waits, and finish the reader transaction before releasing that writer. Record the final SQL authorization point and both transaction orders; do not demand a removal commit inside the held reader fence.

**Independent oracle:** Removal committed before reader locking is enumerated and denies the older positive. Reader-first can allow at its recorded authorization point only while all authority and expiry checks pass; the removal writer cannot commit inside its held connection fence and later reads see the removal. Unknown set completeness never allows. Timeout, conflict or abort emits no protected content and causes no automatic final-reader retry; a later ordinary request evaluates afresh.

**Required evidence:** Exact implementation SHA and sanitized fixture hash; Declared clock/barrier schedule and actual execution receipt; Independent expected-versus-actual committed state and response bytes, with failures/skips recorded.

### FS06.01 - R063

Parent: FS06. Method: test. Status: **specified, not executed**.

**Fixture:** FX0; qualified proof at T, all other authority valid; database clock T+3599, T+3600 and T+3601. Include an otherwise valid final SQL decision with only a small positive remaining lifetime, followed by controlled commit/result-validation delay.

**Procedure:** Evaluate using a controlled trusted clock at all three instants. Compute the database remaining-lifetime receipt and deduct ceiling-rounded elapsed monotonic time from an anchor before SQL dispatch; inspect and exercise the immediate handoff check.

**Independent oracle:** Access may allow at 3599; cannot allow at 3600 or 3601; expiresAt remains T+3600 even when old positive head remains selected. Expiry before synchronous serialization/body handoff discards protected data even if the earlier SQL decision allowed. No await occurs between the last strictly-positive remaining-lifetime/request-budget check and handoff; the timing sidecar is never public.

**Required evidence:** Exact implementation SHA and sanitized fixture hash; Declared clock/barrier schedule and actual execution receipt; Independent expected-versus-actual committed state and response bytes, with failures/skips recorded.

### FS07.04 - R064

Parent: FS07. Method: test. Status: **specified, not executed**.

**Fixture:** FX0; positive T, authority expiry at T+100 and separate disconnect/removal before T+100.

**Procedure:** Evaluate immediately before and at earlier expiry, and after each accepted deny.

**Independent oracle:** Effective expiry is min(T+3600, earlier expiry); disconnect/revocation/qualified complete removal denies immediately without waiting for age bound.

**Required evidence:** Exact implementation SHA and sanitized fixture hash; Declared clock/barrier schedule and actual execution receipt; Independent expected-versus-actual committed state and response bytes, with failures/skips recorded.

### FS06.02 - R065

Parent: FS06. Method: test. Status: **specified, not executed**.

**Fixture:** FX0; account identified but no qualifying membership history; list/member/commissioner presence only.

**Procedure:** Evaluate initial league read and discovery qualification.

**Independent oracle:** Result is deny or indeterminate with no protected fields; no synthetic qualifyingVerifiedAt or expiry.

**Required evidence:** Exact implementation SHA and sanitized fixture hash; Declared clock/barrier schedule and actual execution receipt; Independent expected-versus-actual committed state and response bytes, with failures/skips recorded.

### FS06.03 - R066

Parent: FS06. Method: test. Status: **specified, not executed**.

**Fixture:** FX0; positive at T; each nonqualifying event happens at T+3500 with head unchanged.

**Procedure:** Process each event and evaluate at T+3600.

**Independent oracle:** qualifyingVerifiedAt=T and expiresAt=T+3600 remain; no event grants another grace interval; qualified-positive partial exception is tested separately by R054.

**Required evidence:** Exact implementation SHA and sanitized fixture hash; Declared clock/barrier schedule and actual execution receipt; Independent expected-versus-actual committed state and response bytes, with failures/skips recorded.

### FS17.02 - R067

Parent: FS17. Method: test. Status: **specified, not executed**.

**Fixture:** FX0; affected league expires during provider outage while association/context stay valid; control is disconnected.

**Procedure:** Request or schedule recovery, then deliver fresh qualified network role proof.

**Independent oracle:** Expired connected league can revalidate and regain access; disconnected/revoked control cannot bypass authority; other leagues and L1 sign-in remain usable.

**Required evidence:** Exact implementation SHA and sanitized fixture hash; Declared clock/barrier schedule and actual execution receipt; Independent expected-versus-actual committed state and response bytes, with failures/skips recorded.

### FS05.01 - R068

Parent: FS05. Method: test. Status: **specified, not executed**.

**Fixture:** FX-source; league member, commissioner, historical owner and follower with no current team; control has current co-manager role.

**Procedure:** Read direct, aggregate and cached paths through shared access service.

**Independent oracle:** Nonqualifying identities all denied; valid current co-manager passes remaining checks; no alternative entry path bypass.

**Required evidence:** Exact implementation SHA and sanitized fixture hash; Declared clock/barrier schedule and actual execution receipt; Independent expected-versus-actual committed state and response bytes, with failures/skips recorded.

### FS01.03 - R069

Parent: FS01. Method: test. Status: **specified, not executed**.

**Fixture:** FX-source; PA owns T1 and co-manages T2, with a third unrelated T3.

**Procedure:** Run discovery and authorized roster composition.

**Independent oracle:** Both T1/T2 are returned using shared IDs; T3 is excluded; no first-match/preview sampling truncation; each access decision matches its selected season.

**Required evidence:** Exact implementation SHA and sanitized fixture hash; Declared clock/barrier schedule and actual execution receipt; Independent expected-versus-actual committed state and response bytes, with failures/skips recorded.

### FS13.07 - R070

Parent: FS13. Method: test. Status: **specified, not executed**.

**Fixture:** FX0; cached decision pins v1; attempt silent v1 duration edit or simulate explicit newly approved replacement binding in test-only fixture.

**Procedure:** Validate policy/configuration and final cache delivery.

**Independent oracle:** v1 remains exactly3600; unapproved/default policy fails; changed binding forces reevaluation; no stale policy authorization survives.

**Required evidence:** Exact implementation SHA and sanitized fixture hash; Declared clock/barrier schedule and actual execution receipt; Independent expected-versus-actual committed state and response bytes, with failures/skips recorded.

### FS08.05 - R071

Parent: FS08. Method: test. Status: **specified, not executed**.

**Fixture:** FX0/FX-race; A valid before association switch, role valid only after switch; pause checks to create mixed-read opportunity.

**Procedure:** Exercise the selected final-fence protocol in both legal lock orders with association, mapping and removal writers. Changes committed before the relevant reader guard are reread in the final coherent evaluation; writers started after that guard must wait. Separately force lock timeout or transaction abort and count final-reader attempts.

**Independent oracle:** No allow is produced from states that never coexisted. A prerequisite invalidated before its guard yields denial/indeterminate after the fresh evaluation; reader-first may allow before a blocked later mutation when all checks pass. Timeout/conflict/abort refuses protected output with exactly one final-reader attempt and no automatic retry. Successful serialization has the selected single authorization point and final expiry check; a later ordinary request evaluates afresh and already delivered bytes are not claimed recallable.

**Required evidence:** Exact implementation SHA and sanitized fixture hash; Declared clock/barrier schedule and actual execution receipt; Independent expected-versus-actual committed state and response bytes, with failures/skips recorded.

### FS13.08 - R072

Parent: FS13. Method: test. Status: **specified, not executed**.

**Fixture:** FX0; one valid vector plus per-variant missing/extra/wrong-kind field, key mismatch, wrong revision and ambiguous string concatenation mutations.

**Procedure:** Parse and resolve every variant using actual owner; evaluate malformed and colliding tuples.

**Independent oracle:** All mutations fail; same revision on different full key never authorizes; absent preferences have no fake zero revision; session uses real stored identity and expiry.

**Required evidence:** Exact implementation SHA and sanitized fixture hash; Declared clock/barrier schedule and actual execution receipt; Independent expected-versus-actual committed state and response bytes, with failures/skips recorded.

### FS17.03 - R073

Parent: FS17. Method: test. Status: **specified, not executed**.

**Fixture:** FX0; evaluate unknown, complete removal, expiry, association end and authority revocation separately.

**Procedure:** Inspect server-side decisions and effect on stored membership history.

**Independent oracle:** Each outcome carries a stable correct reason for exact selected season; expiry writes no false membership-removal fact; denied/indeterminate discloses no protected data.

**Required evidence:** Exact implementation SHA and sanitized fixture hash; Declared clock/barrier schedule and actual execution receipt; Independent expected-versus-actual committed state and response bytes, with failures/skips recorded.

### FS13.09 - R074

Parent: FS13. Method: test. Status: **specified, not executed**.

**Fixture:** FX0; authorized complete stored roster and selected serving binding.

**Procedure:** Validate and serialize available result plus each missing/extra/wrong-season field mutation.

**Independent oracle:** Available contains exactly defined keys, nonempty resourceRevision and nonnull roster; every returned team belongs to selected season; invalid variants reject.

**Required evidence:** Exact implementation SHA and sanitized fixture hash; Declared clock/barrier schedule and actual execution receipt; Independent expected-versus-actual committed state and response bytes, with failures/skips recorded.

### FS13.10 - R075

Parent: FS13. Method: test. Status: **specified, not executed**.

**Fixture:** FX0; valid access but cold resource, failed resource and existing qualified empty roster control.

**Procedure:** Serialize all three states.

**Independent oracle:** Pending/unavailable have null roster/revision, empty fieldGroups/features and safe reason; qualified empty available is distinct; prior accepted facts are not erased.

**Required evidence:** Exact implementation SHA and sanitized fixture hash; Declared clock/barrier schedule and actual execution receipt; Independent expected-versus-actual committed state and response bytes, with failures/skips recorded.

### FS05.02 - R076

Parent: FS05. Method: test. Status: **specified, not executed**.

**Fixture:** FX0; denied and indeterminate both before and after selection, through direct/aggregate/cache entry paths.

**Procedure:** Serialize response and inspect all keys, bytes and error metadata.

**Independent oracle:** Exactly status/reason are present; no team/season IDs, revisions, source groups, features, dependency refs or competing identities leak.

**Required evidence:** Exact implementation SHA and sanitized fixture hash; Declared clock/barrier schedule and actual execution receipt; Independent expected-versus-actual committed state and response bytes, with failures/skips recorded.

### FS11.05 - R077

Parent: FS11. Method: test. Status: **specified, not executed**.

**Fixture:** FX-source; stale but display-permitted official resource while D02 still valid; analytical data absent.

**Procedure:** Compose fields and optional features with independently dated evidence.

**Independent oracle:** Official fields retain truthful age/coverage/authority; absent forecast is unavailable, never an estimated official fact; source refs stay server-side; D02 does not relabel data freshness.

**Required evidence:** Exact implementation SHA and sanitized fixture hash; Declared clock/barrier schedule and actual execution receipt; Independent expected-versus-actual committed state and response bytes, with failures/skips recorded.

### FS19.02 - R078

Parent: FS19. Method: test. Status: **specified, not executed**.

**Fixture:** FX-source; scan finds qualified L-2025, L2-2026 and unresolved L3 candidate.

**Procedure:** Build result after partial processing and on retry.

**Independent oracle:** Result references same scan/strategy progress; selected years remain independent; unresolved refs/reasons are opaque/truthful and do not imply removal or disclose protected roster content.

**Required evidence:** Exact implementation SHA and sanitized fixture hash; Declared clock/barrier schedule and actual execution receipt; Independent expected-versus-actual committed state and response bytes, with failures/skips recorded.

### FS19.03 - R079

Parent: FS19. Method: test. Status: **specified, not executed**.

**Fixture:** FX-source; all lists fetched but one candidate has unknown role/current-selection; empty completed lists without exhaustive scope; full qualified control.

**Procedure:** Evaluate result status and proposed absence.

**Independent oracle:** List complete alone cannot yield complete current teams; partial/unknown preserved; complete empty requires qualified exhaustive scope/roles; expired proof cannot qualify new current team.

**Required evidence:** Exact implementation SHA and sanitized fixture hash; Declared clock/barrier schedule and actual execution receipt; Independent expected-versus-actual committed state and response bytes, with failures/skips recorded.

### FS05.03 - R080

Parent: FS05. Method: test. Status: **specified, not executed**.

**Fixture:** FX0; authorized, denied, cache miss, cold and stale stored resources.

**Procedure:** Invoke all read paths with instrumented provider request boundary.

**Independent oracle:** Zero Sleeper/Tank01 calls from stored reader; independently scheduled recovery remains outside the read/held transaction.

**Required evidence:** Exact implementation SHA and sanitized fixture hash; Declared clock/barrier schedule and actual execution receipt; Independent expected-versus-actual committed state and response bytes, with failures/skips recorded.

### FS15.02 - R081

Parent: FS15. Method: test. Status: **specified, not executed**.

**Fixture:** FX-source; native string above 9007199254740991 and namespace-qualified composite key; duplicate/malformed roster integer controls.

**Procedure:** Normalize, store, resolve and serialize through ordinary adapter boundaries.

**Independent oracle:** Exact valid opaque value survives; native roster integer is validated before exact string conversion; malformed/ambiguous values reject; no synthetic identity fills gaps.

**Required evidence:** Exact implementation SHA and sanitized fixture hash; Declared clock/barrier schedule and actual execution receipt; Independent expected-versus-actual committed state and response bytes, with failures/skips recorded.

### FS15.03 - R082

Parent: FS15. Method: test. Status: **specified, not executed**.

**Fixture:** FX-source; one field per declared state plus invalid state/value combinations.

**Procedure:** Validate normalized field wrappers and round-trip each state.

**Independent oracle:** Absent/null/invalid have null values; empty requires explicit source evidence; valid known preserves typed value; states do not collapse into empty or zero.

**Required evidence:** Exact implementation SHA and sanitized fixture hash; Declared clock/barrier schedule and actual execution receipt; Independent expected-versus-actual committed state and response bytes, with failures/skips recorded.

### INV-R083 - R083

Parent: additional preservation/process invariant. Method: inspection, test. Status: **specified, not executed**.

**Fixture:** Pinned code-owner map and proposed first-slice dependency graph.

**Procedure:** Inspect all added source entry points and provider/publication calls against existing ownership; instrument later service journey.

**Independent oracle:** Each responsibility stays with existing shared owner; no duplicate worker/feed/scorer/normalizer/publication path appears.

**Required evidence:** Exact implementation/design SHA and fixture/source manifest; Actual inspection or execution receipt with method, date, reviewer and limitations; Independent expected-versus-actual evidence, with failures/skips recorded.

### INV-R084 - R084

Parent: additional preservation/process invariant. Method: inspection, test. Status: **specified, not executed**.

**Fixture:** FX-preserve and instrumented browser/observer/provider boundaries.

**Procedure:** Inspect imports and run existing browser/observer journeys after later implementation.

**Independent oracle:** Tank01 HTTP start count from browser/observer paths is zero; existing worker authority remains unchanged.

**Required evidence:** Exact implementation/design SHA and fixture/source manifest; Actual inspection or execution receipt with method, date, reviewer and limitations; Independent expected-versus-actual evidence, with failures/skips recorded.

### INV-R085 - R085

Parent: additional preservation/process invariant. Method: test. Status: **specified, not executed**.

**Fixture:** FX-preserve; exact/current/future periods, bye, missing projection, completed games and frozen pregame snapshots.

**Procedure:** Compare existing qualified behavior and immutable hashes using identical source manifests before/after later change.

**Independent oracle:** No unexplained differences in exact-week resolution, clock-v1 results, bye/missing policy or immutable baseline/snapshot references.

**Required evidence:** Exact implementation/design SHA and fixture/source manifest; Actual inspection or execution receipt with method, date, reviewer and limitations; Independent expected-versus-actual evidence, with failures/skips recorded.

### INV-R086 - R086

Parent: additional preservation/process invariant. Method: test. Status: **specified, not executed**.

**Fixture:** FX-preserve with both registered leagues and colliding native roster numbers.

**Procedure:** Exercise both leagues after future change; attempt cross-league aliases/references.

**Independent oracle:** Neither league's source, settings, score, manager selection or snapshot bleeds into the other; baseline official behavior is preserved.

**Required evidence:** Exact implementation/design SHA and fixture/source manifest; Actual inspection or execution receipt with method, date, reviewer and limitations; Independent expected-versus-actual evidence, with failures/skips recorded.

### INV-R087 - R087

Parent: additional preservation/process invariant. Method: inspection, test. Status: **specified, not executed**.

**Fixture:** FX-preserve: baseline route/payload/fallback/cache/selection manifest.

**Procedure:** Compare public requests and navigation/selection persistence after internal first-slice implementation.

**Independent oracle:** No public contract or user selection changes; internal target is unexposed until qualified authorized cutover.

**Required evidence:** Exact implementation/design SHA and fixture/source manifest; Actual inspection or execution receipt with method, date, reviewer and limitations; Independent expected-versus-actual evidence, with failures/skips recorded.

### INV-R088 - R088

Parent: additional preservation/process invariant. Method: inspection, test. Status: **specified, not executed**.

**Fixture:** Existing scheduler policy fixtures plus first-slice followed inactive league and active aggregate-view promotion.

**Procedure:** Exercise demand transitions through shared owner without changing cron/cadence.

**Independent oracle:** Existing offline maintenance and active-view promotion are preserved; new demand is bounded/shared and does not spawn per-view collectors; D05 last-follower policy remains gated.

**Required evidence:** Exact implementation/design SHA and fixture/source manifest; Actual inspection or execution receipt with method, date, reviewer and limitations; Independent expected-versus-actual evidence, with failures/skips recorded.

### INV-R089 - R089

Parent: additional preservation/process invariant. Method: inspection. Status: **specified, not executed**.

**Fixture:** Adapter registry, target imports and public capability descriptions.

**Procedure:** Inspect selected provider code paths and output descriptions.

**Independent oracle:** Sleeper is the only implemented provider; no Yahoo/ESPN data-access or shipped-feature claim; no parallel feature stack introduced.

**Required evidence:** Exact implementation/design SHA and fixture/source manifest; Actual inspection or execution receipt with method, date, reviewer and limitations; Independent expected-versus-actual evidence, with failures/skips recorded.

### INV-R090 - R090

Parent: additional preservation/process invariant. Method: inspection. Status: **specified, not executed**.

**Fixture:** Fresh repository identity/status and task attachment evidence plus changed-path inventory.

**Procedure:** Inspect primary and attached worktree status before/after design writes.

**Independent oracle:** Canonical repository verified; primary remains clean or unrelated changes preserved exactly; only authorized document artifacts change; no runtime/migration/provider/cron/production mutations.

**Required evidence:** Exact implementation/design SHA and fixture/source manifest; Actual inspection or execution receipt with method, date, reviewer and limitations; Independent expected-versus-actual evidence, with failures/skips recorded.

### INV-R091 - R091

Parent: additional preservation/process invariant. Method: inspection. Status: **specified, not executed**.

**Fixture:** Repository README, document authority links, portable manifest and generated copy.

**Procedure:** Inspect precedence/supersession, compare copied file hashes and recorded dirty status.

**Independent oracle:** Copies match identified revision/content and direct readers to same target; no independently edited competing contract or unearned readiness claim.

**Required evidence:** Exact implementation/design SHA and fixture/source manifest; Actual inspection or execution receipt with method, date, reviewer and limitations; Independent expected-versus-actual evidence, with failures/skips recorded.

### INV-R092 - R092

Parent: additional preservation/process invariant. Method: inspection, test. Status: **specified, not executed**.

**Fixture:** Harness authorization/identity/sentinel/TLS/role/denylist controls; each guard independently fails in dry fixture.

**Procedure:** Review future test invocation; prove each failing guard prevents database test entry.

**Independent oracle:** No destructive test reaches retained/production database; missing guard denies execution; no retained .env.integration.local or pulled production secrets are used.

**Required evidence:** Exact implementation/design SHA and fixture/source manifest; Actual inspection or execution receipt with method, date, reviewer and limitations; Independent expected-versus-actual evidence, with failures/skips recorded.

### INV-R093 - R093

Parent: additional preservation/process invariant. Method: inspection. Status: **specified, not executed**.

**Fixture:** Local/GitHub main, Vercel repo/root/production branch and exact production SHA receipts.

**Procedure:** Compare identities at implementation and release gates; simulate unexplained drift in review fixture.

**Independent oracle:** Unexplained disagreement blocks that action; later release additionally records exact merged deployed SHA and both-league evidence; design authorization alone never authorizes merge/deploy.

**Required evidence:** Exact implementation/design SHA and fixture/source manifest; Actual inspection or execution receipt with method, date, reviewer and limitations; Independent expected-versus-actual evidence, with failures/skips recorded.

### INV-R094 - R094

Parent: additional preservation/process invariant. Method: inspection. Status: **specified, not executed**.

**Fixture:** One sample change to D02, membership role coverage or dependency key in a copy of the trace ledger.

**Procedure:** Follow forward and reverse IDs through fields, constraints, cases and retained source approval.

**Independent oracle:** All impacted artifacts/gates are identified; no silent approved-policy change; numeric D02 changes require a new explicitly approved immutable version.

**Required evidence:** Exact implementation/design SHA and fixture/source manifest; Actual inspection or execution receipt with method, date, reviewer and limitations; Independent expected-versus-actual evidence, with failures/skips recorded.

### FS08.06 - R095

Parent: FS08. Method: inspection, test. Status: **specified, not executed**.

**Fixture:** FX0/FX-race; valid request captured under one admission-config hash; active epoch changes before locked decision.

**Procedure:** Lock/revalidate real session and active admission epoch, then attempt decision using old versus current receipt.

**Independent oracle:** Old/missing/unmatched epoch/config receipt cannot allow; current valid receipt may proceed to domain checks; no new login identity/session credential is created.

**Required evidence:** Selected protocol/version and exact implementation SHA; Actual restricted-role clock/transaction/barrier trace or captured safe sink output; Independent committed-state/serialized-byte assertion and failure/skip receipt.

### FS08.07 - R096

Parent: FS08. Method: inspection, test. Status: **specified, not executed**.

**Fixture:** FX0; auth and account stores proved same DB/clock domain; controls deliberately separate or unknown.

**Procedure:** Attempt protocol activation and final delivery under each topology.

**Independent oracle:** Unknown/mismatched topology yields indeterminate target league read; no unfenced allow or distributed-clock assumption; L1 sign-in behavior is unchanged.

**Required evidence:** Selected protocol/version and exact implementation SHA; Actual restricted-role clock/transaction/barrier trace or captured safe sink output; Independent committed-state/serialized-byte assertion and failure/skip receipt.

### FS08.08 - R097

Parent: FS08. Method: inspection, test. Status: **specified, not executed**.

**Fixture:** FX-race; enumerate all actual role-accessible writers including a new qualified policy head, removal, mapping change and admission rollover.

**Procedure:** Attempt direct and approved mutations while final decision holds required locks; inspect generation/event/reservation changes and conflict behavior.

**Independent oracle:** No mutator bypasses lock coverage; committed membership-set changes advance authoritative generation/events; new-head phantom is detected; same lock order prevents mixed-state allow; no network I/O occurs while final locks held.

**Required evidence:** Selected protocol/version and exact implementation SHA; Actual restricted-role clock/transaction/barrier trace or captured safe sink output; Independent committed-state/serialized-byte assertion and failure/skip receipt.

### FS08.09 - R098

Parent: FS08. Method: inspection, test. Status: **specified, not executed**.

**Fixture:** FX0; caller has remaining budget below or above 12 seconds; force lock wait, statement timeout, dependency conflict and delayed commits. Include malformed/negative/nonfinite remaining-lifetime receipts and unavailable/backward monotonic timer.

**Procedure:** Execute final protocol using min(caller remaining budget, 12 seconds), respecting existing stricter limits and maxima of 3 seconds for locks and 8 seconds for statements. Inspect the pre-dispatch monotonic anchor, floor-rounded database lifetime, ceiling-rounded elapsed deduction and immediate synchronous handoff.

**Independent oracle:** No automatic final-read retry; proved deny returns deny and uncertainty returns indeterminate. Invalid timing or expired lifetime/request budget discards protected content. No application wall-clock subtraction, rounding up of lifetime, deadline extension, asynchronous gap before handoff or leaked driver details. Provider collection cadence is unchanged.

**Required evidence:** Selected protocol/version and exact implementation SHA; Actual restricted-role clock/transaction/barrier trace or captured safe sink output; Independent committed-state/serialized-byte assertion and failure/skip receipt.

### INV-R099 - R099

Parent: additional preservation/process invariant. Method: inspection, test. Status: **specified, not executed**.

**Fixture:** FX0; each membership-read event plus email, cookie, native ID, arbitrary metadata, raw SQL error and wrong-type sentinels.

**Procedure:** Run event serializer against valid variants and every extra/domain-invalid field; capture sink bytes.

**Independent oracle:** No undeclared field or sensitive sentinel reaches sink; reasons are fixed safe enums, null has defined meaning and counters/durations have valid domains; no diagnostic fields enter client DTOs.

**Required evidence:** Selected protocol/version and exact implementation SHA; Actual restricted-role clock/transaction/barrier trace or captured safe sink output; Independent committed-state/serialized-byte assertion and failure/skip receipt.

### INV-R100 - R100

Parent: additional preservation/process invariant. Method: inspection, test. Status: **specified, not executed**.

**Fixture:** FX0; inject roster/league/team/source/dependency key into a denied or indeterminate result after composition.

**Procedure:** Run final serializer and inspect actual response/sink bytes.

**Independent oracle:** Zero protected value bytes are emitted; only safe DTO/transport failure remains; event contains count, never forbidden values; first occurrence fails qualification.

**Required evidence:** Selected protocol/version and exact implementation SHA; Actual restricted-role clock/transaction/barrier trace or captured safe sink output; Independent committed-state/serialized-byte assertion and failure/skip receipt.

### INV-R101 - R101

Parent: additional preservation/process invariant. Method: inspection, test. Status: **specified, not executed**.

**Fixture:** FX0; recovery intent before commit, after commit before ack, failed commit, leased jobs and provider outage.

**Procedure:** Compute diagnostic events and backlog using existing authorized operational inspection; do not run a new cron.

**Independent oracle:** Committed true appears only after durable commit or known idempotent intent; failed commit is explicit; counts/age match stored work and no log replay enqueues work; independent expired-membership recovery remains possible.

**Required evidence:** Selected protocol/version and exact implementation SHA; Actual restricted-role clock/transaction/barrier trace or captured safe sink output; Independent committed-state/serialized-byte assertion and failure/skip receipt.

### INV-R102 - R102

Parent: additional preservation/process invariant. Method: inspection, test. Status: **specified, not executed**.

**Fixture:** FX0; sink throws/unavailable for allow and deny outcomes; include repeated failures, counter saturation, restored sink, summary failure and process restart.

**Procedure:** Inject diagnostic failure after valid decisions and inspect only the process-local failure counter. Restore ordinary emission and exercise summary success/failure, then restart with an outstanding count. Qualify operational sink-failure detection separately at G7.

**Independent oracle:** Deny never becomes allow and completed valid decisions stay correct. The counter saturates at 9007199254740991, stores no event payload and never recursively logs through the failed sink. On a successful ordinary emission at most one summary is attempted; its count resets only after summary success. Restart may lose the counter, as explicitly permitted. This test makes no durable outage-observation claim; activation still requires the separate G7 operator-detection evidence.

**Required evidence:** Selected protocol/version and exact implementation SHA; Actual restricted-role clock/transaction/barrier trace or captured safe sink output; Independent committed-state/serialized-byte assertion and failure/skip receipt.

### INV-R103 - R103

Parent: additional preservation/process invariant. Method: inspection, test. Status: **specified, not executed**.

**Fixture:** FX-race; valid exclusive activation or accepted change reaches mandatory audit/pending-work write; force write failure.

**Procedure:** Execute real transaction and inspect committed mutation/audit/job state.

**Independent oracle:** No partially committed mutation or orphan accepted state survives; error is safe and later idempotent retry follows ordinary writer path.

**Required evidence:** Selected protocol/version and exact implementation SHA; Actual restricted-role clock/transaction/barrier trace or captured safe sink output; Independent committed-state/serialized-byte assertion and failure/skip receipt.

### INV-R104 - R104

Parent: additional preservation/process invariant. Method: inspection, test. Status: **specified, not executed**.

**Fixture:** Synthetic correlated events in actual existing host sink with shorter, seven-day and unenforceable retention configurations.

**Procedure:** Inspect privileges and expiry behavior before activation, including account/browser access attempts.

**Independent oracle:** No account/browser event-stream access; actual retention is at most seven days and shorter existing retention stays; unenforceable/unknown setting blocks target activation; no production retention change or source-receipt pruning occurs in this task.

**Required evidence:** Selected protocol/version and exact implementation SHA; Actual restricted-role clock/transaction/barrier trace or captured safe sink output; Independent committed-state/serialized-byte assertion and failure/skip receipt.

### FS13.11 - R105

Parent: FS13. Method: inspection, test. Status: **specified, not executed**.

**Fixture:** Disposable actual-role fixture with two actors/audiences, PUBLIC/unrelated roles, shadow schema names and malicious helper arguments.

**Procedure:** Invoke each candidate helper through every role; vary actor/scope, search_path, keys and time budget; attempt forbidden direct source/auth grants.

**Independent oracle:** Only exact authorized helper calls act on scoped rows; fixed search_path/fully qualified names prevent shadowing; no arbitrary SQL/read/write/escalation or surviving pooled actor context; PUBLIC/unrelated EXECUTE and direct source UPDATE/auth SELECT remain denied.

**Required evidence:** Exact deployed-in-disposable-harness implementation/catalog/role manifest; Captured restricted-role operation and response/header bytes; Independent mutation/privilege/scope assertion with actual failures/skips.

### FS05.04 - R106

Parent: FS05. Method: inspection, test. Status: **specified, not executed**.

**Fixture:** FX0; valid allow cached before disconnect/expiry; immutable fact cache remains available.

**Procedure:** Inspect target response headers and invoke fresh direct/aggregate/cached-fact read after invalidation.

**Independent oracle:** Target sends private/no-store; every delivery reauthorizes; cached facts do not preserve permission; legacy public route/cache behavior remains unchanged.

**Required evidence:** Exact deployed-in-disposable-harness implementation/catalog/role manifest; Captured restricted-role operation and response/header bytes; Independent mutation/privilege/scope assertion with actual failures/skips.

### INV-R107 - R107

Parent: additional preservation/process invariant. Method: inspection, test. Status: **specified, not executed**.

**Fixture:** Existing qualified account guard fixtures plus target lookup, activation and recovery commands; forged origin, oversized input, disallowed admission and repeated demand.

**Procedure:** Exercise target entry through same existing guards and inspect request/job/HTTP starts.

**Independent oracle:** Each existing guard failure blocks the protected operation; duplicate justified work coalesces under existing budget; no new cadence/quota, unbounded fanout or bypass appears.

**Required evidence:** Exact deployed-in-disposable-harness implementation/catalog/role manifest; Captured restricted-role operation and response/header bytes; Independent mutation/privilege/scope assertion with actual failures/skips.

### INV-R108 - R108

Parent: additional preservation/process invariant. Method: inspection, test. Status: **specified, not executed**.

**Fixture:** FX-source; usernames/native keys containing URL delimiters, SQL-like text, control characters and a valid opaque ID.

**Procedure:** Resolve lookup/discovery with instrumented network targets and SQL bound values.

**Independent oracle:** Only implemented Sleeper endpoint shapes are invoked; no arbitrary host/path/SQL execution follows from user text; valid native keys remain exact.

**Required evidence:** Exact deployed-in-disposable-harness implementation/catalog/role manifest; Captured restricted-role operation and response/header bytes; Independent mutation/privilege/scope assertion with actual failures/skips.

## Reverse allocation: every field

| Field | Requirement IDs |
| --- | --- |
| Actor.id | R001 |
| Actor.revision | R003 |
| Actor.status | R002 |
| ProviderAccount.id | R004 |
| ProviderAccount.provider | R004 |
| ProviderAccount.namespace | R004 |
| ProviderAccount.nativeAccountId | R004, R005, R081 |
| ProviderAccount.username | R004, R006, R082 |
| ProviderAccount.displayName | R006, R082 |
| ProviderAccount.avatar | R006, R082 |
| ProviderAccount.identityEvidenceKind | R005 |
| ProviderAccount.identityEvidenceRef | R005 |
| Association.id | R013 |
| Association.actorId | R012, R049 |
| Association.providerAccountId | R010, R011 |
| Association.subjectLookupEvidenceRef | R010 |
| Association.provider | R012 |
| Association.state | R011, R012, R015 |
| Association.assurance | R014 |
| Association.revision | R015, R103 |
| Association.endedAt | R015 |
| AcquisitionContext.id | R016 |
| AcquisitionContext.provider | R016 |
| AcquisitionContext.audienceId | R016 |
| AcquisitionContext.revision | R017 |
| AcquisitionContext.state | R002, R017, R067 |
| AcquisitionContext.authorityExpiresAt | R017, R064 |
| DiscoveryScan.id | R018 |
| DiscoveryScan.associationId | R018 |
| DiscoveryScan.associationRevision | R018 |
| DiscoveryScan.requiredSeasons | R019 |
| DiscoveryScan.completedSeasons | R020 |
| DiscoveryScan.candidateRefs | R020, R021 |
| DiscoveryScan.continuation | R020, R101 |
| DiscoveryScan.status | R020, R079 |
| DiscoveryScan.strategyVersion | R019 |
| LeagueSeason.id | R022 |
| LeagueSeason.leagueId | R022 |
| LeagueSeason.routeKey | R022 |
| LeagueSeason.season | R023 |
| LeagueSeason.sport | R023 |
| LeagueSeason.sourceLeagueId | R022, R081 |
| LeagueSeason.connectionId | R024 |
| LeagueSeason.mappingRevisionId | R024 |
| LeagueSeason.name | R025, R082 |
| LeagueSeason.lifecycle | R025, R082 |
| LeagueSeason.predecessor | R026, R082 |
| LeagueSeason.teamCount | R027, R082 |
| LeagueSeason.settingsRef | R028 |
| LeagueSeason.analyticsAssessmentRef | R029 |
| CurrentSelection.associationId | R030, R031 |
| CurrentSelection.leagueId | R030, R031 |
| CurrentSelection.leagueSeasonId | R030, R031 |
| CurrentSelection.selectionRevision | R031, R046 |
| CurrentSelection.renewalRef | R032, R045 |
| TeamEvidence.seasonTeamId | R033, R049 |
| TeamEvidence.leagueSeasonId | R033 |
| TeamEvidence.provider | R034 |
| TeamEvidence.nativeTeamId | R034, R081 |
| TeamEvidence.primaryOwner | R035 |
| TeamEvidence.coManagers | R036 |
| TeamEvidence.acceptanceRef | R034, R042 |
| TeamEvidence.effectiveFrom | R037 |
| HeldRoster.seasonTeamId | R033 |
| HeldRoster.players | R038, R039, R081, R082 |
| HeldRoster.canonicalEntityRefs | R039 |
| HeldRoster.groupsRef | R040 |
| HeldRoster.metadataRef | R040 |
| HeldRoster.acceptanceRef | R038, R041, R042 |
| Follow.actorId | R043, R044, R049 |
| Follow.leagueId | R043, R044 |
| Follow.state | R043 |
| Follow.revision | R044, R048 |
| Follow.carryoverRef | R048 |
| Renewal.id | R045 |
| Renewal.associationId | R046 |
| Renewal.associationRevision | R046 |
| Renewal.expectedSelectionRevision | R046 |
| Renewal.predecessorSeasonId | R045 |
| Renewal.successorSeasonId | R045 |
| Renewal.predecessorMappingRevisionId | R046 |
| Renewal.successorMappingRevisionId | R046 |
| Renewal.membershipEvidenceRef | R047 |
| Renewal.expectedFollowRevision | R048 |
| ResourceEvidence.scope | R007, R050, R051 |
| ResourceEvidence.canonicalNormalizerVersion | R051 |
| ResourceEvidence.validationVersion | R051 |
| ResourceEvidence.captureRef | R050, R057, R058 |
| ResourceEvidence.sourceMappingRevisionId | R007, R050 |
| ResourceEvidence.origin | R052, R066 |
| ResourceEvidence.sourceObservedAt | R052 |
| ResourceEvidence.requestStartedAt | R052 |
| ResourceEvidence.requestCompletedAt | R052 |
| ResourceEvidence.normalizedAt | R052, R053 |
| ResourceEvidence.qualifyingVerifiedAt | R054 |
| ResourceEvidence.coverage | R027, R055 |
| ResourceEvidence.attemptOrdinal | R053, R056, R097 |
| ResourceEvidence.acceptedGeneration | R053, R056, R057 |
| ResourceEvidence.contentRef | R053, R057 |
| ServingSelection.scope | R059 |
| ServingSelection.readerContract | R059 |
| ServingSelection.canonicalNormalizerVersion | R059 |
| ServingSelection.validationVersion | R059 |
| ServingSelection.selectionRevision | R060, R103 |
| ServingSelection.acceptedRef | R059, R060, R061 |
| LeagueAccessDecision.actorId | R001 |
| LeagueAccessDecision.leagueSeasonId | R073 |
| LeagueAccessDecision.eligibleTeamIds | R049, R068, R069 |
| LeagueAccessDecision.outcome | R065, R067, R073, R098, R102 |
| LeagueAccessDecision.reason | R073, R098 |
| LeagueAccessDecision.policyVersion | R070 |
| LeagueAccessDecision.qualifyingVerifiedAt | R047, R054, R063, R065, R066 |
| LeagueAccessDecision.expiresAt | R063, R064, R066 |
| LeagueAccessDecision.evaluatedAt | R063, R071, R096 |
| LeagueAccessDecision.dependencyRefs | R003, R061, R062, R070, R071, R072, R095, R097 |
| ReadCurrentRosterResult.status | R074, R075, R076, R100, R106 |
| ReadCurrentRosterResult.leagueSeasonId | R074 |
| ReadCurrentRosterResult.eligibleTeamIds | R074 |
| ReadCurrentRosterResult.resourceRevision | R074, R075 |
| ReadCurrentRosterResult.roster | R074, R075, R080 |
| ReadCurrentRosterResult.fieldGroups | R075, R077 |
| ReadCurrentRosterResult.features | R029, R075, R077 |
| ReadCurrentRosterResult.reason | R075, R076, R100 |
| IdentifyProviderAccountResult.lookupRequestId | R007, R008 |
| IdentifyProviderAccountResult.status | R009 |
| IdentifyProviderAccountResult.account | R009 |
| IdentifyProviderAccountResult.evidenceRef | R007, R009 |
| IdentifyProviderAccountResult.reason | R009 |
| DiscoverCurrentTeamsResult.scanId | R078 |
| DiscoverCurrentTeamsResult.status | R079 |
| DiscoverCurrentTeamsResult.selections | R030, R078 |
| DiscoverCurrentTeamsResult.teams | R069 |
| DiscoverCurrentTeamsResult.access | R069, R079 |
| DiscoverCurrentTeamsResult.unresolvedCandidateRefs | R078 |
| DiscoverCurrentTeamsResult.reasons | R078 |

## Reverse allocation: every record constraint

| Constraint | Exact snapshot | Requirement IDs |
| --- | --- | --- |
| Actor#1 | Provider failures never change actor status or login identities | R002 |
| ProviderAccount#1 | Reuse league_source_manager_accounts identity where namespace is proven; separate stable provider identity, optional display and association-subject lookup qualification. | R004 |
| ProviderAccount#2 | Qualified roster owner/co-manager IDs or a validated lookup can establish the stable provider key. Shared team normalization does not require a lookup for every manager. identityEvidenceKind determines the immutable identityEvidenceRef provenance; neither source proves provider-account control. | R005 |
| Association#1 | Atomic two-way uniqueness; provider agrees with referenced account; retained ended history; conflict never chooses a winner | R011, R012, R013, R015 |
| Association#2 | Activation requires a retained successful subject lookup receipt matching providerAccountId; qualified roster-role evidence alone cannot activate an association. | R010 |
| AcquisitionContext#1 | Acquisition permission and league serving authorization are independent; no new credential store | R016, R017 |
| DiscoveryScan#1 | Candidate list does not prove eligible teams or enroll/follow automatically; failed scopes cannot be treated as empty | R018, R020, R021 |
| LeagueSeason#1 | Existing league UUID/public key survive renewal; no merge by name; one selected official source per season | R022, R024 |
| CurrentSelection#1 | Per-user per-league current choice; never max(year) or global NFL-year predicate; shared league facts remain independent | R030 |
| CurrentSelection#2 | The dependency key is exactly (associationId,leagueId); referenced leagueSeasonId must belong to leagueId and its association must match the access actor/provider. | R031 |
| TeamEvidence#1 | Shared season-team identity; multiple co-managers share it; manager absence requires exhaustive qualified group evidence | R033 |
| TeamEvidence#2 | Every declared key component is explicit; provider/nativeTeamId must agree with the reused sourceTeam reference and the captured mapping behind acceptanceRef, including its native league namespace. | R034 |
| HeldRoster#1 | Held players are current membership, not exact-week lineup proof; manager resource accepts independently of malformed players | R038, R041, R042 |
| Follow#1 | Preference never grants eligibility; carryover compares revision so a newer unfollow wins | R043, R048 |
| Follow#2 | The dependency key is exactly (actorId,leagueId); retain its revision through unfollow rather than inventing a surrogate dependency ID. | R044 |
| Renewal#1 | Pin both source mappings; predecessor link plus compatible league identity and fresh successor eligibility; reject conflicts/forks and A-B-A stale proof | R045, R046, R047 |
| ResourceEvidence#1 | All references resolve to compatible scope/audience; no freshness extension from replay; immutable captures may support several normalized versions | R050, R051, R052, R055 |
| ResourceEvidence#2 | Identity lookup is capture-only until resolution; no accepted-head or enrolled mapping fabricated. Failed capture has no normalized content or acceptance generation. | R007, R053 |
| ResourceEvidence#3 | Capture-only or transport-failure evidence has normalizedAt null when no normalization event occurred; a failed normalization attempt may retain only its actual attempt time. No timestamp is manufactured to fill a required slot. | R053 |
| ServingSelection#1 | Logical selection responsibility, not mandatory new table; exactly one designated accepted policy head per serving contract | R059 |
| ServingSelection#2 | The dependency key is exactly (scope,readerContract); compare all scope members including audience, coverage and equal nulls, and never collapse distinct reader/cohort bindings. | R059 |
| LeagueAccessDecision#1 | Final read authorization is separate from acquisition; no grant from follow, commissioner, membership-only, name or historical ownership | R068 |
| LeagueAccessDecision#2 | An allow requires a complete authoritative adverse-membership evidence set across compatible versions, with every applicable removal either denying or explicitly superseded by later qualified positive evidence. Unknown set completeness cannot allow. The coherent cross-version set fence remains an unimplemented G4 design/qualification obligation. | R061, R062 |
| ReadCurrentRosterResult#1 | Internal discriminated result; variants enumerate all required keys and prohibit extras. Final authorization chooses shape. LeagueAccessDecision remains server-side, never embedded in result. Stored reader makes no provider request. | R074, R075, R076, R080 |
| IdentifyProviderAccountResult#1 | Preview does not activate association, enroll or follow. Public lookup evidence does not prove external ownership. Failure cannot produce a provider account. | R008, R009 |
| DiscoverCurrentTeamsResult#1 | List completion and qualified current-team completeness are independent. Include all proven team options with each league independently selected; unknown or denied candidates cannot expose protected roster content. | R078, R079 |

## Reverse allocation: nested types

| Type | Requirement IDs |
| --- | --- |
| Id | R001, R081 |
| NativeId | R004, R081 |
| Instant | R052, R063 |
| Revision | R081 |
| Field<T> | R006, R038, R082 |
| Ref | R005, R050 |
| Json | R082 |
| IdentityLookupScope | R007, R016, R050 |
| AccountResourceScope | R016, R050 |
| EvidenceCoverage | R027, R036, R055 |
| DependencyRef | R072 |
| ProviderManagerIdentity | R005, R035, R036 |
| ActorDependency | R001, R003, R072 |
| SessionDependency | R003, R072 |
| AssociationDependency | R072 |
| AcquisitionDependency | R017, R072 |
| MappingDependency | R024, R072 |
| CurrentSelectionDependency | R031, R072 |
| MembershipDependency | R062, R072, R097 |
| PolicyDependency | R070, R072 |
| PreferenceDependency | R044, R072 |
| ServingSelectionDependency | R059, R072 |
| MembershipEvidenceRef | R061 |
| MembershipSupersession | R061 |
| AdverseMembershipEvidence | R061, R062 |

SourceScope and DiscoveryScope are reused from existing aggregator contracts; exact source paths/anchors are in external_type_refs. This ledger does not redefine their broader existing types.

## Reverse allocation: every grouped acceptance case

| Original case | Independent subcases |
| --- | --- |
| FS01 | FS01.01, FS01.02, FS01.03 |
| FS02 | FS02.01 |
| FS03 | FS03.01, FS03.02 |
| FS04 | FS04.01 |
| FS05 | FS05.01, FS05.02, FS05.03, FS05.04 |
| FS06 | FS06.01, FS06.02, FS06.03 |
| FS07 | FS07.01, FS07.02, FS07.03, FS07.04 |
| FS08 | FS08.01, FS08.02, FS08.03, FS08.04, FS08.05, FS08.06, FS08.07, FS08.08, FS08.09 |
| FS09 | FS09.01, FS09.02, FS09.03, FS09.04 |
| FS10 | FS10.01, FS10.02, FS10.03 |
| FS11 | FS11.01, FS11.02, FS11.03, FS11.04, FS11.05 |
| FS12 | FS12.01, FS12.02, FS12.03, FS12.04, FS12.05 |
| FS13 | FS13.01, FS13.02, FS13.03, FS13.04, FS13.05, FS13.06, FS13.07, FS13.08, FS13.09, FS13.10, FS13.11 |
| FS14 | FS14.01, FS14.02, FS14.03, FS14.04, FS14.05, FS14.06, FS14.07 |
| FS15 | FS15.01, FS15.02, FS15.03 |
| FS16 | FS16.01, FS16.02 |
| FS17 | FS17.01, FS17.02, FS17.03 |
| FS18 | FS18.01, FS18.02, FS18.03, FS18.04, FS18.05 |
| FS19 | FS19.01, FS19.02, FS19.03 |
| FS20 | FS20.01, FS20.02, FS20.03, FS20.04 |
| FS21 | FS21.01, FS21.02, FS21.03 |
| FS22 | FS22.01, FS22.02 |

## Quality scenarios

| Design ID | Requirement allocation | Later qualification |
| --- | --- | --- |
| QA01 | R051, R059, R061, R062, R097 | Runtime evidence remains unexecuted |
| QA02 | R003, R017, R071, R072, R095, R096, R097 | Runtime evidence remains unexecuted |
| QA03 | R002, R054, R063, R064, R066, R067 | Runtime evidence remains unexecuted |
| QA04 | R010, R011, R012, R013, R014, R103 | Runtime evidence remains unexecuted |
| QA05 | R020, R053, R056, R060, R103 | Runtime evidence remains unexecuted |
| QA06 | R016, R033, R043, R049, R058 | Runtime evidence remains unexecuted |
| QA07 | R030, R031, R045, R046, R047, R048 | Runtime evidence remains unexecuted |
| QA08 | R027, R035, R036, R038, R042, R053, R055 | Runtime evidence remains unexecuted |
| QA09 | R018, R019, R020, R021, R078, R079 | Runtime evidence remains unexecuted |
| QA10 | R006, R028, R029, R040, R077, R085 | Runtime evidence remains unexecuted |
| QA11 | R058, R083, R088 | DN05, DN06, DN07 |
| QA12 | R076, R099, R100, R101, R102, R103 | Runtime evidence remains unexecuted |

## Selected engineering alternatives

| Design ID | Requirement allocation | Later qualification |
| --- | --- | --- |
| AD01 | R003, R071, R095, R096, R097 | Runtime evidence remains unexecuted |
| AD02 | R051, R059, R061, R062, R097 | Runtime evidence remains unexecuted |
| AD03 | R054, R056, R061, R064 | Runtime evidence remains unexecuted |
| AD04 | R017, R067, R080 | Runtime evidence remains unexecuted |
| AD05 | R016, R033, R049, R058 | Runtime evidence remains unexecuted |
| AD06 | R022, R024, R028, R083, R087, R097 | Runtime evidence remains unexecuted |
| AD07 | R098 | Runtime evidence remains unexecuted |
| AD08 | R099, R100, R101, R102, R103, R104 | Runtime evidence remains unexecuted |

## Operating qualification

| Design ID | Requirement allocation | Later qualification |
| --- | --- | --- |
| OE-T01 | R099 | Runtime evidence remains unexecuted |
| OE-T02 | R076, R100 | Runtime evidence remains unexecuted |
| OE-T03 | R020, R060, R101, R103 | Runtime evidence remains unexecuted |
| OE-T04 | R063, R066, R067, R101 | Runtime evidence remains unexecuted |
| OE-T05 | R102, R103 | Runtime evidence remains unexecuted |
| OE-T06 | R104 | Runtime evidence remains unexecuted |

## Behavior/security controls

| Design ID | Requirement allocation | Later qualification |
| --- | --- | --- |
| BS-C01 | R001, R003, R072, R095, R105 | Runtime evidence remains unexecuted |
| BS-C02 | R010, R011, R012, R013, R014 | Runtime evidence remains unexecuted |
| BS-C03 | R018, R020, R058, R067, R098, R107 | Runtime evidence remains unexecuted |
| BS-C04 | R016, R024, R031, R034, R050, R072, R081, R108 | Runtime evidence remains unexecuted |
| BS-C05 | R073, R074, R075, R076, R080, R100, R106 | Runtime evidence remains unexecuted |
| BS-C06 | R061, R062, R071, R095, R096, R097 | Runtime evidence remains unexecuted |
| BS-C07 | R051, R054, R056, R059, R060, R061, R070, R097 | Runtime evidence remains unexecuted |
| BS-C08 | R030, R031, R043, R044, R045, R046, R047, R048 | Runtime evidence remains unexecuted |
| BS-C09 | R013, R018, R020, R053, R056, R060, R103 | Runtime evidence remains unexecuted |
| BS-C10 | R005, R006, R010, R027, R029, R035, R036, R038, R040, R042 | Runtime evidence remains unexecuted |
| BS-C11 | R002, R054, R063, R064, R065, R066, R067, R096 | Runtime evidence remains unexecuted |
| BS-C12 | R097, R099, R100, R101, R102, R103, R104 | Runtime evidence remains unexecuted |
| BS-C13 | R095, R097, R098, R105 | Runtime evidence remains unexecuted |

## Behavior/security oracles

| Design ID | Requirement allocation | Later qualification |
| --- | --- | --- |
| BS-O01 | R001, R004, R009, R034, R050, R072, R081, R108 | Runtime evidence remains unexecuted |
| BS-O02 | R010, R011, R012, R013, R014, R103 | Runtime evidence remains unexecuted |
| BS-O03 | R018, R019, R020, R021, R078, R079 | Runtime evidence remains unexecuted |
| BS-O04 | R027, R035, R036, R038, R042, R055 | Runtime evidence remains unexecuted |
| BS-O05 | R003, R015, R017, R062, R071, R076, R097, R106 | Runtime evidence remains unexecuted |
| BS-O06 | R054, R063, R064, R065, R066, R096, R098 | Runtime evidence remains unexecuted |
| BS-O07 | R003, R095, R096, R097, R105 | Runtime evidence remains unexecuted |
| BS-O08 | R022, R024, R025, R026, R030, R031, R032, R045, R046, R047 | Runtime evidence remains unexecuted |
| BS-O09 | R002, R017, R058, R067, R101, R107 | Runtime evidence remains unexecuted |
| BS-O10 | R005, R006, R007, R008, R010, R028, R029, R040 | Runtime evidence remains unexecuted |
| BS-O11 | R024, R051, R056, R059, R061, R062, R097 | Runtime evidence remains unexecuted |
| BS-O12 | R043, R044, R045, R046, R048 | Runtime evidence remains unexecuted |
| BS-O13 | R013, R020, R053, R056, R057, R060, R103 | Runtime evidence remains unexecuted |
| BS-O14 | R073, R076, R099, R100, R102, R104 | Runtime evidence remains unexecuted |
| BS-O15 | R072, R098, R105 | Runtime evidence remains unexecuted |

QA/AD/OE IDs refer to [quality decisions and operating evidence](quality-operations.md); BS IDs refer to [behavior/security design](behavior-security-design.md). The selected physical/transaction mechanisms are refined in [relational design](relational-design.md). R095-R108 distinguish selected engineering controls from new product policy or deployed configuration.

## Deferred or excluded approved needs

| ID | Need / source | Milestone and gate | Disposition / retained obligations |
| --- | --- | --- | --- |
| DN01 | Private provider authorization and additional fantasy providers (H01) | BC-M6; Explicit provider-access/product scope plus G4-G7 | First slice uses Sleeper public read-only identification; it neither proves external ownership nor invents future provider behavior. Retained by R004, R014, R016, R089. |
| DN02 | Prior-season browsing (H05) | BC-M2 compatibility/history qualification; no new prior-season UI required by first slice; Separate product scope | The approved handoff explicitly says prior-season browsing is not required now; current completed seasons remain while eligible. Retained by R030, R045. |
| DN03 | Recoverable current-season competitive history, current state and remaining provider-published schedule (H06) | BC-M2; Coverage manifest, source qualification and G6-G7 | Current shared teams/held reads form first slice; history must enumerate irrecoverable/unsupported detail rather than fabricate it. Retained by R028, R029, R041, R057. |
| DN04 | League-specific projections, forecasts, win probabilities and projected standings over shared NFL inputs (H07) | BC-M3; Actual rule/slot/competition interpretation and independent feature qualification | First slice retains settings and official/derived separation; it does not demonstrate support for every scoring or competition rule. Retained by R028, R029, R077, R083, R085. |
| DN05 | 500 distinct watched leagues per supported provider with imports/background/retries coexisting (H09) | BC-M4; Measured provider-wide workload, admission and cost criteria | ENG02/ENG03 select admission, cadence and concurrency. No benchmark is established; mixed-workload capacity including future work remains required. Retained by R058, R088. |
| DN06 | Approximately 60 seconds of additional L1 score delay (H09) | BC-M4; Selected ENG03 criterion plus empirical mixed-workload evidence | ENG03 selects p95<=60s and p99<=75s with end-to-end measurement including polling miss and unknown provider change time. Retained by R058, R088. |
| DN07 | Approximately $50 monthly supporting-feed target (H09) | BC-M4; Current price, entitlement, provider terms and workload evidence | Separate from compute/database/storage cost; no new cost or feed choice authorized. Retained by R083, R089. |
| DN08 | Last-follower collection and retention behavior (H08, H14) | BC-M1 then BC-M4 operation; D05 implementation and ENG08 disposal qualification before behavior change | D05 selected under direct delegation; zero-demand cooldown and bounded recovery need implementation and privacy/retention qualification. Retained by R049, R088. |
| DN09 | Runtime implementation, migration execution, public website/API cutover and release (H12, H13, H15) | BC-M1 through BC-M5; Design review then G6/G7 and affected product decisions | Current work specifies verifiable design; no execution or deployment result follows. Retained by R087, R090, R092, R093. |

## Product decisions

| ID | Status | Boundary | Requirements |
| --- | --- | --- | --- |
| D02 | approved_not_deployed | Exactly 3,600 seconds; approved but not deployed. Gate: G6 implementation proof; G7 release. | R054, R063, R064, R065, R066, R067, R070 |
| D03 | selected_not_implemented | No automatic displacement; own fresh authenticated release or reviewed implemented provider-control proof; unsupported disputes stay locked. Gate: Selected policy; actual implementation/qualification before activation. | R010, R011, R012, R014 |
| D04 | selected_not_implemented | Retained explicit intention; effective follow suspended while ineligible; unchanged intention can resume after fresh qualification; unfollow revision wins. Gate: Selected policy; actual implementation/qualification before activation. | R043, R048, R061 |
| D05 | selected_not_implemented | Zero-demand30min cooldown; bounded hourly recovery7days; last follower never deletes shared history or baselines. Gate: Selected policy; actual implementation/qualification before activation. | R049, R088 |

## Design review and change control

Inspect every approved need against its first-slice obligations or explicit deferral, then inspect every field, constraint, nested type and case in the reverse tables. A meaningful allocation and independent oracle are required; arbitrary references do not close gaps. Review state/sequence, relational and threat/quality artifacts using these IDs before accepting the design baseline. Verification against this specification remains distinct from later validation of real manager/co-manager/operator workflows.

Change impact follows source need -> requirement -> owner/field/constraint/type and selected model element -> case, and reverse. Preserve superseded approvals and design evidence; do not renumber existing IDs to conceal changes. Product decisions require actual product-owner decisions. Independent review records its own findings/limitations; this ledger is not a workshop, production qualification or ISO certification.
